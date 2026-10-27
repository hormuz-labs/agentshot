// Optional TLS bridge. Pairing is explicit on the desktop; paired devices persist (30 days) until revoked.
import { createServer, type Server } from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createHmac, randomBytes, randomInt, timingSafeEqual, X509Certificate } from 'node:crypto'
import { createSocket, type Socket as UdpSocket } from 'node:dgram'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { tmpdir, networkInterfaces } from 'node:os'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { generate } from 'selfsigned'
import { artifactPath } from './artifacts'
import { mobileArgs, mobileSchemas, projectArgument } from './mobile-contract'
import { emptyAgentState, reduce, type AgentState } from '../shared/agui-state'
import { SpaceError } from './user-space'
import { forPhone } from './explain'
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
  /** A cloud worker (pool): leased to one person at a time, each seeing only the projects they made here. */
  pool?: boolean
  /** Asks the account now who leases this cloud worker (a heartbeat), for a lease that began since the last one. */
  refreshLease?: () => Promise<void>
  /** A stateless cloud worker: whose space it has open (a lessee is served only once it's theirs), and how much room
   *  is left in it (user-space.ts). */
  session?: () => string | undefined
  quota?: { ensureRoom(bytes: number): void; add(bytes: number): void }
  /** A small picture of a project file (a frame of a video, or the photo itself), for the phone's lists. */
  thumbnail?: (dir: string, rel: string) => Promise<string | undefined>
  /** A voice note recorded on the phone, as text (the computer's own speech recognition). */
  voiceNote?: (file: string, dir: string) => Promise<string>
  /** Work still running on this computer (the agent, a render or another job): a lease isn't idle while it runs. */
  busy?: () => boolean
}
type PersistedBridgeState = {
  key: string
  cert: string
  workerSecret: string
  devices: [string, { id: string; name: string; expiresAt: number }][]
  /** On a cloud worker: which lessee made each project (dir → account user). */
  owners?: [string, string][]
}
type UploadSession = { id: string; folder: string; file: string; dir?: string; name: string; size: number; offset: number; busy: boolean; touched: number }
export const DEFAULT_MOBILE_PORT = 47821
/** On a cloud worker, the worker's own settings: a lessee neither reads nor changes them. */
const WORKER_PRIVATE = /^(keys:set|memory:|skills:(enable|profile|newProfile)|tools:(install|remove)|browser:)/
/** Calls that make a project, which then belongs to the lessee who made it. */
const CREATES_PROJECT = new Set(['project:create', 'project:createMotion'])
/** What starts new work that writes into the project (refused for a cloud lessee whose space is full). */
const WRITES = new Set(['project:create', 'project:createMotion', 'agent:send', 'timeline:edit', 'mobile:export', 'export:run', 'clip:overlay', 'clip:save',
  'clip:insert', 'clip:move', 'clip:render', 'demo:create', 'mix:speech'])
/** An upload nobody has sent a chunk to for this long no longer counts as work running; after [UPLOAD_GONE], it's dropped. */
const UPLOAD_IDLE = 10 * 60_000, UPLOAD_GONE = 60 * 60_000
const secret = () => randomBytes(32).toString('base64url')
/** What each request was for (an RPC method, or "upload"), so a failure can say what didn't happen. */
const doingOf = new WeakMap<IncomingMessage, string>()
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
export function isTailscale(ip: string) {
  const p = ip.split('.').map(Number)
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
}
export function reachableIps(ifaces = networkInterfaces()) {
  const ips = Object.values(ifaces).flat().filter(n => n?.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')).map(n => n!.address)
  return [...new Set([...ips.filter(ip => !isTailscale(ip)), ...ips.filter(isTailscale)])]
}
export type MobileStatus = { running: boolean; addresses: string[]; tailscale?: string; mesh?: string; fingerprint?: string; code?: string; expiresAt?: number; devices: { id: string; name: string }[]
  /** phones and computers signed in to the same AgentShot account, connected in the last two minutes */
  signedIn: { name: string; lastSeen: number }[] }
/** What Settings → Mobile shows: the bridge, and whether signed-in phones can find this computer through the account. */
export type MobileState = MobileStatus & { account: { signedIn: boolean; email?: string; phones: boolean } }
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
  private signedIn = new Map<string, { name: string; lastSeen: number }>()
  /** On a cloud worker: who holds the lease now (from the account's answer to the heartbeat), and what each made. */
  private lease?: { userId: string; until: number }
  /** When the person leasing this worker last asked it something. */
  private lastActive = Date.now()
  private owners = new Map<string, string>()
  private clients = new Map<ServerResponse, string>()
  private states = new Map<string, AgentState>()
  private failures = new Map<string, { count: number; until: number }>()
  private activeUploads = 0
  private starting?: Promise<MobileStatus>
  constructor(private options: Options, private ips: () => string[] = reachableIps) {}
  status(): MobileStatus {
    const list = this.ips()
    const mesh = this.server ? this.options.meshIp?.() : undefined
    // the mesh node always listens on 47821 (the Headscale ACL allows only that port) and forwards to wherever we bound
    const addresses = this.server ? list.map(ip => `https://${ip}:${ip === mesh ? DEFAULT_MOBILE_PORT : this.port}`) : []
    return { running: !!this.server, addresses, tailscale: list.find(ip => isTailscale(ip) && ip !== mesh), mesh, fingerprint: this.fingerprint, code: this.code, expiresAt: this.expiresAt, devices: [...this.devices.values()].map(({ id, name }) => ({ id, name })), signedIn: this.recentSignedIn() }
  }
  private recentSignedIn() {
    // seen lately, or still holding its live event stream open
    const since = Date.now() - 2 * 60_000, live = new Set(this.clients.values())
    return [...this.signedIn].filter(([token, d]) => d.lastSeen > since || live.has(token)).map(([, { name, lastSeen }]) => ({ name, lastSeen }))
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
      if (Array.isArray(raw.owners)) this.owners = new Map(raw.owners)
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
        owners: [...this.owners.entries()],
      }
      writeFileSync(this.options.stateFile, JSON.stringify(data, null, 2), { mode: 0o600 })
    } catch {}
  }
  /** On a cloud worker, the lease the account reports (heartbeat): cloud tokens of anyone else stop working. */
  setLease(lease?: { userId: string; until: number }) {
    const before = this.lease?.userId
    this.lease = lease && lease.until > Date.now() ? lease : undefined
    if (this.lease?.userId !== before) {
      this.lastActive = Date.now() // a new lease starts fresh
      for (const [res, token] of this.clients) if (!this.verifyAuth(token)) res.end()
    }
    return this.lease?.userId !== before
  }
  private verifyAuth(token: string): { id: string; name: string; expiresAt: number; lessee?: string } | undefined {
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
    // a cloud lease (pool:<user>) is good on a cloud worker, and only while the account says that person holds it
    const scope = Buffer.from(m[2], 'base64url').toString('utf8')
    if (scope.startsWith('pool:')) {
      const lessee = scope.slice(5)
      if (!this.options.pool || this.lease?.userId !== lessee || this.lease.until < Date.now()) return undefined
      return { id: `lease:${m[2]}`, name: 'Cloud lessee', expiresAt: Math.min(expiresAt, this.lease.until), lessee }
    }
    return { id: `lease:${m[2]}`, name: 'Leased client', expiresAt }
  }
  /** A cloud token from someone the worker doesn't know holds it yet: the lease may have just begun (the heartbeat,
   *  every 30 s, hasn't told it). Ask the account now, at most every few seconds, and look again. */
  private leaseCheck?: Promise<void>
  private leaseCheckedAt = 0
  private async leaseBegun(token: string) {
    if (!this.options.pool || !this.options.refreshLease || !token.startsWith('lease.')) return undefined
    if (!this.leaseCheck && Date.now() - this.leaseCheckedAt > 3_000) {
      this.leaseCheckedAt = Date.now()
      this.leaseCheck = this.options.refreshLease().catch(() => {}).finally(() => { this.leaseCheck = undefined })
    }
    await this.leaseCheck
    return this.verifyAuth(token)
  }
  /** For the heartbeat: how long the leasing person has been away, and whether anything still runs for them (the
   *  account frees a lease nobody has used for a while, never one with work running). Undefined when not leased. */
  activity(): { user: string; idleMs: number; busy: boolean } | undefined {
    if (!this.options.pool || !this.lease) return undefined
    void this.dropStaleUploads()
    // an upload the phone walked away from (half sent, never finished) doesn't keep the spot
    const uploading = [...this.uploads.values()].some(u => u.busy || Date.now() - u.touched < UPLOAD_IDLE) || this.activeUploads > 0
    const busy = uploading || [...this.states.values()].some(s => s.busy) || !!this.options.busy?.()
    // work running counts as use: the idle time starts when it ends, so a render that took an hour isn't freed the
    // moment it's done, before the person has seen it
    if (busy) this.lastActive = Date.now()
    return { user: this.lease.userId, idleMs: Math.max(0, Date.now() - this.lastActive), busy }
  }
  /** Forgets uploads nobody finished within the hour, and their half-sent files. */
  private async dropStaleUploads() {
    for (const u of [...this.uploads.values()]) {
      if (u.busy || Date.now() - u.touched < UPLOAD_GONE) continue
      this.uploads.delete(u.id)
      await rm(u.folder, { recursive: true, force: true }).catch(() => {})
    }
  }
  /** A cloud lessee's: made by them here. Anyone else's token sees everything (it's their own computer). */
  private mine(dir: unknown, lessee?: string) {
    if (!lessee) return true
    if (typeof dir !== 'string') return false
    // a stateless worker: everything in the open space is its person's, whichever worker made it
    const root = this.options.projectsRoot?.()
    if (this.options.session) return this.options.session() === lessee && !!root && resolve(dir).startsWith(resolve(root) + sep)
    return this.owners.get(dir) === lessee
  }
  private claim(result: unknown, lessee?: string) {
    const dir = result && typeof result === 'object' ? (result as { dir?: unknown }).dir : undefined
    if (lessee && typeof dir === 'string' && !this.owners.has(dir)) { this.owners.set(dir, lessee); this.saveState() }
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
        const expected = error instanceof HttpError || error instanceof SpaceError
        // no AI set up on this computer: the phone offers AgentShot credits or the person's own key
        if ((error as { code?: string })?.code === 'needs-key') {
          res.writeHead(409, { 'content-type': 'application/json', 'cache-control': 'no-store' })
          res.end(JSON.stringify({ error: 'AgentShot on your computer has no AI to edit with yet.', code: 'needs-key' }))
          return
        }
        if (!expected) console.warn('Mobile bridge request failed', error instanceof Error ? error.message : 'unknown')
        // anything else in words the person can act on (what didn't happen, and why), never the raw error: no paths
        // or internals of this computer reach the phone
        res.writeHead(expected ? error.status : 400, { 'content-type': 'application/json', 'cache-control': 'no-store' })
        res.end(JSON.stringify({ error: expected ? error.message : forPhone(doingOf.get(req), error) }))
      })
    })
    server.requestTimeout = 30 * 60_000; server.headersTimeout = 15_000
    await new Promise<void>((ok, fail) => {
      const bind = (p: number) => {
        server.once('error', (err: NodeJS.ErrnoException) => (err.code === 'EADDRINUSE' && p !== 0 ? bind(0) : fail(err)))
        server.listen(p, '0.0.0.0', () => { server.removeAllListeners('error'); ok() })
      }
      // a worker that restarts (a stateless cloud worker switching spaces) keeps its port: MANUL_BRIDGE_PORT
      bind(Number(process.env.MANUL_BRIDGE_PORT) || DEFAULT_MOBILE_PORT)
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
  /** What a cloud lessee hears (undefined: nothing): their own projects' news and the questions about them; not the
   *  worker's browser, notices or anyone's jobs. */
  private forLessee(channel: string, args: unknown[], lessee: string): unknown[] | undefined {
    const first = args[0]
    if (channel === 'consent' && Array.isArray(first)) return [first.filter(c => this.mine((c as { project?: unknown })?.project, lessee)), ...args.slice(1)]
    if (channel === 'jobs' || channel === 'browser:state' || channel === 'notice') return undefined
    const dir = typeof first === 'string' ? first : (first as { dir?: unknown } | undefined)?.dir
    return this.mine(dir, lessee) ? args : undefined
  }
  publish(channel: string, ...args: unknown[]) {
    if (channel === 'agui') { const [dir, event] = args as [string, Parameters<typeof reduce>[1]]; this.states.set(dir, reduce(this.states.get(dir) || emptyAgentState(), event)) }
    // the agent working, or a job moving (and ending), is use too, even between two heartbeats
    if (channel === 'agui' || channel === 'jobs') this.lastActive = Date.now()
    if (!['agui', 'project', 'jobs', 'consent', 'preview:state', 'browser:state', 'notice', 'seek', 'agent:ready'].includes(channel)) return
    for (const [res, token] of this.clients) {
      const device = this.verifyAuth(token)
      if (!device) { res.end(); continue }
      const sent = device.lessee ? this.forLessee(channel, args, device.lessee) : args
      if (!sent) continue
      if (res.writableLength > 2 * 1024 * 1024) { res.destroy(); continue }
      res.write(`data: ${JSON.stringify({ channel, args: sent })}\n\n`)
    }
  }
  private async json(req: IncomingMessage) {
    let size = 0; const parts: Buffer[] = []
    for await (const part of req) { size += part.length; if (size > 1024 * 1024) throw new HttpError(413, 'Request is too large'); parts.push(part) }
    return JSON.parse(Buffer.concat(parts).toString('utf8'))
  }
  private authorizeProject(dir: unknown, lessee?: string) {
    if (typeof dir !== 'string' || !this.options.projects().some(p => p.dir === dir) || !this.mine(dir, lessee)) throw new HttpError(403, 'Open a known AgentShot project')
    // a lessee's project is inside the projects root, links resolved: their space, never a way out of it
    const root = this.options.projectsRoot?.()
    if (lessee && root) {
      let inside = false
      try { const base = realpathSync(root), real = realpathSync(dir); inside = real.startsWith(base + sep) } catch {}
      if (!inside) throw new HttpError(403, 'Open a known AgentShot project')
    }
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
    const token = req.headers.authorization?.replace(/^Bearer /, '') || ''; const device = this.verifyAuth(token) ?? await this.leaseBegun(token)
    if (!device) throw new HttpError(401, 'Reconnect to your desktop')
    if (device.lessee) this.lastActive = Date.now()
    // leased, but the worker is still opening this person's space (it restarts into it): wait, don't reconnect
    if (device.lessee && this.options.session && this.options.session() !== device.lessee) {
      throw new HttpError(503, 'Opening your space on this worker. Try again in a moment.')
    }
    // signed in to the same account (an account lease, not a pairing): remember it for Settings → Mobile
    if (device.id.startsWith('lease:')) {
      const name = String(req.headers['x-agentshot-device'] || 'Signed-in device').slice(0, 80)
      this.signedIn.set(token, { name, lastSeen: Date.now() })
    }
    if (url.pathname === '/hello' && req.method === 'GET') {
      return reply({ urls: this.status().addresses })
    }
    // "Disconnect this device" on the phone: it forgets the desktop, and the desktop forgets it (and its live streams)
    if (url.pathname === '/unpair' && req.method === 'POST') {
      this.devices.delete(token); this.saveState()
      for (const [stream, t] of this.clients) if (t === token) stream.end()
      // a lessee done with this cloud worker (it gave the lease back): ask the account now, so the worker closes the
      // space at once and another worker can open it, instead of at the next heartbeat
      if (device.lessee) void this.options.refreshLease?.().catch(() => {})
      return reply(null)
    }
    if (url.pathname === '/rpc' && req.method === 'POST') {
      const body = await this.json(req); doingOf.set(req, String(body.method)); const args = mobileArgs(body.method, body.args)
      const lessee = device.lessee
      // the worker's own settings aren't a lessee's to read or change
      if (lessee && WORKER_PRIVATE.test(body.method)) throw new HttpError(403, 'Not available on a cloud worker')
      if (projectArgument(body.method) && args.length) this.authorizeProject(args[0], lessee)
      // a full space takes nothing new: no new work that writes (an edit, a render, the agent), until there's room
      if (lessee && WRITES.has(body.method)) this.options.quota?.ensureRoom(0)
      const result = await this.options.invoke(body.method, args)
      if (lessee) {
        if (CREATES_PROJECT.has(body.method)) this.claim(result, lessee)
        if (body.method === 'project:recent' && Array.isArray(result)) return reply(result.filter(r => this.mine((r as { dir?: unknown })?.dir, lessee)))
      }
      if (body.method === 'agent:attach') return reply(this.states.get(args[0] as string) || emptyAgentState())
      return reply(result)
    }
    if (url.pathname === '/events' && req.method === 'GET') {
      if (this.clients.size >= 20) throw new HttpError(429, 'Too many live connections')
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' }); this.clients.set(res, token)
      for (const [dir, state] of this.states) if (this.mine(dir, device.lessee)) res.write(`data: ${JSON.stringify({ channel: 'agent:state', args: [dir, state] })}\n\n`)
      const heartbeat = setInterval(() => { if (!this.verifyAuth(token)) res.end(); else res.write(': heartbeat\n\n') }, 15_000)
      res.on('close', () => { clearInterval(heartbeat); this.clients.delete(res) }); return
    }
    if (url.pathname.startsWith('/upload')) doingOf.set(req, 'upload')
    if (url.pathname === '/upload/init' && req.method === 'POST') {
      await this.dropStaleUploads()
      if (this.uploads.size >= 8) throw new HttpError(429, 'Too many active uploads')
      const dir = url.searchParams.has('project') ? this.authorizeProject(url.searchParams.get('project'), device.lessee) : undefined
      const name = url.searchParams.get('name') || 'upload.mp4'
      if (!/^[^/\\\x00-\x1f]{1,180}$/.test(name) || name.startsWith('.') || name.includes(':')) throw new HttpError(400, 'Invalid file name')
      const size = Number(url.searchParams.get('size') ?? req.headers['x-upload-length'])
      if (!Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw new HttpError(413, 'Upload a file between 1 byte and 4 GB')
      if (device.lessee) this.options.quota?.ensureRoom(size)
      const folder = await mkdtemp(join(tmpdir(), 'agentshot-upload-'))
      const file = join(folder, name)
      await writeFile(file, new Uint8Array(0), { mode: 0o600 })
      const id = secret()
      this.uploads.set(id, { id, folder, file, dir, name, size, offset: 0, busy: false, touched: Date.now() })
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
      u.busy = true; u.touched = Date.now()
      try {
        let received = 0
        const limit = new Transform({ transform(chunk, _enc, cb) { received += chunk.length; cb(received > rem ? new Error('Upload too large') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(u.file, { flags: 'a', mode: 0o600 }))
        u.offset += received; u.touched = Date.now()
        if (u.offset < u.size) return reply({ id: u.id, done: false, offset: u.offset, size: u.size })
        this.uploads.delete(u.id)
        try {
          const result = await this.options.importFile(u.file, u.dir)
          this.claim(result, device.lessee)
          if (device.lessee) this.options.quota?.add(u.size)
          return reply({ id: u.id, done: true, offset: u.offset, size: u.size, result })
        } finally {
          await rm(u.folder, { recursive: true, force: true }).catch(() => {})
        }
      } finally { u.busy = false }
    }
    if (url.pathname === '/upload' && req.method === 'POST') {
      if (this.activeUploads >= 2) throw new HttpError(429, 'Wait for the current upload')
      const dir = url.searchParams.has('project') ? this.authorizeProject(url.searchParams.get('project'), device.lessee) : undefined
      const name = url.searchParams.get('name') || 'upload.mp4'
      if (!/^[^/\\\x00-\x1f]{1,180}$/.test(name) || name.startsWith('.') || name.includes(':')) throw new HttpError(400, 'Invalid file name')
      const size = Number(req.headers['content-length'])
      if (!Number.isSafeInteger(size) || size <= 0 || size > 4 * 1024 ** 3) throw new HttpError(413, 'Upload a file between 1 byte and 4 GB')
      if (device.lessee) this.options.quota?.ensureRoom(size)
      this.activeUploads++; let folder: string | undefined
      try {
        folder = await mkdtemp(join(tmpdir(), 'agentshot-mobile-'))
        const file = join(folder, name); let received = 0
        const limit = new Transform({ transform(chunk, _enc, cb) { received += chunk.length; cb(received > size ? new Error('Upload too large') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
        if (received !== size) throw new HttpError(400, 'Incomplete upload')
        const result = await this.options.importFile(file, dir)
        this.claim(result, device.lessee)
        if (device.lessee) this.options.quota?.add(size)
        await rm(folder, { recursive: true, force: true }); folder = undefined
        return reply(result)
      } finally { this.activeUploads--; if (folder) await rm(folder, { recursive: true, force: true }) }
    }
    if (url.pathname === '/voice' && req.method === 'POST') {
      doingOf.set(req, 'voice')
      const dir = this.authorizeProject(url.searchParams.get('project'), device.lessee)
      const size = Number(req.headers['content-length'])
      // a note, not a recording session: up to about fifteen minutes of speech
      if (!Number.isSafeInteger(size) || size <= 0 || size > 50 * 1024 ** 2) throw new HttpError(413, 'Keep a voice note under fifteen minutes.')
      if (!this.options.voiceNote) throw new HttpError(501, 'This computer can’t turn voice notes into text yet. Update AgentShot there.')
      const folder = await mkdtemp(join(tmpdir(), 'agentshot-voice-'))
      try {
        const file = join(folder, 'note.m4a'); let received = 0
        const limit = new Transform({ transform(chunk, _enc, cb) { received += chunk.length; cb(received > size ? new Error('Upload too large') : null, chunk) } })
        await pipeline(req, limit, createWriteStream(file, { flags: 'wx', mode: 0o600 }))
        if (received !== size) throw new HttpError(400, 'The voice note didn’t arrive whole. Try again.')
        return reply({ text: await this.options.voiceNote(file, dir) })
      } finally { await rm(folder, { recursive: true, force: true }).catch(() => {}) }
    }
    if (url.pathname === '/thumbnail' && req.method === 'GET') {
      const dir = this.authorizeProject(url.searchParams.get('project'), device.lessee)
      const rel = url.searchParams.get('file') || ''
      // a file of this project's, by its project-relative path: never a way elsewhere
      await artifactPath(dir, rel)
      const file = await this.options.thumbnail?.(dir, rel)
      if (!file) throw new HttpError(404, 'No picture for this file')
      const ext = extname(file).toLowerCase()
      res.writeHead(200, {
        'content-type': ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg',
        'content-length': String((await stat(file)).size),
        'cache-control': 'private, max-age=3600',
      })
      await pipeline(createReadStream(file), res); return
    }
    if (url.pathname === '/media' && (req.method === 'GET' || req.method === 'HEAD')) {
      const dir = this.authorizeProject(url.searchParams.get('project'), device.lessee); const file = await artifactPath(dir, url.searchParams.get('file') || ''); const size = (await stat(file)).size
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
      const dir = this.authorizeProject(url.searchParams.get('project'), device.lessee)
      return reply({ dir, files: await walkProjectFiles(dir) })
    }
    if (url.pathname === '/project/file' && req.method === 'GET') {
      const dir = this.authorizeProject(url.searchParams.get('project'), device.lessee)
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
        dir = this.authorizeProject(dir, device.lessee)
      } else {
        const slug = url.searchParams.get('slug') || ''
        const root = this.options.projectsRoot?.()
        if (!root || !/^[a-zA-Z0-9._-]{1,120}$/.test(slug) || slug.startsWith('.')) throw new HttpError(400, 'Invalid project slug')
        dir = join(root, slug)
        // someone else's project here isn't a lessee's to write into
        if (device.lessee && this.owners.has(dir) && !this.mine(dir, device.lessee)) throw new HttpError(403, 'Open a known AgentShot project')
        await mkdir(dir, { recursive: true })
        this.claim({ dir }, device.lessee)
      }
      const rel = url.searchParams.get('file') || ''
      if (device.lessee && this.options.quota) {
        const length = Number(req.headers['content-length'])
        if (!Number.isSafeInteger(length) || length < 0) throw new HttpError(411, 'Send the file\'s length')
        this.options.quota.ensureRoom(length)
      }
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
      if (device.lessee) this.options.quota?.add((await stat(target)).size)
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
