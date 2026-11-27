// A person's cloud worker, as the hosted server reaches it: the bridge protocol (src/main/mobile-bridge.ts) over
// HTTPS, its certificate pinned by fingerprint (it signs its own), with the lease token the account service gave.
import { request, type IncomingMessage } from 'node:http'
import { connect, type TLSSocket } from 'node:tls'
import type { Readable } from 'node:stream'

export type Worker = { id: string; urls: string[]; fingerprint: string; token: string; expiresAt: number }

/** The worker said no (status), or didn't answer (status 0). */
export class WorkerError extends Error {
  status: number
  /** Nothing of the request reached the worker (it couldn't be reached, or wasn't the one leased): asking again, at
   *  another address or with a new lease, can't run anything twice. */
  unsent: boolean
  constructor(status: number, message: string, unsent = false) { super(message); this.status = status; this.unsent = unsent }
}

/** How long an address has to answer before the next one is tried. */
const CONNECT_MS = 10_000

/** A connection to the worker at one address, given only once its certificate is the one leased (it signs its own,
 *  so it is checked by fingerprint): the lease token and the request go to nothing else. */
function dial(w: Worker, url: URL, connectMs: number): Promise<TLSSocket> {
  return new Promise((ok, fail) => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port) || 443, rejectUnauthorized: false })
    const timer = setTimeout(() => socket.destroy(new Error('timed out')), connectMs)
    // stays on: once the connection is handed over, the request hears of its errors too
    socket.on('error', e => { clearTimeout(timer); fail(new WorkerError(0, `The cloud worker can’t be reached (${e.message}).`, true)) })
    socket.once('secureConnect', () => {
      clearTimeout(timer)
      const got = (socket.getPeerCertificate()?.fingerprint256 || '').replaceAll(':', '').toLowerCase()
      if (got !== w.fingerprint.toLowerCase()) { socket.destroy(); return fail(new WorkerError(0, 'The cloud worker’s certificate didn’t match.', true)) }
      ok(socket)
    })
  })
}

/** One request to the worker, trying its addresses in turn; the response body is the caller's to read. */
export function open(w: Worker, path: string, o: { method: string; headers?: Record<string, string>; body?: Buffer | string | Readable; timeoutMs?: number; connectMs?: number }): Promise<IncomingMessage> {
  const tryAt = async (i: number): Promise<IncomingMessage> => {
    const url = new URL(path, w.urls[i])
    const socket = await dial(w, url, o.connectMs ?? CONNECT_MS)
    return new Promise((ok, fail) => {
      // once it is on its way the worker may have begun the work: a failure from here on is never "ask again"
      const stopped = (e: Error) => fail(new WorkerError(0, `The cloud worker stopped answering (${e.message}).`))
      const req = request({
        createConnection: () => socket, host: url.hostname, port: url.port, path: url.pathname + url.search,
        method: o.method, headers: { authorization: `Bearer ${w.token}`, ...o.headers },
      }, res => { res.on('error', () => {}); ok(res) })
      // (the `timeout` option is only applied to a connection the request opens itself)
      req.setTimeout(o.timeoutMs ?? 30_000, () => req.destroy(new Error('timed out')))
      req.on('error', stopped)
      const body = o.body
      if (body && typeof (body as Readable).pipe === 'function') {
        const from = body as Readable
        from.pipe(req)
        // the sender went away halfway: the worker isn't left waiting for the rest
        from.once('error', e => req.destroy(e))
        from.once('close', () => { if (!from.readableEnded) req.destroy(new Error('the file stopped arriving')) })
      } else req.end(body as Buffer | string | undefined)
    })
  }
  // another address only while nothing has been sent: it couldn't be reached there, or it wasn't this worker
  const next = (i: number): Promise<IncomingMessage> => tryAt(i).catch(e => (e instanceof WorkerError && e.unsent && i + 1 < w.urls.length ? next(i + 1) : Promise.reject(e)))
  return next(0)
}

async function read(res: IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const c of res) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** One of the bridge's calls (mobile-contract.ts), as the phone makes them. */
export async function rpc(w: Worker, method: string, args: unknown[], timeoutMs = 30 * 60_000): Promise<unknown> {
  const body = JSON.stringify({ method, args })
  const res = await open(w, '/rpc', { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) }, body, timeoutMs })
  const text = await read(res)
  if (res.statusCode !== 200) {
    let message = `The cloud worker refused ${method} (${res.statusCode}).`
    try { const e = JSON.parse(text); if (typeof e?.error === 'string') message = e.error } catch { /* not JSON */ }
    throw new WorkerError(res.statusCode || 0, message)
  }
  return text ? JSON.parse(text) : null
}

/** A file of one of the person's projects, in ranges (the worker's /media). */
export function media(w: Worker, dir: string, rel: string, headers: Record<string, string>, method = 'GET') {
  return open(w, `/media?${new URLSearchParams({ project: dir, file: rel })}`, { method, headers, timeoutMs: 120_000 })
}

/** A file into the person's space: a new project, or into [dir]. Resolves to what the worker made of it. */
export async function upload(w: Worker, name: string, size: number, body: Readable, dir?: string): Promise<unknown> {
  const q = new URLSearchParams({ name, ...(dir ? { project: dir } : {}) })
  const res = await open(w, `/upload?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'content-length': String(size) }, body, timeoutMs: 30 * 60_000 })
  const text = await read(res)
  if (res.statusCode !== 200) {
    let message = `The cloud worker didn’t take the file (${res.statusCode}).`
    try { const e = JSON.parse(text); if (typeof e?.error === 'string') message = e.error } catch { /* not JSON */ }
    throw new WorkerError(res.statusCode || 0, message)
  }
  return JSON.parse(text)
}
