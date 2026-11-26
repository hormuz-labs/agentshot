// A person's cloud worker, as the hosted server reaches it: the bridge protocol (src/main/mobile-bridge.ts) over
// HTTPS, its certificate pinned by fingerprint (it signs its own), with the lease token the account service gave.
import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { TLSSocket } from 'node:tls'
import type { Readable } from 'node:stream'

export type Worker = { id: string; urls: string[]; fingerprint: string; token: string; expiresAt: number }

/** The worker said no (status), or couldn't be reached (status 0). */
export class WorkerError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

const fingerprintOf = (res: IncomingMessage) =>
  ((res.socket as TLSSocket).getPeerCertificate?.()?.fingerprint256 || '').replaceAll(':', '').toLowerCase()

/** One request to the worker, trying its addresses in turn; the response body is the caller's to read. */
export function open(w: Worker, path: string, o: { method: string; headers?: Record<string, string>; body?: Buffer | string | Readable; timeoutMs?: number }): Promise<IncomingMessage> {
  const tryAt = (i: number): Promise<IncomingMessage> => new Promise((ok, fail) => {
    const url = new URL(path, w.urls[i])
    const req = request(url, {
      method: o.method, rejectUnauthorized: false, agent: false, timeout: o.timeoutMs ?? 30_000,
      headers: { authorization: `Bearer ${w.token}`, ...o.headers },
    }, res => {
      // its own certificate, checked by fingerprint: anything else is not this worker
      if (fingerprintOf(res) !== w.fingerprint.toLowerCase()) { res.destroy(); return fail(new WorkerError(0, 'The cloud worker’s certificate didn’t match.')) }
      ok(res)
    })
    req.on('timeout', () => req.destroy(new Error('timed out')))
    req.on('error', e => fail(e instanceof WorkerError ? e : new WorkerError(0, `The cloud worker can’t be reached (${(e as Error).message}).`)))
    if (o.body && typeof (o.body as Readable).pipe === 'function') (o.body as Readable).pipe(req)
    else req.end(o.body as Buffer | string | undefined)
  })
  // another address only when this one couldn't be reached at all
  const next = (i: number): Promise<IncomingMessage> => tryAt(i).catch(e => (e instanceof WorkerError && e.status === 0 && e.message.includes('reached') && i + 1 < w.urls.length ? next(i + 1) : Promise.reject(e)))
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
