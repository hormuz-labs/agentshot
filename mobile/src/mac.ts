// This phone's side of the phone ↔ Mac protocol (src/shared/remote.ts): pair with a Mac from its QR code, find it on
// the network, talk to its agent, and send it footage. Plain TypeScript with fetch passed in, so it also runs under Node against the
// real desktop app (test/e2e/phone-client.e2e.mjs in the desktop app).
import type { BaseEvent } from '@ag-ui/core'
import {
  aad, b64url, CHUNK, DEVICE_HEADER, isTailscale, routes, seal, SEAL_HEADER, sealBytes, unseal,
  type Hello, type PairingCode, type PairReply, type RemoteProject, type UploadState,
} from '../../src/shared/remote'

/** A paired Mac, as this phone keeps it (in the keychain). */
export type Mac = { id: string; name: string; hosts: string[]; port: number; device: string; key: string }

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) =>
  Promise<{ status: number; ok: boolean; text(): Promise<string>; body: ReadableStream<Uint8Array> | null }>

export class MacError extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

/** Why the Mac can't be reached, in the person's words: Tailscale is a way in when the Mac is on it. */
const unreachable = (name: string, hosts: string[]) =>
  hosts.some(isTailscale)
    ? `Can't reach ${name}. Check this phone is on the same Wi-Fi or has Tailscale on, and that Manul is open with phone access on.`
    : `Can't reach ${name}. Check this phone is on the same Wi-Fi, and that Manul is open with phone access on.`

/** The first of the Mac's addresses that answers at all (to a stranger it answers 401). */
export async function reach(hosts: string[], port: number, name: string, fetchImpl: Fetch, ms = 3000): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await Promise.any(hosts.map(h => fetchImpl(`http://${h}:${port}${routes.projects}`, { signal: ctl.signal }).then(() => h)))
  } catch {
    throw new MacError(unreachable(name, hosts))
  } finally {
    clearTimeout(timer)
    ctl.abort() // the slower addresses
  }
}

/** Pair with the Mac whose QR code this is; the code works once. */
export async function pair(code: PairingCode, phoneName: string, fetchImpl: Fetch): Promise<Mac> {
  const host = await reach(code.hosts, code.port, code.name, fetchImpl)
  let res
  try {
    res = await fetchImpl(`http://${host}:${code.port}${routes.pair}`, { method: 'POST', body: seal(code.secret, aad.pair, { name: phoneName }) })
  } catch {
    throw new MacError(unreachable(code.name, code.hosts))
  }
  if (res.status === 410) throw new MacError('This code has expired or was already used. Make a new one on your Mac.', 410)
  if (!res.ok) throw new MacError("This code didn't work. Make a new one on your Mac and scan it again.", res.status)
  const r = unseal<PairReply>(code.secret, aad.paired, await res.text()).value
  return { id: r.mac, name: r.name, hosts: [host, ...code.hosts.filter(h => h !== host)], port: code.port, device: r.device, key: r.key }
}

/** A file to send, read a piece at a time: expo-file-system on the phone, a Blob in a browser, the disk in tests. */
export type Source = { name: string; size: number; read(offset: number, length: number): Promise<Uint8Array> }

export type UploadOptions = {
  /** an upload started earlier (the app was closed, say): carry on with it if the Mac still has it */
  upload?: string
  /** the Mac made the upload: keep its id to resume after a restart */
  onStart?(upload: string): void
  onProgress?(received: number, size: number): void
  signal?: AbortSignal
  /** bytes per piece (CHUNK) */
  chunk?: number
  /** tries after a drop before giving up, and the first wait between them (it doubles, up to 15 s) */
  retries?: number
  wait?: number
}

/** An upload that landed: its paths in the project's media/. */
export type Uploaded = UploadState & { files: string[] }

const PIECE_TIMEOUT_MS = 60_000

export type Follow = {
  /** a (re)connection: the conversation is replayed from the start next */
  open(): void
  event(e: BaseEvent): void
  status(s: 'connecting' | 'live' | 'offline' | 'unpaired', error?: string): void
}

export class MacClient {
  private host: string | null = null

  private fetchImpl: Fetch

  /** onChange: the Mac's name or addresses changed (it joined Tailscale, say): keep the new ones */
  constructor(public mac: Mac, fetchImpl: Fetch, private o: { onChange?(m: Mac): void } = {}) {
    this.fetchImpl = (url, init) => fetchImpl(url, init) // a browser's fetch refuses to be called as another object's method
  }

  /** Ask the Mac where it can be reached now and keep that, so a phone paired at home finds it over Tailscale later. */
  async refresh() {
    const h = await this.call<Hello>('GET', routes.hello)
    if (!h?.hosts?.length || h.mac !== this.mac.id) return this.mac
    const next = { ...this.mac, name: h.name, hosts: h.hosts, port: h.port }
    if (JSON.stringify([next.name, next.hosts, next.port]) !== JSON.stringify([this.mac.name, this.mac.hosts, this.mac.port])) {
      this.mac = next
      this.o.onChange?.(next)
    }
    return this.mac
  }

  private async base() {
    this.host ??= await reach(this.mac.hosts, this.mac.port, this.mac.name, this.fetchImpl)
    return `http://${this.host}:${this.mac.port}`
  }

  /** A sealed request; returns the opened reply. GETs carry their seal in a header, POSTs as the body; a piece of an
   *  upload is sealed bytes, bound to its upload and offset (`bytes.ad`). */
  private async request(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal, bytes?: { ad: string; data: Uint8Array }) {
    const s = bytes ? sealBytes(this.mac.key, bytes.ad, bytes.data) : seal(this.mac.key, aad.request(method, path), body ?? null)
    const headers: Record<string, string> = { [DEVICE_HEADER]: this.mac.device }
    if (typeof s === 'string' && method === 'GET') headers[SEAL_HEADER] = s
    if (bytes) headers['content-type'] = 'application/octet-stream'
    let res
    try {
      res = await this.fetchImpl((await this.base()) + path, { method, headers, body: method === 'POST' ? s : undefined, signal })
    } catch (e) {
      if (signal?.aborted) throw e
      this.host = null // its address may have changed: look again next time
      throw new MacError(unreachable(this.mac.name, this.mac.hosts))
    }
    if (res.status === 401) throw new MacError("Your Mac doesn't know this phone any more. Pair again.", 401)
    return { res, nonce: typeof s === 'string' ? s.split('.')[0] : b64url(s.subarray(0, 24)) }
  }

  /** A request and its opened reply. Statuses in `also` answer like a 200 (an upload's 409: where the Mac is). */
  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown, o: { signal?: AbortSignal; bytes?: { ad: string; data: Uint8Array }; also?: number[] } = {}): Promise<T> {
    const { res, nonce } = await this.request(method, path, body, o.signal, o.bytes)
    let text
    try { text = await res.text() } catch (e) {
      if (o.signal?.aborted) throw e
      throw new MacError(unreachable(this.mac.name, this.mac.hosts)) // dropped halfway through the answer
    }
    const value = text ? unseal<T & { error?: string }>(this.mac.key, aad.reply(nonce), text).value : undefined
    if (!res.ok && !o.also?.includes(res.status)) throw new MacError(value?.error || `Your Mac answered ${res.status}.`, res.status)
    return value as T
  }

  projects() { return this.call<RemoteProject[]>('GET', routes.projects) }
  /** A message to the project's agent, with files the phone sent into its media/ attached. */
  send(project: string, text: string, files?: string[]) { return this.call<{ ok: true }>('POST', routes.messages(project), files?.length ? { text, files } : { text }) }
  stop(project: string) { return this.call<{ ok: true }>('POST', routes.stop(project)) }
  uploadState(upload: string) { return this.call<UploadState>('GET', routes.upload(upload)) }
  cancelUpload(upload: string) { return this.call<{ ok: true }>('POST', routes.cancel(upload)) }

  /** Send a file into a project in sealed pieces. After a drop it asks the Mac how much it has and carries on from
   *  there; pass `upload` to carry on with one started before. Returns where the file landed in the project. */
  async upload(project: string, src: Source, o: UploadOptions = {}): Promise<Uploaded> {
    const size = o.chunk ?? CHUNK, retries = o.retries ?? 8
    let st: UploadState | null = null
    let resume = o.upload ?? null
    for (let failures = 0; ;) {
      const piece = new AbortController()
      const abort = () => piece.abort()
      o.signal?.addEventListener('abort', abort)
      const timer = setTimeout(abort, PIECE_TIMEOUT_MS) // a Wi-Fi that vanished without a word
      try {
        if (o.signal?.aborted) throw new MacError('Stopped.')
        if (resume) {
          st = await this.uploadState(resume).catch(e => { if (e instanceof MacError && e.status === 404) return null; throw e })
          resume = null
        }
        if (!st) {
          st = await this.call<UploadState>('POST', routes.uploads(project), { name: src.name, size: src.size })
          if (st.size !== src.size) throw new MacError('Your Mac has a different file under this upload.')
          o.onStart?.(st.upload)
        }
        o.onProgress?.(st.received, st.size)
        if (st.files) return st as Uploaded
        const data = await src.read(st.received, Math.min(size, st.size - st.received))
        if (!data.length) throw new MacError(`${src.name} is shorter than it was. Send it again.`)
        st = await this.call<UploadState>('POST', routes.chunk(st.upload, st.received), undefined, {
          signal: piece.signal, bytes: { ad: aad.chunk(st.upload, st.received), data }, also: [409],
        })
        failures = 0
      } catch (e) {
        if (o.signal?.aborted) throw e
        // a drop (no answer, or none in time): find out where the Mac got to and carry on; anything the Mac said, stands
        const dropped = (e instanceof MacError && e.status === 0) || (piece.signal.aborted && !(e instanceof MacError))
        if (!dropped || ++failures > retries) throw dropped ? new MacError(unreachable(this.mac.name, this.mac.hosts)) : e
        if (st) resume = st.upload
        await new Promise(r => setTimeout(r, Math.min((o.wait ?? 1000) * 2 ** (failures - 1), 15_000)))
      } finally {
        clearTimeout(timer)
        o.signal?.removeEventListener('abort', abort)
      }
    }
  }

  /** Follow a project's conversation until closed, reconnecting (and so replaying) after a drop. Returns close. */
  follow(project: string, on: Follow): () => void {
    const ctl = new AbortController()
    void (async () => {
      let wait = 1000
      while (!ctl.signal.aborted) {
        on.status('connecting')
        let error: string | undefined
        try {
          const path = routes.events(project)
          const { res, nonce } = await this.request('GET', path, undefined, ctl.signal)
          if (!res.ok || !res.body) {
            const text = await res.text()
            throw new MacError((text && unseal<{ error?: string }>(this.mac.key, aad.reply(nonce), text).value?.error) || `Your Mac answered ${res.status}.`, res.status)
          }
          on.open()
          on.status('live')
          wait = 1000
          const reader = res.body.getReader()
          const decoder = new TextDecoder()
          let buf = '', seq = 0
          for (;;) {
            const { value, done } = await reader.read()
            if (done) break
            buf += decoder.decode(value, { stream: true })
            let i
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, i)
              buf = buf.slice(i + 2)
              if (frame.startsWith('data: ')) on.event(unseal<BaseEvent>(this.mac.key, aad.event(nonce, seq++), frame.slice(6)).value)
            }
          }
        } catch (e) {
          if (ctl.signal.aborted) return
          if (e instanceof MacError && e.status === 401) { on.status('unpaired', e.message); return }
          error = (e as Error).message
        }
        if (ctl.signal.aborted) return
        on.status('offline', error)
        await new Promise(r => setTimeout(r, wait))
        wait = Math.min(wait * 2, 15_000)
      }
    })()
    return () => ctl.abort()
  }
}
