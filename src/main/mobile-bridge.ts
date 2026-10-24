// Optional TLS bridge. Pairing is explicit on the desktop; paired devices persist (30 days) until revoked.
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes, randomInt, timingSafeEqual, X509Certificate } from 'node:crypto'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { tmpdir, networkInterfaces } from 'node:os'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { generate } from 'selfsigned'
import { artifactPath } from './artifacts'
import { mobileArgs, mobileSchemas, projectArgument } from './mobile-contract'
import { emptyAgentState, reduce, type AgentState } from '../shared/agui-state'
type Options = {
  invoke(method: string, args: unknown[]): Promise<unknown>
  projects(): { dir: string }[]
  importFile(file: string, dir?: string): Promise<unknown>
  galleryFile(url: string, range?: string): Response
  stateFile?: string
  projectsRoot?: () => string
  onProjectSynced?: (dir: string) => Promise<void> | void
  /** This computer's Headscale mesh IP, when the userspace mesh node is up. */
  meshIp?: () => string | undefined
}
type PersistedBridgeState = {
  key: string
  cert: string
  workerSecret: string
  devices: [string, { id: string; name: string; expiresAt: number }][]
}
type UploadSession = { id: string; folder: string; file: string; dir?: string; name: string; size: number; offset: number; busy: boolean }
export const DEFAULT_MOBILE_PORT = 47821
const secret = () => randomBytes(32).toString('base64url')
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export function isTailscale(ip: string) {
  const p = ip.split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
}
export function reachableIps(ifaces = networkInterfaces()) {
  const ips = Object.values(ifaces).flat().filter(n => n?.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n => n!.address)
  return [...new Set([...ips.filter(ip => !isTailscale(ip)), ...ips.filter(isTailscale)])]
}
export type MobileStatus = { running: boolean; addresses: string[]; tailscale?: string; mesh?: string; fingerprint?: string; code?: string; expiresAt?: number; devices: { id: string; name: string }[] }
export class MobileBridge {
  private server?: Server
  private udp?: UdpSocket
  private fingerprint?: string
  private code?: string
  private workerSecret = secret()
  private pem?: { private: string; cert: string }
  private uploads = new Map<string, UploadSession>()
  private codeTries = 0
  private expiresAt = 0
  private port = 0
  private devices = new Map<string, { id: string; name: string; expiresAt: number }>()
  private clients = new Map<ServerResponse, string>()
  private states = new Map<string, AgentState>()
  private failures = new Map<string, { count: number; until: number }>()
  private activeUploads = 0
  private starting?: Promise<MobileStatus>
  constructor(private options: Options, private ips: () => string[] = reachableIps) {}
  status(): MobileStatus {
    const list = this.ips()
    const addresses = this.server ? list.map(ip => `https://${ip}:${this.port}`) : []
    const mesh = this.server ? this.options.meshIp?.() : undefined
    return { running: !!this.server, addresses, tailscale: list.find(ip => isTailscale(ip) && ip !== mesh), mesh, fingerprint: this.fingerprint, code: this.code, expiresAt: this.expiresAt, devices: [...this.devices.values()].map(({ id, name }) => ({ id, name })) }
  }
  /** The port the bridge actually bound (47821 unless that was taken). */
  listenPort() {
    return this.server ? this.port : undefined
  }
  workerCredentials() {
    return { fingerprint: this.fingerprint, secret: this.workerSecret, urls: this.status().addresses }
  }
  private loadState() {
    if (!this.options.stateFile || !existsSync(this.options.stateFile)) return
    try {
      const raw = JSON.parse(readFileSync(this.options.stateFile, 'utf8')) as Partial<PersistedBridgeState>
      if (typeof raw.key === 'string' && typeof raw.cert === 'string') this.pem = { private: raw.key, cert: raw.cert }
      if (typeof raw.workerSecret === 'string' && raw.workerSecret.length >= 32) this.workerSecret = raw.workerSecret
      if (Array.isArray(raw.devices)) {
        const now = Date.now()
        for (const [t, d] of raw.devices) if (d && d.expiresAt > now) this.devices.set(t, d)
      }
    } catch {}
  }
  private saveState() {
    if (!this.options.stateFile || !this.pem) return
    try {
      mkdirSync(dirname(this.options.stateFile), { recursive: true })
      const data: PersistedBridgeState = {
        key: this.pem.private,
        cert: this.pem.cert,
        workerSecret: this.workerSecret,
        devices: [...this.devices.entries()],
      }
      writeFileSync(this.options.stateFile, JSON.stringify(data, null, 2), { mode: 0o600 })
    } catch {}
  }
  private verifyAuth(token: string): { id: string; name: string; expiresAt: number } | undefined {
    if (!token) return undefined
    const dev = this.devices.get(token)
    if (dev) {
      if (dev.expiresAt < Date.now()) { this.devices.delete(token); this.saveState(); return undefined }
      return dev
    }
    const m = /^lease\.(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token)
    if (!m) return undefined
    const expiresAt = Number(m[1])
    if (!Number.isSafeInteger(expiresAt) || expiresAt < Date.now()) return undefined
    const payload = `${m[1]}.${m[2]}`
    const expected = createHmac('sha256', this.workerSecret).update(payload).digest('base64url')
    if (Buffer.byteLength(m[3]) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(m[3]), Buffer.from(expected))) return undefined
    return { id: `lease:${m[2]}`, name: 'Leased client', expiresAt }
  }
  start(): Promise<MobileStatus> {
    if (this.starting) return this.starting
    this.starting = this.listen().finally(() => { this.starting = undefined })
    return this.starting
  }
  private async listen() {
    if (this.server) { this.code = String(randomInt(100_000, 1_000_000)); this.codeTries = 0; this.expiresAt = Date.now() + 5 * 60_000; return this.status() }
    this.loadState()
    if (!this.pem) {
      const generated = await generate([{ name: 'commonName', value: 'AgentShot Mobile Bridge' }], { keySize: 2048, algorithm: 'sha256', notAfterDate: new Date(Date.now() + 365 * 86400_000) })
      this.pem = { private: generated.private, cert: generated.cert }
    }
    const pem = this.pem
    this.saveState()
    const server = createServer({ key: pem.private, cert: pem.cert, minVersion: 'TLSv1.2' }, (req, res) => {
      void this.handle(req, res).catch(error => {
        if (res.headersSent) { res.destroy(); return }
        const expected = error instanceof HttpError
        if (!expected) console.warn('Mobile bridge request failed', error instanceof Error ? error.message : 'unknown')
        res.writeHead(expected ? error.status : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: expected ? error.message : 'Request failed. Check the desktop and try again.' }))
      })
    })
    server.requestTimeout = 30 * 60_000; server.headersTimeout = 15_000
    await new Promise<void>((ok, fail) => {
      const bind = (p: number) => {
        server.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' && p !== 0 ? bind(0) : fail(err)))
        server.listen(p, '0.0.0.0', () => { server.removeAllListeners('error'); ok() })
      }
      bind(DEFAULT_MOBILE_PORT)
    })
    const addr = server.address()
    this.server = server; this.port = addr && typeof addr === 'object' ? addr.port : DEFAULT_MOBILE_PORT
    this.fingerprint = new X509Certificate(pem.cert).fingerprint256.replaceAll(':', '').toLowerCase()
    this.code = String(randomInt(100_000, 1_000_000)); this.codeTries = 0; this.expiresAt = Date.now() + 5 * 60_000
    this.startUdp()
    return this.status()
  }
  private startUdp() {
    try {
      const udp = createSocket({ type: 'udp4', reuseAddr: true })
      udp.on('error', () => { try { udp.close() } catch {} })
      udp.on('message', (msg, rinfo) => {
        if (!this.server || !this.code || Date.now() > this.expiresAt || msg.toString('utf8').trim() !== 'manul-discover') return
        const payload = JSON.stringify({ fingerprint: this.fingerprint, urls: this.status().addresses })
        udp.send(payload, rinfo.port, rinfo.address)
      })
      udp.bind(DEFAULT_MOBILE_PORT, '0.0.0.0')
      this.udp = udp
    } catch {}
  }
  async stop() {
    if (this.starting) await this.starting
    try { this.udp?.close() } catch {}
    this.udp = undefined
    this.code = undefined; this.codeTries = 0
    if (!this.options.stateFile) this.devices.clear()
    for (const u of this.uploads.values()) await rm(u.folder, { recursive: true, force: true }).catch(() => {})
    this.uploads.clear()
    for (const res of this.clients.keys()) res.end()
    this.clients.clear()
    const server = this.server; this.server = undefined
    server?.closeAllConnections()
    if (server) await new Promise<void>(done => server.close(() => done()))
    return this.status()
  }
  revoke(id: string) {
    for (const [token, d] of this.devices) if (d.id === id) { this.devices.delete(token); for (const [res, t] of this.clients) if (t === token) res.end() }
    this.saveState()
    return this.status()
  }
  publish(channel: string, ...args: unknown[]) {
    if (channel === 'agui') { const [dir, event] = args as [string, Parameters<typeof reduce>[1]]; this.states.set(dir, reduce(this.states.get(dir) || emptyAgentState(), event)) }
    if (!['agui', 'project', 'jobs', 'consent', 'preview:state', 'browser:state', 'notice', 'seek', 'agent:ready'].includes(channel)) return
    for (const [res, token] of this.clients) {
      if (!this.verifyAuth(token)) { res.end(); continue }
      if (res.writableLength > 2 * 1024 * 1024) { res.destroy(); continue }
      res.write(`data: ${JSON.stringify({ channel, args })}\n\n`)
    }
  }
  private async json(req: IncomingMessage) {
    let size = 0; const parts: Buffer[] = []
    for await (const part of req) { size += part.length; if (size > 1024 * 1024) throw new HttpError(413, 'Request is too large'); parts.push(part) }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  private authorizeProject(dir: unknown) {
    if (typeof dir !== 'string' || !this.options.projects().some(p => p.dir === dir)) throw new HttpError(403, 'Open a known AgentShot project')
    return dir
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff')
    if (req.headers.origin) throw new HttpError(403, 'Native clients only')
    const url = new URL(req.url || '/', 'https://localhost')
    const reply = (value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value ?? null)) }
    if (url.pathname === '/discover' && req.method === 'GET') {
      if (!this.code || Date.now() > this.expiresAt) throw new HttpError(404, 'No active pairing code')
      return reply({ fingerprint: this.fingerprint, urls: this.status().addresses })
    }
    if (url.pathname === '/pair' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || ''; const attempt = this.failures.get(ip)
      if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw new HttpError(429, 'Try pairing again in a minute')
      const body = await this.json(req)
      const given = typeof body.code === 'string' ? body.code.replace(/\s+/g, '') : ''
      if (!this.code || Date.now() > this.expiresAt || !given || Buffer.byteLength(given) !== Buffer.byteLength(this.code) || !timingSafeEqual(Buffer.from(given), Buffer.from(this.code))) {
        if (++this.codeTries >= 5) this.code = undefined
        if (this.failures.size > 1000) this.failures.clear()
        this.failures.set(ip, { count: (attempt && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 60_000 })
        throw new HttpError(401, 'Invalid or expired code. Generate a new 6-digit code on the desktop.')
      }
      if (this.devices.size >= 10) throw new HttpError(409, 'Remove a paired device first')
      const token = secret(); this.code = undefined; this.codeTries = 0
      this.devices.set(token, { id: secret(), name: String(body.name || 'Phone').slice(0, 80), expiresAt: Date.now() + 30 * 24 * 60 * 60_000 })
      this.saveState()
      return reply({ token, protocol: 1, fingerprint: this.fingerprint, urls: this.status().addresses, methods: Object.keys(mobileSchemas) })
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '') || ''; const device = this.verifyAuth(token)
    if (!device) throw new HttpError(401, 'Reconnect to your desktop')
    if (url.pathname === '/hello' && req.method === 'GET') {
      return reply({ urls: this.status().addresses })
    }
    if (url.pathname === '/rpc' && req.method === 'POST') {
      const body = await this.json(req); const args = mobileArgs(body.method, body.args)
      if (projectArgument(body.method) && args.length) this.authorizeProject(args[0])
      const result = await this.options.invoke(body.method, args)
      if (body.method === 'agent:attach') return reply(this.states.get(args[0] as string) || emptyAgentState())
      return reply(result)
    }
    if (url.pathname === '/events' && req.method === 'GET') {
      if (this.clients.size >= 20) throw new HttpError(429, 'Too many live connections')
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' }); this.clients.set(res, token)
      for (const [dir, state] of this.states) res.write(`data: ${JSON.stringify({ channel: 'agent:state', args: [dir, state] })}\n\n`)
      const heartbeat = setInterval(() => { if (!this.verifyAuth(token)) res.end(); else res.write(': heartbeat\n\n') }, 15_000)
      res.on('close', () => { clearInterval(heartbeat); this.clients.delete(res) }); return
    }
    if (url.pathname === '/upload/init' && req.method === 'POST') {
      if (this.uploads.size >= 8) throw new HttpError(429, 'Too many active uploads')
      const dir = url.searchParams.has('project') ? this.authorizeProject(url.searchParams.get('project')) : undefined
      const name = url.searchParams.get('name') || 'upload.mp4'
      if (!/^[^/\\\x00-\x1f]{1,180}$/.test(name) || name.startsWith('.') || name.includes(':')) throw new HttpError(400, 'Invalid file name')
      const size = Number(url.searchParams.get('size') ?? req.headers['x-upload-length'])
      if (!Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw new HttpError(413, 'Upload a file between 1 byte and 4 GB')
      const folder = await mkdtemp(join(tmpdir(), 'manul-upload-'))
      const file = join(folder, name)
      await writeFile(file, new Uint8Array(0), { mode: 0o600 })
      const id = secret()
      this.uploads.set(id, { id, folder, file, dir, name, size, offset: 0, busy: false })
      return reply({ id, offset: 0, size })
    }
    if (url.pathname === '/upload' && req.method === 'GET' && url.searchParams.has('id')) {
      const u = this.uploads.get(url.searchParams.get('id') || '')
      if (!u) throw new HttpError(404, 'Upload session not found')
      return reply({ id: u.id, offset: u.offset, size: u.size })
    }
    if (url.pathname === '/upload' && req.method === 'PATCH') {
      const u = this.uploads.get(url.searchParams.get('id') || '')
      if (!u) throw new HttpError(404, 'Upload session not found')
      if (u.busy) throw new HttpError(409, 'Upload chunk already in progress')
      const offset = Number(url.searchParams.get('offset') ?? req.headers['upload-offset'] ?? 0)
      if (!Number.isSafeInteger(offset) || offset !== u.offset) throw new HttpError(409, `Expected offset ${u.offset}`)
      const rem = u.size - u.offset
      u.busy = true
      try {
        let received = 0
        const limit = new Transform({ transform(chunk, _enc, cb) { received += chunk.length; cb(received > rem ? new Error('Upload too large') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(u.file, { flags: 'a', mode: 0o600 }))
        u.offset += received
        if (u.offset < u.size) return reply({ id: u.id, done: false, offset: u.offset, size: u.size })
        this.uploads.delete(u.id)
        try {
          const result = await this.options.importFile(u.file, u.dir)
          return reply({ id: u.id, done: true, offset: u.offset, size: u.size, result })
        } finally {
          await rm(u.folder, { recursive: true, force: true }).catch(() => {})
        }
      } finally { u.busy = false }
    }
    if (url.pathname === '/upload' && req.method === 'POST') {
      if (this.activeUploads >= 2) throw new HttpError(429, 'Wait for the current upload')
      const dir = url.searchParams.has('project') ? this.authorizeProject(url.searchParams.get('project')) : undefined
      const name = url.searchParams.get('name') || 'upload.mp4'
      if (!/^[^/\\\x00-\x1f]{1,180}$/.test(name) || name.startsWith('.') || name.includes(':')) throw new HttpError(400, 'Invalid file name')
      const size = Number(req.headers['content-length'])
      if (!Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw new HttpError(413, 'Upload a file between 1 byte and 4 GB')
      this.activeUploads++; let folder: string | undefined
      try {
        folder = await mkdtemp(join(tmpdir(), 'manul-mobile-'))
        const file = join(folder, name); let received = 0
        const limit = new Transform({ transform(chunk, _enc, cb) { received += chunk.length; cb(received > size ? new Error('Upload too large') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
        if (received !== size) throw new HttpError(400, 'Incomplete upload')
        const result = await this.options.importFile(file, dir)
        await rm(folder, { recursive: true, force: true }); folder = undefined
        return reply(result)
      } finally { this.activeUploads--; if (folder) await rm(folder, { recursive: true, force: true }) }
    }
    if (url.pathname === '/media' && (req.method === 'GET' || req.method === 'HEAD')) {
      const dir = this.authorizeProject(url.searchParams.get('project')); const file = await artifactPath(dir, url.searchParams.get('file') || ''); const size = (await stat(file)).size
      const mime: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
      res.setHeader('content-type', mime[extname(file).toLowerCase()] || 'application/octet-stream'); res.setHeader('accept-ranges', 'bytes')
      let start = 0, end = size - 1
      if (req.headers.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range)
        start = match?.[1] ? Number(match[1]) : Math.max(0, size - Number(match?.[2])); end = match?.[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1
        if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return }
        res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${end}/${size}`)
      }
      res.setHeader('content-length', String(Math.max(0, end - start + 1)))
      if (req.method === 'HEAD' || !size) { res.end(); return }
      await pipeline(createReadStream(file, { start, end }), res); return
    }
    if (url.pathname === '/project/manifest' && req.method === 'GET') {
      const dir = this.authorizeProject(url.searchParams.get('project'))
      return reply({ dir, files: await walkProjectFiles(dir) })
    }
    if (url.pathname === '/project/file' && req.method === 'GET') {
      const dir = this.authorizeProject(url.searchParams.get('project'))
      const file = await syncFilePath(dir, url.searchParams.get('file') || '', true)
      const s = await stat(file)
      res.setHeader('content-type', 'application/octet-stream')
      res.setHeader('content-length', String(s.size))
      await pipeline(createReadStream(file), res)
      return
    }
    if (url.pathname === '/project/file' && req.method === 'POST') {
      let dir = url.searchParams.get('project') || ''
      if (dir) {
        dir = this.authorizeProject(dir)
      } else {
        const slug = url.searchParams.get('slug') || ''
        const root = this.options.projectsRoot?.()
        if (!root || !/^[a-zA-Z0-9._-]{1,120}$/.test(slug) || slug.startsWith('.')) throw new HttpError(400, 'Invalid project slug')
        dir = join(root, slug)
        await mkdir(dir, { recursive: true })
      }
      const rel = url.searchParams.get('file') || ''
      const target = await syncFilePath(dir, rel, false)
      await mkdir(dirname(target), { recursive: true })
      const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
      await pipeline(req, createWriteStream(tmp, { mode: 0o600 }))
      if (rel === 'project.json') {
        const parsed = JSON.parse(await readFile(tmp, 'utf8')) as Record<string, unknown>
        parsed.dir = dir
        await writeFile(tmp, JSON.stringify(parsed, null, 1))
      }
      await rename(tmp, target)
      if (rel === 'project.json') await this.options.onProjectSynced?.(dir)
      return reply({ dir, file: rel })
    }
    if (url.pathname === '/gallery' && req.method === 'GET') {
      const src = url.searchParams.get('url') || ''
      if (!src.startsWith('manul://gallery/')) throw new HttpError(400, 'Invalid gallery media')
      const response = this.options.galleryFile(src, req.headers.range)
      res.writeHead(response.status, Object.fromEntries(response.headers))
      if (response.body) await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), res)
      else res.end()
      return
    }
    throw new HttpError(404, 'Unknown bridge route')
  }
}


async function syncFilePath(dir: string, rel: string, mustExist: boolean): Promise<string> {
  const parts = rel.split('/')
  if (!rel || rel.startsWith('/') || rel.includes('\\') || rel.includes('\0') || parts.some(p => !p || p === '.' || p === '..' || p.endsWith('.tmp'))) {
    throw new HttpError(400, 'Invalid project file path')
  }
  const root = await realpath(dir)
  const target = resolve(root, ...parts)
  const back = relative(root, target)
  if (!back || back.startsWith('..') || isAbsolute(back)) throw new HttpError(400, 'Invalid project file path')
  if (mustExist) {
    const real = await realpath(target).catch(() => '')
    if (!real || relative(root, real).startsWith('..')) throw new HttpError(404, 'File not found')
    return real
  }
  return target
}

export async function walkProjectFiles(dir: string): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  const root = await realpath(dir)
  const out: { path: string; size: number; mtimeMs: number }[] = []
  async function walk(cur: string, prefix: string) {
    const entries = await readdir(cur, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (e.name.endsWith('.tmp') || e.name === '.DS_Store') continue
      const abs = join(cur, e.name)
      const rel = prefix ? posix.join(prefix, e.name) : e.name
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        await walk(abs, rel)
      } else if (e.isFile()) {
        const s = await stat(abs).catch(() => null)
        if (s) out.push({ path: rel, size: s.size, mtimeMs: Math.floor(s.mtimeMs) })
      }
    }
  }
  await walk(root, '')
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
