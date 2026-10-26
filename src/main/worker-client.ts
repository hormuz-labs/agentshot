// Remote Worker client, peer project delta-sync (Mac ↔ Worker), and account/Headscale worker pool discovery.
import { Agent, request as httpsRequest } from 'node:https'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, rename, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { hostname } from 'node:os'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { X509Certificate } from 'node:crypto'
import type { TLSSocket } from 'node:tls'
import { walkProjectFiles, type MobileBridge } from './mobile-bridge'

export type SavedWorker = {
  id: string
  name: string
  urls: string[]
  activeUrl: string
  fingerprint: string
  token: string
  pool?: boolean
  expiresAt?: number
}

export type WorkerClientStatus = {
  connected: boolean
  active?: SavedWorker
  saved: SavedWorker[]
  remoteProjects: string[]
}

type ManifestEntry = { path: string; size: number; mtimeMs: number }

export class WorkerClient {
  private saved = new Map<string, SavedWorker>()
  private activeId?: string
  private remoteDirs = new Set<string>()
  private sseAbort?: AbortController
  private sseTimer?: NodeJS.Timeout

  private tlsAgent = new Agent({ keepAlive: false, maxCachedSessions: 0, rejectUnauthorized: false })
  constructor(
    private opts: {
      stateFile?: string
      projectsRoot: () => string
      onEvent: (channel: string, ...args: unknown[]) => void
      onProjectPulled?: (localDir: string) => Promise<void> | void
    },
  ) {
    this.load()
  }

  private load() {
    if (!this.opts.stateFile || !existsSync(this.opts.stateFile)) return
    try {
      const parsed = JSON.parse(readFileSync(this.opts.stateFile, 'utf8')) as { activeId?: string; saved?: SavedWorker[] }
      if (Array.isArray(parsed.saved)) {
        for (const w of parsed.saved) {
          if (w && typeof w.id === 'string' && typeof w.token === 'string' && typeof w.fingerprint === 'string' && Array.isArray(w.urls) && w.urls.length) {
            this.saved.set(w.id, { ...w, activeUrl: w.activeUrl || w.urls[0] })
          }
        }
      }
      if (parsed.activeId && this.saved.has(parsed.activeId)) this.activeId = parsed.activeId
    } catch {}
  }

  private save() {
    if (!this.opts.stateFile) return
    try {
      mkdirSync(dirname(this.opts.stateFile), { recursive: true })
      writeFileSync(
        this.opts.stateFile,
        JSON.stringify({ activeId: this.activeId, saved: [...this.saved.values()] }, null, 2),
        { mode: 0o600 },
      )
    } catch {}
  }

  status(): WorkerClientStatus {
    const active = this.activeId ? this.saved.get(this.activeId) : undefined
    return {
      connected: !!active,
      active,
      saved: [...this.saved.values()],
      remoteProjects: [...this.remoteDirs],
    }
  }

  active(): SavedWorker | undefined {
    return this.activeId ? this.saved.get(this.activeId) : undefined
  }

  ownsProject(dir: string): boolean {
    return this.remoteDirs.has(dir)
  }

  /** Pair with a worker using a URL/host and a 6-digit pairing code. */
  async pair(input: { url: string; code: string; name?: string }): Promise<WorkerClientStatus> {
    const base = normalizeWorkerUrl(input.url)
    const disc = await this.rawRequest(base, '/discover', { method: 'GET' })
    if (disc.status !== 200) throw new Error(parseError(disc.body, 'Could not discover worker at that address.'))
    const discBody = JSON.parse(disc.body.toString('utf8')) as { fingerprint?: string; urls?: string[] }
    const fingerprint = (discBody.fingerprint || disc.fingerprint || '').toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error('Worker did not provide a valid TLS fingerprint.')
    const paired = await this.rawRequest(base, '/pair', {
      method: 'POST',
      fingerprint,
      body: JSON.stringify({ code: input.code.trim(), name: input.name || hostname() || 'Desktop' }),
    })
    if (paired.status !== 200) throw new Error(parseError(paired.body, 'Invalid or expired pairing code.'))
    const out = JSON.parse(paired.body.toString('utf8')) as { token: string; fingerprint: string; urls?: string[] }
    const urls = Array.isArray(out.urls) && out.urls.length ? out.urls : [base]
    const worker: SavedWorker = {
      id: `worker-${fingerprint.slice(0, 12)}`,
      name: new URL(base).hostname,
      urls: [...new Set([base, ...urls])],
      activeUrl: base,
      fingerprint: out.fingerprint.toLowerCase(),
      token: out.token,
    }
    return this.connect(worker)
  }

  /** Connect to a pre-authenticated worker (from account service discovery, pool lease, or saved list). */
  async connect(worker: Omit<SavedWorker, 'activeUrl'> & { activeUrl?: string }): Promise<WorkerClientStatus> {
    const candidates = [...new Set([worker.activeUrl, ...worker.urls].filter((u): u is string => !!u).map(normalizeWorkerUrl))]
    if (!candidates.length) throw new Error('Worker has no reachable URLs.')
    let reachable: string | undefined
    for (const candidate of candidates) {
      const hello = await this.rawRequest(candidate, '/hello', {
        method: 'GET',
        fingerprint: worker.fingerprint.toLowerCase(),
        token: worker.token,
      }).catch(() => undefined)
      if (hello && hello.status === 200) {
        reachable = candidate
        break
      }
    }
    if (!reachable) throw new Error(`Could not reach worker "${worker.name}" on any address (${candidates.join(', ')}).`)
    const entry: SavedWorker = {
      ...worker,
      urls: candidates,
      activeUrl: reachable,
      fingerprint: worker.fingerprint.toLowerCase(),
    }
    this.saved.set(entry.id, entry)
    this.activeId = entry.id
    this.save()
    await this.refreshProjects().catch(() => {})
    this.startEventStream()
    return this.status()
  }

  disconnect(): WorkerClientStatus {
    this.stopEventStream()
    this.activeId = undefined
    this.remoteDirs.clear()
    this.save()
    return this.status()
  }

  remove(id: string): WorkerClientStatus {
    if (this.activeId === id) this.disconnect()
    this.saved.delete(id)
    this.save()
    return this.status()
  }

  async refreshProjects(): Promise<unknown[]> {
    const list = await this.rpc('project:recent', [])
    if (Array.isArray(list)) {
      this.remoteDirs.clear()
      for (const item of list) {
        if (item && typeof item === 'object' && 'dir' in item && typeof item.dir === 'string') {
          this.remoteDirs.add(item.dir)
        }
      }
      return list
    }
    return []
  }

  async rpc(method: string, args: unknown[]): Promise<unknown> {
    const w = this.active()
    if (!w) throw new Error('No remote worker connected.')
    const res = await this.rawRequest(w.activeUrl, '/rpc', {
      method: 'POST',
      fingerprint: w.fingerprint,
      token: w.token,
      body: JSON.stringify({ method, args }),
    })
    if (res.status !== 200) throw new Error(parseError(res.body, `Worker RPC ${method} failed (${res.status}).`))
    const parsed = JSON.parse(res.body.toString('utf8')) as unknown
    if (parsed && typeof parsed === 'object' && 'dir' in parsed && typeof parsed.dir === 'string') {
      this.remoteDirs.add(parsed.dir)
    }
    return parsed
  }

  /** Upload a local file to the connected worker via resumable chunks. */
  async uploadFile(localPath: string, projectDir?: string, chunkBytes = 8 * 1024 * 1024): Promise<unknown> {
    const w = this.active()
    if (!w) throw new Error('No remote worker connected.')
    const s = await stat(localPath)
    const name = basename(localPath)
    const q = new URLSearchParams({ name, size: String(s.size), ...(projectDir ? { project: projectDir } : {}) })
    const init = await this.rawRequest(w.activeUrl, `/upload/init?${q}`, {
      method: 'POST',
      fingerprint: w.fingerprint,
      token: w.token,
      body: '{}',
    })
    if (init.status !== 200) throw new Error(parseError(init.body, 'Could not start upload to worker.'))
    const { id } = JSON.parse(init.body.toString('utf8')) as { id: string }
    let offset = 0
    while (offset < s.size) {
      const end = Math.min(offset + chunkBytes, s.size) - 1
      const len = end - offset + 1
      const patchQ = new URLSearchParams({ id, offset: String(offset) })
      const chunkRes = await this.rawRequest(w.activeUrl, `/upload?${patchQ}`, {
        method: 'PATCH',
        fingerprint: w.fingerprint,
        token: w.token,
        stream: createReadStream(localPath, { start: offset, end }),
        contentLength: len,
      })
      if (chunkRes.status === 409) {
        const statusRes = await this.rawRequest(w.activeUrl, `/upload?${new URLSearchParams({ id })}`, {
          method: 'GET',
          fingerprint: w.fingerprint,
          token: w.token,
        })
        if (statusRes.status === 200) {
          offset = (JSON.parse(statusRes.body.toString('utf8')) as { offset: number }).offset
          continue
        }
      }
      if (chunkRes.status !== 200) throw new Error(parseError(chunkRes.body, 'Upload chunk failed.'))
      const out = JSON.parse(chunkRes.body.toString('utf8')) as { done: boolean; offset: number; result?: unknown }
      offset = out.offset
      if (out.done) {
        if (out.result && typeof out.result === 'object' && 'dir' in out.result && typeof out.result.dir === 'string') {
          this.remoteDirs.add(out.result.dir)
        }
        return out.result
      }
    }
    return undefined
  }

  /** Stream a media file (with optional byte range) from the connected worker for the desktop `manul://` protocol. */
  fetchMedia(projectDir: string, relPath: string, range?: string): Promise<Response> {
    const w = this.active()
    if (!w) return Promise.resolve(new Response('No worker connected', { status: 404 }))
    const q = new URLSearchParams({ project: projectDir, file: relPath })
    const { promise, resolve, reject } = Promise.withResolvers<Response>()
    const u = new URL(`/media?${q}`, w.activeUrl)
    const req = httpsRequest(
      u,
      {
        method: 'GET',
        agent: this.tlsAgent,
        rejectUnauthorized: false,
        headers: {
          authorization: `Bearer ${w.token}`,
          ...(range ? { range } : {}),
        },
      },
      res => {
        const sock = res.socket as TLSSocket
        const peer = sock.getPeerX509Certificate?.()
        const fp = peer?.fingerprint256?.replaceAll(':', '').toLowerCase()
        if (fp !== w.fingerprint) {
          res.destroy()
          reject(new Error('Worker TLS fingerprint mismatch'))
          return
        }
        const headers = new Headers()
        for (const [k, v] of Object.entries(res.headers)) {
          if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
        }
        const webBody = Readable.toWeb(res) as unknown as ReadableStream
        resolve(new Response(webBody, { status: res.statusCode || 200, headers }))
      },
    )
    req.on('error', reject)
    req.end()
    return promise
  }

  /** Pull a project from the active worker into the local projects folder (delta sync: skips unchanged blobs). */
  async pullProject(remoteDir: string, targetDir?: string): Promise<{ dir: string; downloaded: number; skipped: number }> {
    const w = this.active()
    if (!w) throw new Error('No remote worker connected.')
    const manRes = await this.rawRequest(w.activeUrl, `/project/manifest?${new URLSearchParams({ project: remoteDir })}`, {
      method: 'GET',
      fingerprint: w.fingerprint,
      token: w.token,
    })
    if (manRes.status !== 200) throw new Error(parseError(manRes.body, 'Could not read project manifest from worker.'))
    const manifest = JSON.parse(manRes.body.toString('utf8')) as { dir: string; files: ManifestEntry[] }
    const localDir = targetDir || join(this.opts.projectsRoot(), basename(remoteDir))
    await mkdir(localDir, { recursive: true })

    let downloaded = 0
    let skipped = 0
    const ordered = [...manifest.files.filter(f => f.path !== 'project.json'), ...manifest.files.filter(f => f.path === 'project.json')]
    for (const entry of ordered) {
      const dest = join(localDir, ...entry.path.split('/'))
      const existing = await stat(dest).catch(() => null)
      if (existing && existing.size === entry.size && entry.path.startsWith('media/')) {
        skipped++
        continue
      }
      await mkdir(dirname(dest), { recursive: true })
      const tmp = `${dest}.${process.pid}.${Date.now()}.tmp`
      await this.downloadToFile(w, `/project/file?${new URLSearchParams({ project: remoteDir, file: entry.path })}`, tmp)
      if (entry.path === 'project.json') {
        const p = JSON.parse(await readFile(tmp, 'utf8')) as Record<string, unknown>
        p.dir = localDir
        writeFileSync(tmp, JSON.stringify(p, null, 1))
      }
      await rename(tmp, dest)
      downloaded++
    }
    await this.opts.onProjectPulled?.(localDir)
    return { dir: localDir, downloaded, skipped }
  }

  /** Push a local project folder to the active worker (delta sync: skips unchanged media blobs). */
  async pushProject(localDir: string): Promise<{ remoteDir: string; uploaded: number; skipped: number }> {
    const w = this.active()
    if (!w) throw new Error('No remote worker connected.')
    const files = await walkProjectFiles(localDir)
    const slug = basename(localDir)

    const remoteList = (await this.rpc('project:recent', []).catch(() => [])) as { dir: string }[]
    const existingRemote = Array.isArray(remoteList) ? remoteList.find(r => basename(r.dir) === slug)?.dir : undefined
    const remoteFiles = new Map<string, ManifestEntry>()
    if (existingRemote) {
      const manRes = await this.rawRequest(w.activeUrl, `/project/manifest?${new URLSearchParams({ project: existingRemote })}`, {
        method: 'GET',
        fingerprint: w.fingerprint,
        token: w.token,
      }).catch(() => undefined)
      if (manRes?.status === 200) {
        const parsed = JSON.parse(manRes.body.toString('utf8')) as { files: ManifestEntry[] }
        for (const f of parsed.files || []) remoteFiles.set(f.path, f)
      }
    }

    let remoteDir = existingRemote || ''
    let uploaded = 0
    let skipped = 0
    const ordered = [...files.filter(f => f.path !== 'project.json'), ...files.filter(f => f.path === 'project.json')]
    for (const entry of ordered) {
      const rem = remoteFiles.get(entry.path)
      if (rem && rem.size === entry.size && entry.path.startsWith('media/')) {
        skipped++
        continue
      }
      const q = new URLSearchParams({
        ...(existingRemote ? { project: existingRemote } : { slug }),
        file: entry.path,
      })
      const srcPath = join(localDir, ...entry.path.split('/'))
      const res = await this.rawRequest(w.activeUrl, `/project/file?${q}`, {
        method: 'POST',
        fingerprint: w.fingerprint,
        token: w.token,
        stream: createReadStream(srcPath),
        contentLength: entry.size,
      })
      if (res.status !== 200) throw new Error(parseError(res.body, `Failed to sync ${entry.path} to worker.`))
      const out = JSON.parse(res.body.toString('utf8')) as { dir: string }
      remoteDir = out.dir
      uploaded++
    }
    if (remoteDir) this.remoteDirs.add(remoteDir)
    return { remoteDir, uploaded, skipped }
  }

  private startEventStream() {
    this.stopEventStream()
    const w = this.active()
    if (!w) return
    const ctrl = new AbortController()
    this.sseAbort = ctrl
    const u = new URL('/events', w.activeUrl)
    const req = httpsRequest(
      u,
      {
        method: 'GET',
        agent: this.tlsAgent,
        rejectUnauthorized: false,
        headers: { authorization: `Bearer ${w.token}` },
        signal: ctrl.signal,
      },
      res => {
        const sock = res.socket as TLSSocket
        const fp = sock.getPeerX509Certificate?.()?.fingerprint256?.replaceAll(':', '').toLowerCase()
        if (fp !== w.fingerprint || res.statusCode !== 200) {
          res.destroy()
          return
        }
        let buf = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          buf += chunk
          let idx: number
          while ((idx = buf.indexOf('\n\n')) >= 0) {
            const frame = buf.slice(0, idx)
            buf = buf.slice(idx + 2)
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data: ')) continue
              try {
                const msg = JSON.parse(line.slice(6)) as { channel?: string; args?: unknown[] }
                if (msg.channel && Array.isArray(msg.args)) this.opts.onEvent(msg.channel, ...msg.args)
              } catch {}
            }
          }
        })
        res.on('end', () => this.scheduleReconnect())
        res.on('error', () => this.scheduleReconnect())
      },
    )
    req.on('error', () => this.scheduleReconnect())
    req.end()
  }

  private scheduleReconnect() {
    if (!this.activeId || this.sseAbort?.signal.aborted) return
    clearTimeout(this.sseTimer)
    this.sseTimer = setTimeout(() => this.startEventStream(), 2_000)
  }

  private stopEventStream() {
    clearTimeout(this.sseTimer)
    this.sseTimer = undefined
    this.sseAbort?.abort()
    this.sseAbort = undefined
  }

  private downloadToFile(w: SavedWorker, pathAndQuery: string, destFile: string): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>()
    const req = httpsRequest(
      new URL(pathAndQuery, w.activeUrl),
      {
        method: 'GET',
        agent: this.tlsAgent,
        rejectUnauthorized: false,
        headers: { authorization: `Bearer ${w.token}` },
      },
      res => {
        const sock = res.socket as TLSSocket
        const fp = sock.getPeerX509Certificate?.()?.fingerprint256?.replaceAll(':', '').toLowerCase()
        if (fp !== w.fingerprint) {
          res.destroy()
          reject(new Error('Worker TLS fingerprint mismatch'))
          return
        }
        if (res.statusCode !== 200) {
          res.destroy()
          reject(new Error(`Worker file download failed (${res.statusCode})`))
          return
        }
        pipeline(res, createWriteStream(destFile, { mode: 0o600 })).then(resolve, reject)
      },
    )
    req.on('error', reject)
    req.end()
    return promise
  }

  private rawRequest(
    baseUrl: string,
    pathAndQuery: string,
    options: {
      method: string
      fingerprint?: string
      token?: string
      body?: string | Buffer
      stream?: Readable
      contentLength?: number
    },
  ): Promise<{ status: number; body: Buffer; fingerprint?: string }> {
    const { promise, resolve, reject } = Promise.withResolvers<{ status: number; body: Buffer; fingerprint?: string }>()
    const u = new URL(pathAndQuery, baseUrl)
    const headers: Record<string, string> = {}
    if (options.token) headers.authorization = `Bearer ${options.token}`
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      headers['content-length'] = String(Buffer.byteLength(options.body))
    } else if (options.contentLength !== undefined) {
      headers['content-length'] = String(options.contentLength)
    }
    const req = httpsRequest(
      u,
      {
        method: options.method,
        rejectUnauthorized: false,
        agent: this.tlsAgent,
        headers,
        timeout: 30_000,
      },
      res => {
        const sock = res.socket as TLSSocket
        const cert = sock.getPeerX509Certificate?.() || (sock.getPeerCertificate?.().raw ? new X509Certificate(sock.getPeerCertificate().raw) : undefined)
        const fp = cert?.fingerprint256?.replaceAll(':', '').toLowerCase()
        if (options.fingerprint && fp !== options.fingerprint.toLowerCase()) {
          res.destroy()
          reject(new Error('Worker TLS certificate fingerprint mismatch'))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode || 500, body: Buffer.concat(chunks), fingerprint: fp }))
        res.on('error', reject)
      },
    )
    req.on('timeout', () => req.destroy(new Error('Worker request timed out')))
    req.on('error', reject)
    if (options.stream) {
      options.stream.pipe(req)
    } else {
      req.end(options.body)
    }
    return promise
  }
}

export function normalizeWorkerUrl(input: string): string {
  const s = input.trim().replace(/\/+$/, '')
  if (/^https:\/\//i.test(s)) return s
  if (/^http:\/\//i.test(s)) return s.replace(/^http:/i, 'https:')
  return `https://${s.includes(':') ? s : `${s}:47821`}`
}

function parseError(buf: Buffer, fallback: string): string {
  try {
    const parsed = JSON.parse(buf.toString('utf8')) as { error?: string }
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error
  } catch {}
  return fallback
}

/** Periodically registers a local or pooled worker with the AgentShot account service so signed-in devices find it. */
export function startWorkerHeartbeat(opts: {
  bridge: MobileBridge
  workerId: string
  workerName: string
  poolSecret?: string
  priority?: number
  projects: () => string[]
  sendHeartbeat: (body: Record<string, unknown>, poolSecret?: string) => Promise<{ leasedTo?: string | null; leasedUntil?: number | null } | void>
  /** A cloud worker hears who leases it with every heartbeat. */
  onLease?: (lease?: { userId: string; until: number }) => void
  /** A cloud worker tells the account how its lessee is using it, so an unused lease is freed. */
  activity?: () => { user: string; idleMs: number; busy: boolean } | undefined
}): (() => void) & { beat: () => Promise<void> } {
  let stopped = false
  const tick = async () => {
    if (stopped) return
    const creds = opts.bridge.workerCredentials()
    if (creds.fingerprint && creds.urls.length) {
      await opts
        .sendHeartbeat(
          {
            id: opts.workerId,
            name: opts.workerName,
            urls: creds.urls,
            fingerprint: creds.fingerprint,
            secret: creds.secret,
            pool: !!opts.poolSecret,
            ...(opts.poolSecret && opts.activity?.() ? { activity: opts.activity() } : {}),
            capabilities: {
              platform: process.platform,
              arch: process.arch,
              gpu: process.platform === 'darwin' ? 'videotoolbox' : process.env.MANUL_WORKER_GPU,
              priority: opts.priority ?? (opts.poolSecret ? 5 : 10),
              projects: opts.projects(),
            },
          },
          opts.poolSecret,
        )
        .then(reply => {
          if (!opts.poolSecret || !reply) return
          opts.onLease?.(reply.leasedTo && reply.leasedUntil ? { userId: reply.leasedTo, until: reply.leasedUntil } : undefined)
        })
        .catch(() => {})
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), 30_000)
  // beat(): report now, e.g. to hear about a lease that just started
  return Object.assign(
    () => {
      stopped = true
      clearInterval(timer)
    },
    { beat: tick },
  )
}
