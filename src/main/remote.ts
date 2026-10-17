// The phone companion app's server: the Mac's side of src/shared/remote.ts, on the local network, off unless the user
// turns it on (Settings → Phone). Paired phones list recent projects, follow a project's conversation as AG-UI events
// (server-sent, each sealed), send it messages and stop it, and send footage into it in sealed chunks that resume
// after a drop (kept in `uploads` until whole, then added to the project like any file). Everything in and out is sealed with the phone's key;
// anything else gets an empty 401, so the server tells a stranger nothing about what is on the Mac.
// No Electron here: the app hands it the agent and the device store (phones.ts), tests hand it fakes.
import { appendFile, mkdir, readdir, readFile, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import type { BaseEvent } from '@ag-ui/core'
import {
  aad, CHUNK, CHUNK_OVERHEAD, DEVICE_HEADER, isTailscale, newId, newKey, PAIR_TTL_MS, PROTOCOL, ReplayGuard, routes, seal, SEAL_HEADER, SealError,
  unseal, unsealBytes,
  type Hello, type PairingCode, type PairReply, type PairRequest, type RemoteMessage, type RemoteProject, type UploadStart, type UploadState,
} from '../shared/remote'

export const DEFAULT_PORT = 47821
const MAX_BODY = 64 * 1024
const PAIR_TRIES = 5
const HEARTBEAT_MS = 15_000
const MAX_UPLOAD = 64 * 1024 ** 3
/** room left on the Mac after an upload */
const SPARE_BYTES = 1024 ** 3
/** an upload nobody finished is let go after a week; a finished one is remembered for a day, so a phone that missed
 *  the answer to its last chunk still learns where the file landed */
const STALE_UPLOAD_MS = 7 * 86_400_000
const DONE_UPLOAD_MS = 86_400_000

export type Device = { id: string; name: string; key: string; pairedAt: number; lastSeen?: number }
export type DeviceStore = {
  mac: { id: string; name: string }
  get(id: string): Device | undefined
  add(d: Device): void
  /** the phone was seen now */
  seen(id: string): void
}
export type PhoneDeps = {
  store: DeviceStore
  projects(): (RemoteProject & { dir: string })[]
  /** make sure the project is open (without disturbing the window if it already is) */
  open(dir: string): Promise<void>
  send(dir: string, msg: RemoteMessage): Promise<void>
  stop(dir: string): Promise<void>
  subscribe(dir: string, emit: (e: BaseEvent) => void): () => void
  /** where uploads wait until they are whole */
  uploads: string
  /** a whole upload, into the (open) project: its paths in media/. `from` is the phone's name. */
  addFile(dir: string, abs: string, from: string): Promise<string[]>
  /** a phone paired, or a phone connected or went away */
  changed?(): void
}

/**
 * Where the phone can reach this Mac: its IPv4 addresses on the local network, its Bonjour name, then its Tailscale
 * address (100.x, on the person's tailnet), which also works away from home. An IP rather than the tailnet's
 * *.ts.net name, because iOS lets an app speak plain HTTP to an IP address but not to a full domain name.
 */
export function reachableHosts(ifaces = networkInterfaces(), name = hostname()) {
  const ips = Object.values(ifaces).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map(i => i!.address)
  return [...new Set([...ips.filter(ip => !isTailscale(ip)), name.includes('.') ? name : `${name}.local`, ...ips.filter(isTailscale)])]
}

class HttpError extends Error { constructor(public status: number, message = '') { super(message) } }

/** An upload as the Mac keeps it, in <uploads>/<id>.json; its bytes so far are <uploads>/<id>/<name>. */
type Upload = UploadStart & { id: string; device: string; project: string; dir: string; createdAt: number; files?: string[] }

/** A file name from the phone, safe to put in a folder: no path, no control characters, not hidden. */
export function safeName(name: unknown) {
  const base = String(name ?? '').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f:]/g, '').trim().replace(/^\.+/, '')
  return (base || 'clip.mov').slice(-120)
}

export class PhoneServer {
  private server: Server | null = null
  private code: (PairingCode & { tries: number }) | null = null
  private pairGuard = new ReplayGuard()
  private guards = new Map<string, ReplayGuard>()
  private streams = new Map<ServerResponse, string>() // → device id
  private locks = new Map<string, Promise<unknown>>() // upload id → its chunk being written
  port = 0

  constructor(private deps: PhoneDeps, private hosts: () => string[] = reachableHosts) {}

  get listening() { return !!this.server }
  /** phones following a conversation right now */
  get connected() { return this.streams.size }

  /** Listen on every interface: the preferred port, or any free one if it is taken. */
  async start(port = DEFAULT_PORT, host = '0.0.0.0') {
    if (this.server) return this.port
    const server = createServer((req, res) => { this.handle(req, res).catch(e => this.fail(res, e)) })
    this.port = await new Promise<number>((ok, no) => {
      const listen = (p: number) => {
        server.once('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' && p !== 0 ? listen(0) : no(e)))
        server.listen(p, host, () => ok((server.address() as { port: number }).port))
      }
      listen(port)
    })
    this.server = server
    await this.sweep().catch(e => console.warn('phone uploads', e))
    return this.port
  }

  async stop() {
    this.code = null
    for (const res of this.streams.keys()) res.destroy()
    this.streams.clear()
    const s = this.server
    this.server = null
    if (s) await new Promise<void>(ok => { s.close(() => ok()); s.closeAllConnections() })
    this.deps.changed?.()
  }

  /** A phone was removed: end what it has open. */
  drop(device: string) {
    for (const [res, d] of this.streams) if (d === device) res.destroy()
    this.guards.delete(device)
  }

  /** A fresh one-time pairing code (the QR), replacing any earlier one. */
  pairingCode(now = Date.now()): PairingCode {
    if (!this.server) throw new Error('Turn on phone access first.')
    const { id, name } = this.deps.store.mac
    const c = { v: PROTOCOL, mac: id, name, hosts: this.hosts(), port: this.port, secret: newKey(), expires: now + PAIR_TTL_MS }
    this.code = { ...c, tries: 0 }
    return c
  }

  // ---------------------------------------------------------------- requests
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const method = req.method || 'GET'
    const path = (req.url || '/').split('?')[0]
    if (method === 'POST' && path === routes.pair) return this.pair(req, res)

    // every other request: a paired device, and a fresh seal bound to this method and path
    const device = this.deps.store.get(String(req.headers[DEVICE_HEADER] || ''))
    if (!device) throw new HttpError(401)
    // a chunk of an upload is sealed bytes, bound to its upload and offset; anything else is sealed JSON
    const chunk = method === 'POST' ? /^\/v1\/uploads\/([^/]+)\/(\d+)$/.exec(path) : null
    const { value, nonce } = chunk
      ? unsealBytes(device.key, aad.chunk(decodeURIComponent(chunk[1]), Number(chunk[2])), await read(req, CHUNK + CHUNK_OVERHEAD))
      : unseal(device.key, aad.request(method, path), method === 'GET' ? String(req.headers[SEAL_HEADER] || '') : (await read(req, MAX_BODY)).toString('utf8'))
    if (!this.guardOf(device.id).accept(nonce)) throw new HttpError(401)
    this.deps.store.seen(device.id)
    const reply = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(seal(device.key, aad.reply(nonce), v))
    }

    try {
      if (method === 'GET' && path === routes.hello) {
        const { id, name } = this.deps.store.mac
        return reply(200, { mac: id, name, hosts: this.hosts(), port: this.port } satisfies Hello)
      }
      if (method === 'GET' && path === routes.projects) {
        return reply(200, this.deps.projects().map(({ id, title, openedAt }) => ({ id, title, openedAt })))
      }
      if (chunk) return await this.serial(chunk[1], () => this.chunk(device, decodeURIComponent(chunk[1]), Number(chunk[2]), value as Uint8Array, reply))
      const u = /^\/v1\/uploads\/([^/]+)(\/cancel)?$/.exec(path)
      if (u && method === 'GET' && !u[2]) return reply(200, await this.stateOf(await this.upload(decodeURIComponent(u[1]), device)))
      if (u && method === 'POST' && u[2]) {
        return await this.serial(u[1], async () => { await this.discard(await this.upload(decodeURIComponent(u[1]), device)); reply(200, { ok: true }) })
      }
      const m = /^\/v1\/projects\/([^/]+)\/(events|messages|stop|uploads)$/.exec(path)
      if (!m) throw new HttpError(404, 'Not found.')
      const project = this.deps.projects().find(p => p.id === decodeURIComponent(m[1]))
      if (!project) throw new HttpError(404, 'That project is not on this Mac any more.')
      if (method === 'GET' && m[2] === 'events') return await this.events(res, device, nonce, project.dir)
      if (method === 'POST' && m[2] === 'messages') {
        const msg = value as RemoteMessage | null
        const text = String(msg?.text ?? '').trim()
        // only files in the project's media/ (what the phone uploaded there)
        const files = (Array.isArray(msg?.files) ? msg.files : []).filter((f): f is string => typeof f === 'string' && f.startsWith('media/') && !f.split('/').includes('..'))
        if (!text && !files.length) throw new HttpError(400, 'Say something first.')
        await this.deps.open(project.dir)
        await this.deps.send(project.dir, files.length ? { text, files } : { text })
        return reply(200, { ok: true })
      }
      if (method === 'POST' && m[2] === 'uploads') return reply(200, await this.startUpload(device, project, value as UploadStart | null))
      if (method === 'POST' && m[2] === 'stop') { await this.deps.stop(project.dir); return reply(200, { ok: true }) }
      throw new HttpError(404, 'Not found.')
    } catch (e) {
      // the device is genuine: it may hear why
      if (res.headersSent) { res.destroy(); return }
      reply(e instanceof HttpError ? e.status : 500, { error: (e as Error).message || 'Something went wrong on the Mac.' })
    }
  }

  private async pair(req: IncomingMessage, res: ServerResponse) {
    const c = this.code
    if (!c || c.expires < Date.now()) throw new HttpError(410)
    let asked: { value: PairRequest; nonce: string }
    try {
      asked = unseal<PairRequest>(c.secret, aad.pair, (await read(req, MAX_BODY)).toString('utf8'))
    } catch (e) {
      if (++c.tries >= PAIR_TRIES) this.code = null // someone is guessing: this code is done
      throw e
    }
    if (!this.pairGuard.accept(asked.nonce)) throw new HttpError(401)
    this.code = null // one phone per code
    const d: Device = { id: newId(), name: String(asked.value?.name || 'Phone').slice(0, 64), key: newKey(), pairedAt: Date.now() }
    this.deps.store.add(d)
    const answer: PairReply = { device: d.id, key: d.key, mac: c.mac, name: c.name }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end(seal(c.secret, aad.paired, answer))
    this.deps.changed?.()
  }

  /** The conversation as server-sent events: a full replay first, then what changes, until the phone goes. */
  private async events(res: ServerResponse, device: Device, nonce: string, dir: string) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' })
    res.flushHeaders()
    let seq = 0
    const off = this.deps.subscribe(dir, e => { if (!res.writableEnded) res.write(`data: ${seal(device.key, aad.event(nonce, seq++), e)}\n\n`) })
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    this.streams.set(res, device.id)
    this.deps.changed?.()
    res.on('close', () => {
      off()
      clearInterval(beat)
      this.streams.delete(res)
      this.deps.changed?.()
    })
    try {
      await this.deps.open(dir)
    } catch (e) {
      res.write(`data: ${seal(device.key, aad.event(nonce, seq++), { type: 'RUN_ERROR', message: (e as Error).message })}\n\n`)
      res.end()
    }
  }

  // ---------------------------------------------------------------- uploads
  private async startUpload(device: Device, project: RemoteProject & { dir: string }, v: UploadStart | null): Promise<UploadState> {
    const size = Number(v?.size)
    if (!Number.isSafeInteger(size) || size <= 0) throw new HttpError(400, 'That file is empty.')
    if (size > MAX_UPLOAD) throw new HttpError(413, 'That file is too big to send from the phone.')
    await mkdir(this.deps.uploads, { recursive: true })
    const fs = await statfs(this.deps.uploads)
    if (fs.bavail * fs.bsize < size + SPARE_BYTES) throw new HttpError(507, `There isn't room for it on ${this.deps.store.mac.name}.`)
    const u: Upload = { id: newId(), device: device.id, project: project.id, dir: project.dir, name: safeName(v?.name), size, createdAt: Date.now() }
    await mkdir(join(this.deps.uploads, u.id))
    await writeFile(this.dataOf(u), new Uint8Array())
    await writeFile(this.metaOf(u.id), JSON.stringify(u))
    return this.stateOf(u)
  }

  /** The next piece of an upload. Any other offset gets 409 with where the Mac is, and the phone carries on from there.
   *  The last piece adds the file to its project. */
  private async chunk(device: Device, id: string, offset: number, bytes: Uint8Array, reply: (status: number, v: unknown) => void) {
    const u = await this.upload(id, device)
    const have = await this.received(u)
    if (u.files || offset !== have) return reply(409, await this.stateOf(u))
    if (!bytes.length || have + bytes.length > u.size) throw new HttpError(400, "That piece doesn't fit the file.")
    await appendFile(this.dataOf(u), bytes)
    if (have + bytes.length < u.size) return reply(200, await this.stateOf(u))

    const project = this.deps.projects().find(p => p.id === u.project && p.dir === u.dir)
    try {
      if (!project) throw new HttpError(404, 'That project is not on this Mac any more.')
      await this.deps.open(u.dir)
      u.files = await this.deps.addFile(u.dir, this.dataOf(u), device.name)
    } catch (e) {
      await this.discard(u)
      throw e
    }
    await writeFile(this.metaOf(u.id), JSON.stringify(u))
    await rm(join(this.deps.uploads, u.id), { recursive: true, force: true })
    return reply(200, await this.stateOf(u))
  }

  /** This device's upload, or 404. */
  private async upload(id: string, device: Device): Promise<Upload> {
    const gone = new HttpError(404, 'This upload is not on the Mac any more. Send it again.')
    if (!/^[\w-]{8,64}$/.test(id)) throw gone
    let u: Upload
    try { u = JSON.parse(await readFile(this.metaOf(id), 'utf8')) } catch { throw gone }
    if (u.device !== device.id) throw gone
    return u
  }

  private async received(u: Upload) {
    if (u.files) return u.size
    return stat(this.dataOf(u)).then(s => s.size, () => 0)
  }

  private async stateOf(u: Upload): Promise<UploadState> {
    return { upload: u.id, name: u.name, size: u.size, received: await this.received(u), ...(u.files ? { files: u.files } : {}) }
  }

  private async discard(u: Upload) {
    await rm(join(this.deps.uploads, u.id), { recursive: true, force: true })
    await rm(this.metaOf(u.id), { force: true })
  }

  /** Let go of uploads nobody finished, finished ones the phone has had time to hear about, and stray bytes. */
  private async sweep(now = Date.now()) {
    const names = await readdir(this.deps.uploads).catch(() => [] as string[])
    const kept = new Set<string>()
    for (const n of names.filter(n => n.endsWith('.json'))) {
      const u: Upload | null = await readFile(join(this.deps.uploads, n), 'utf8').then(JSON.parse, () => null)
      if (u?.id && now - u.createdAt < (u.files ? DONE_UPLOAD_MS : STALE_UPLOAD_MS)) { kept.add(u.id); continue }
      if (u?.id) await this.discard(u)
      else await rm(join(this.deps.uploads, n), { force: true })
    }
    for (const n of names) if (!n.endsWith('.json') && !kept.has(n)) await rm(join(this.deps.uploads, n), { recursive: true, force: true })
  }

  private metaOf(id: string) { return join(this.deps.uploads, `${id}.json`) }
  private dataOf(u: Upload) { return join(this.deps.uploads, u.id, u.name) }

  /** One request at a time per upload, so two pieces can't be written at once. */
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(fn)
    const settled = run.catch(() => {})
    this.locks.set(id, settled)
    void settled.then(() => { if (this.locks.get(id) === settled) this.locks.delete(id) })
    return run
  }

  private guardOf(device: string) {
    let g = this.guards.get(device)
    if (!g) this.guards.set(device, (g = new ReplayGuard()))
    return g
  }

  /** Strangers and bad seals learn nothing: an empty status. */
  private fail(res: ServerResponse, e: unknown) {
    if (res.headersSent) { res.destroy(); return }
    const status = e instanceof HttpError ? e.status : e instanceof SealError ? 401 : 500
    if (status === 500) console.warn('phone server', e)
    res.writeHead(status).end()
  }
}

function read(req: IncomingMessage, max: number) {
  if (Number(req.headers['content-length']) > max) return Promise.reject(new HttpError(413))
  return new Promise<Buffer>((ok, no) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > max) { no(new HttpError(413)); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks)))
    req.on('error', no)
  })
}
