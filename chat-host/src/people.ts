// Who is asking, and their cloud worker. Claude or ChatGPT send the Clerk access token the person got when they
// connected AgentShot ("Sign in with Google" on Clerk's page); Clerk says who it is (as the account service asks it).
// With the same token the account service gives their AgentShot key, as it does to the desktop app, and with the key
// a worker is leased to them: their space, their projects, their credits.
import { createHash } from 'node:crypto'
import type { Worker } from './worker.ts'

export type Person = { sub: string; email?: string }
type Fetch = typeof fetch
type Key = { key: string; keyId: string }

const hash = (s: string) => createHash('sha256').update(s).digest('hex')

/** What the account service said, in its own words (it never names a vendor). */
export class AccountError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export class People {
  private o: { clerk: string; account: string; fetch: Fetch; now: () => number }
  private seen = new Map<string, { person: Person; until: number }>()
  private keys = new Map<string, Key>()
  private leases = new Map<string, Worker>()
  private leasing = new Map<string, Promise<Worker>>()

  constructor(o: { clerk: string; account: string; fetch?: Fetch; now?: () => number }) {
    this.o = { clerk: o.clerk.replace(/\/+$/, ''), account: o.account.replace(/\/+$/, ''), fetch: o.fetch ?? fetch, now: o.now ?? Date.now }
  }

  /** The person a Clerk access token is, or nothing when Clerk doesn't know it (expired, or not ours). Asked again
   *  after five minutes, so a signed-out token stops working soon. */
  async who(token: string): Promise<Person | undefined> {
    const id = hash(token), now = this.o.now()
    const known = this.seen.get(id)
    if (known && known.until > now) return known.person
    const res = await this.o.fetch(`${this.o.clerk}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) { this.seen.delete(id); return undefined }
    const info = await res.json() as { sub?: string; email?: string }
    if (!info.sub) return undefined
    const person = { sub: info.sub, ...(info.email ? { email: info.email } : {}) }
    if (this.seen.size > 10_000) this.seen.clear()
    this.seen.set(id, { person, until: now + 5 * 60_000 })
    return person
  }

  private async account(path: string, headers: Record<string, string>, body: unknown) {
    const res = await this.o.fetch(`${this.o.account}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    const out = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) throw new AccountError(res.status, typeof out.error === 'string' ? out.error : 'AgentShot accounts couldn’t answer. Try again in a moment.')
    return out
  }

  /** Their AgentShot key: made the first time (with the free credit), the same one after. */
  private async key(person: Person, token: string): Promise<Key> {
    const had = this.keys.get(person.sub)
    if (had) return had
    const out = await this.account('/v1/key', { authorization: `Bearer ${token}` }, {})
    if (typeof out.key !== 'string' || typeof out.key_id !== 'string') throw new AccountError(502, 'AgentShot accounts gave no key.')
    const key = { key: out.key, keyId: out.key_id }
    this.keys.set(person.sub, key)
    return key
  }

  /** Their cloud worker: the one leased, while the lease lasts, else a new lease. [fresh]: the one leased stopped
   *  answering for them (it went, or the lease moved), so lease again. */
  async worker(person: Person, token: string | undefined, fresh = false): Promise<Worker> {
    const held = this.leases.get(person.sub)
    if (held && !fresh && held.expiresAt - 5 * 60_000 > this.o.now()) return held
    const going = this.leasing.get(person.sub)
    if (going) return going
    const lease = (async () => {
      // a key known from before: a video link can lease again without the chat's token
      const key = this.keys.get(person.sub) ?? (token ? await this.key(person, token) : undefined)
      if (!key) throw new AccountError(401, 'Connect AgentShot again.')
      const out = await this.account('/v1/workers/lease', { authorization: `Bearer ${key.key}`, 'x-manul-key-id': key.keyId }, held && fresh ? {} : { workerId: held?.id })
      const w = out.worker as Worker | undefined
      if (!w || !Array.isArray(w.urls) || !w.urls.length || typeof w.token !== 'string' || typeof w.fingerprint !== 'string') throw new AccountError(502, 'No cloud worker came back. Try again in a moment.')
      const worker = { id: w.id, urls: w.urls, fingerprint: w.fingerprint, token: w.token, expiresAt: Number(w.expiresAt) || this.o.now() + 60 * 60_000 }
      this.leases.set(person.sub, worker)
      return worker
    })().finally(() => this.leasing.delete(person.sub))
    this.leasing.set(person.sub, lease)
    return lease
  }
}
