// This phone's side of the phone ↔ Mac protocol (src/shared/remote.ts): pair with a Mac from its QR code, find it on
// the network, and talk to its agent. Plain TypeScript with fetch passed in, so it also runs under Node against the
// real desktop app (test/e2e/phone-client.e2e.mjs in the desktop app).
import type { BaseEvent } from '@ag-ui/core'
import {
  aad, DEVICE_HEADER, routes, seal, SEAL_HEADER, unseal,
  type PairingCode, type PairReply, type RemoteProject,
} from '../../src/shared/remote'

/** A paired Mac, as this phone keeps it (in the keychain). */
export type Mac = { id: string; name: string; hosts: string[]; port: number; device: string; key: string }

type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ status: number; ok: boolean; text(): Promise<string>; body: ReadableStream<Uint8Array> | null }>

export class MacError extends Error {
  constructor(message: string, public status = 0) { super(message) }
}

const unreachable = (name: string) =>
  `Can't reach ${name}. Check this phone is on the same Wi-Fi, and that Manul is open with phone access on.`

/** The first of the Mac's addresses that answers at all (to a stranger it answers 401). */
export async function reach(hosts: string[], port: number, name: string, fetchImpl: Fetch, ms = 3000): Promise<string> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  try {
    return await Promise.any(hosts.map(h => fetchImpl(`http://${h}:${port}${routes.projects}`, { signal: ctl.signal }).then(() => h)))
  } catch {
    throw new MacError(unreachable(name))
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
    throw new MacError(unreachable(code.name))
  }
  if (res.status === 410) throw new MacError('This code has expired or was already used. Make a new one on your Mac.', 410)
  if (!res.ok) throw new MacError("This code didn't work. Make a new one on your Mac and scan it again.", res.status)
  const r = unseal<PairReply>(code.secret, aad.paired, await res.text()).value
  return { id: r.mac, name: r.name, hosts: [host, ...code.hosts.filter(h => h !== host)], port: code.port, device: r.device, key: r.key }
}

export type Follow = {
  /** a (re)connection: the conversation is replayed from the start next */
  open(): void
  event(e: BaseEvent): void
  status(s: 'connecting' | 'live' | 'offline' | 'unpaired', error?: string): void
}

export class MacClient {
  private host: string | null = null

  private fetchImpl: Fetch

  constructor(public mac: Mac, fetchImpl: Fetch) {
    this.fetchImpl = (url, init) => fetchImpl(url, init) // a browser's fetch refuses to be called as another object's method
  }

  private async base() {
    this.host ??= await reach(this.mac.hosts, this.mac.port, this.mac.name, this.fetchImpl)
    return `http://${this.host}:${this.mac.port}`
  }

  /** A sealed request; returns the opened reply. GETs carry their seal in a header, POSTs as the body. */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, signal?: AbortSignal) {
    const s = seal(this.mac.key, aad.request(method, path), body ?? null)
    const headers: Record<string, string> = { [DEVICE_HEADER]: this.mac.device, ...(method === 'GET' ? { [SEAL_HEADER]: s } : {}) }
    let res
    try {
      res = await this.fetchImpl((await this.base()) + path, { method, headers, body: method === 'POST' ? s : undefined, signal })
    } catch (e) {
      if (signal?.aborted) throw e
      this.host = null // its address may have changed: look again next time
      throw new MacError(unreachable(this.mac.name))
    }
    if (res.status === 401) throw new MacError("Your Mac doesn't know this phone any more. Pair again.", 401)
    return { res, nonce: s.split('.')[0] }
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const { res, nonce } = await this.request(method, path, body)
    const text = await res.text()
    const value = text ? unseal<T & { error?: string }>(this.mac.key, aad.reply(nonce), text).value : undefined
    if (!res.ok) throw new MacError(value?.error || `Your Mac answered ${res.status}.`, res.status)
    return value as T
  }

  projects() { return this.call<RemoteProject[]>('GET', routes.projects) }
  send(project: string, text: string) { return this.call<{ ok: true }>('POST', routes.messages(project), { text }) }
  stop(project: string) { return this.call<{ ok: true }>('POST', routes.stop(project)) }

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
