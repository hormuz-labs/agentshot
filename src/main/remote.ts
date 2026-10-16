// The phone companion app's server: the Mac's side of src/shared/remote.ts, on the local network, off unless the user
// turns it on (Settings → Phone). Paired phones list recent projects, follow a project's conversation as AG-UI events
// (server-sent, each sealed), send it messages and stop it. Everything in and out is sealed with the phone's key;
// anything else gets an empty 401, so the server tells a stranger nothing about what is on the Mac.
// No Electron here: the app hands it the agent and the device store (phones.ts), tests hand it fakes.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { hostname, networkInterfaces } from 'node:os'
import type { BaseEvent } from '@ag-ui/core'
import {
  aad, DEVICE_HEADER, newId, newKey, PAIR_TTL_MS, PROTOCOL, ReplayGuard, routes, seal, SEAL_HEADER, SealError, unseal,
  type PairingCode, type PairReply, type PairRequest, type RemoteMessage, type RemoteProject,
} from '../shared/remote'

export const DEFAULT_PORT = 47821
const MAX_BODY = 64 * 1024
const PAIR_TRIES = 5
const HEARTBEAT_MS = 15_000

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
  /** a phone paired, or a phone connected or went away */
  changed?(): void
}

/** Where the phone can reach this Mac: its IPv4 addresses on the local network, then its Bonjour name. */
export function lanHosts() {
  const ips = Object.values(networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map(i => i!.address)
  const name = hostname()
  return [...new Set([...ips, name.includes('.') ? name : `${name}.local`])]
}

class HttpError extends Error { constructor(public status: number, message = '') { super(message) } }

export class PhoneServer {
  private server: Server | null = null
  private code: (PairingCode & { tries: number }) | null = null
  private pairGuard = new ReplayGuard()
  private guards = new Map<string, ReplayGuard>()
  private streams = new Map<ServerResponse, string>() // → device id
  port = 0

  constructor(private deps: PhoneDeps, private hosts: () => string[] = lanHosts) {}

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
    const sealed = method === 'GET' ? String(req.headers[SEAL_HEADER] || '') : await body(req)
    const { value, nonce } = unseal(device.key, aad.request(method, path), sealed)
    if (!this.guardOf(device.id).accept(nonce)) throw new HttpError(401)
    this.deps.store.seen(device.id)
    const reply = (status: number, v: unknown) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(seal(device.key, aad.reply(nonce), v))
    }

    try {
      if (method === 'GET' && path === routes.projects) {
        return reply(200, this.deps.projects().map(({ id, title, openedAt }) => ({ id, title, openedAt })))
      }
      const m = /^\/v1\/projects\/([^/]+)\/(events|messages|stop)$/.exec(path)
      if (!m) throw new HttpError(404, 'Not found.')
      const project = this.deps.projects().find(p => p.id === decodeURIComponent(m[1]))
      if (!project) throw new HttpError(404, 'That project is not on this Mac any more.')
      if (method === 'GET' && m[2] === 'events') return await this.events(res, device, nonce, project.dir)
      if (method === 'POST' && m[2] === 'messages') {
        const text = String((value as RemoteMessage | null)?.text ?? '').trim()
        if (!text) throw new HttpError(400, 'Say something first.')
        await this.deps.open(project.dir)
        await this.deps.send(project.dir, { text })
        return reply(200, { ok: true })
      }
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
      asked = unseal<PairRequest>(c.secret, aad.pair, await body(req))
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

function body(req: IncomingMessage) {
  return new Promise<string>((ok, no) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) { no(new HttpError(413)); req.destroy() } else chunks.push(c)
    })
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')))
    req.on('error', no)
  })
}
