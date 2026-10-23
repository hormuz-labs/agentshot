// Optional TLS bridge. Pairing is explicit on the desktop; tokens expire on stop/quit.
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual, X509Certificate } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
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
}
const secret = () => randomBytes(32).toString('base64url')
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b))
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export type MobileStatus = { running: boolean; addresses: string[]; fingerprint?: string; code?: string; expiresAt?: number; devices: { id: string; name: string }[] }
export class MobileBridge {
  private server?: Server
  private fingerprint?: string
  private code?: string
  private expiresAt = 0
  private port = 0
  private devices = new Map<string, { id: string; name: string; expiresAt: number }>()
  private clients = new Map<ServerResponse, string>()
  private states = new Map<string, AgentState>()
  private failures = new Map<string, { count: number; until: number }>()
  private activeUploads = 0
  private starting?: Promise<MobileStatus>
  constructor(private options: Options) {}
  status(): MobileStatus {
    const addresses = Object.values(networkInterfaces()).flat().filter(n => n?.family === 'IPv4' && !n.internal).map(n => `https://${n!.address}:${this.port}`)
    return { running: !!this.server, addresses: this.server ? addresses : [], fingerprint: this.fingerprint, code: this.code, expiresAt: this.expiresAt, devices: [...this.devices.values()].map(({ id, name }) => ({ id, name })) }
  }
  start(): Promise<MobileStatus> {
    if (this.starting) return this.starting
    this.starting = this.listen().finally(() => { this.starting = undefined })
    return this.starting
  }
  private async listen() {
    if (this.server) { this.code = secret(); this.expiresAt = Date.now() + 5 * 60_000; return this.status() }
    const pem = await generate([{ name: 'commonName', value: 'Manul Mobile Bridge' }], { keySize: 2048, algorithm: 'sha256', notAfterDate: new Date(Date.now() + 30 * 86400_000) })
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
    await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '0.0.0.0', () => { server.removeListener('error', fail); ok() }) })
    this.server = server; this.port = (server.address() as { port: number }).port
    this.fingerprint = new X509Certificate(pem.cert).fingerprint256.replaceAll(':', '').toLowerCase()
    this.code = secret(); this.expiresAt = Date.now() + 5 * 60_000
    return this.status()
  }
  async stop() {
    if (this.starting) await this.starting
    this.code = undefined; this.devices.clear()
    for (const res of this.clients.keys()) res.end()
    this.clients.clear()
    const server = this.server; this.server = undefined
    server?.closeAllConnections()
    if (server) await new Promise<void>(done => server.close(() => done()))
    return this.status()
  }
  revoke(id: string) {
    for (const [token, d] of this.devices) if (d.id === id) { this.devices.delete(token); for (const [res, t] of this.clients) if (t === token) res.end() }
    return this.status()
  }
  publish(channel: string, ...args: unknown[]) {
    if (channel === 'agui') { const [dir, event] = args as [string, Parameters<typeof reduce>[1]]; this.states.set(dir, reduce(this.states.get(dir) || emptyAgentState(), event)) }
    if (!['agui', 'project', 'jobs', 'consent', 'preview:state', 'browser:state', 'notice', 'seek', 'agent:ready'].includes(channel)) return
    for (const [res, token] of this.clients) {
      if (!this.devices.has(token)) { res.end(); continue }
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
    if (typeof dir !== 'string' || !this.options.projects().some(p => p.dir === dir)) throw new HttpError(403, 'Open a known Manul project')
    return dir
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff')
    if (req.headers.origin) throw new HttpError(403, 'Native clients only')
    const url = new URL(req.url || '/', 'https://localhost')
    const reply = (value: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value ?? null)) }
    if (url.pathname === '/pair' && req.method === 'POST') {
      const ip = req.socket.remoteAddress || ''; const attempt = this.failures.get(ip)
      if (attempt && attempt.until > Date.now() && attempt.count >= 5) throw new HttpError(429, 'Try pairing again in a minute')
      const body = await this.json(req)
      if (!this.code || Date.now() > this.expiresAt || typeof body.code !== 'string' || !equal(body.code, this.code)) {
        if (this.failures.size > 1000) this.failures.clear()
        this.failures.set(ip, { count: (attempt && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 60_000 })
        throw new HttpError(401, 'Pairing expired or incorrect. Get a new connection code on the desktop.')
      }
      if (this.devices.size >= 10) throw new HttpError(409, 'Remove a paired device first')
      const token = secret(); this.code = undefined
      this.devices.set(token, { id: secret(), name: String(body.name || 'Phone').slice(0, 80), expiresAt: Date.now() + 30 * 24 * 60 * 60_000 })
      return reply({ token, protocol: 1, methods: Object.keys(mobileSchemas) })
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '') || ''; const device = this.devices.get(token)
    if (!device || device.expiresAt < Date.now()) { this.devices.delete(token); throw new HttpError(401, 'Reconnect to your desktop') }
    if (url.pathname === '/rpc' && req.method === 'POST') {
      const body = await this.json(req); const args = mobileArgs(body.method, body.args)
      if (projectArgument(body.method) && args.length) this.authorizeProject(args[0])
      return reply(await this.options.invoke(body.method, args))
    }
    if (url.pathname === '/events' && req.method === 'GET') {
      if (this.clients.size >= 20) throw new HttpError(429, 'Too many live connections')
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' }); this.clients.set(res, token)
      for (const [dir, state] of this.states) res.write(`data: ${JSON.stringify({ channel: 'agent:state', args: [dir, state] })}\n\n`)
      const heartbeat = setInterval(() => { if (!this.devices.has(token) || device.expiresAt < Date.now()) res.end(); else res.write(': heartbeat\n\n') }, 15_000)
      res.on('close', () => { clearInterval(heartbeat); this.clients.delete(res) }); return
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
