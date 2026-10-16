// The phone ↔ Mac protocol of the phone companion app: the Mac's app serves it on the local network
// (src/main/remote.ts) and the phone app (mobile/) speaks it. It runs over plain HTTP: every request, reply and event
// is sealed with XChaCha20-Poly1305 under a key only the two share, so the network (and later Manul's relay) sees who
// talks to whom and nothing else.
//   pairing  the Mac shows a QR code: its name, addresses and a one-time secret good for five minutes. The phone seals
//            its own name with that secret; the Mac answers, sealed the same way, with the phone's device id and key.
//   after    each request names its device (DEVICE_HEADER) and carries a seal bound to its method and path (the body,
//            or SEAL_HEADER when there is none). The reply is bound to that request's seal, each event to its stream
//            and its place in it, so nothing can be replayed elsewhere.
// A seal holds the time it was made: the receiver refuses one more than SKEW_MS off its clock, or seen before.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js'

export const PROTOCOL = 1
export const PAIR_TTL_MS = 5 * 60_000
export const SKEW_MS = 2 * 60_000
export const DEVICE_HEADER = 'x-manul-device'
export const SEAL_HEADER = 'x-manul-seal'

export const routes = {
  pair: '/v1/pair',
  projects: '/v1/projects',
  events: (project: string) => `/v1/projects/${encodeURIComponent(project)}/events`,
  messages: (project: string) => `/v1/projects/${encodeURIComponent(project)}/messages`,
  stop: (project: string) => `/v1/projects/${encodeURIComponent(project)}/stop`,
}

/** What the QR code says. */
export type PairingCode = {
  v: number
  /** the Mac's id, stable across launches */
  mac: string
  /** the Mac's name, to show on the phone */
  name: string
  /** addresses to try, the phone keeps the first that answers */
  hosts: string[]
  port: number
  /** the one-time secret (a key) */
  secret: string
  expires: number
}
/** The phone, sealed with the pairing secret. */
export type PairRequest = { name: string }
/** The Mac's answer, sealed with the pairing secret. */
export type PairReply = { device: string; key: string; mac: string; name: string }

export type RemoteProject = { id: string; title: string; openedAt: number }
export type RemoteMessage = { text: string }

/** Additional data each seal is bound to: what it is, and for which request or stream. */
export const aad = {
  pair: 'manul/1 pair',
  paired: 'manul/1 paired',
  request: (method: string, path: string) => `manul/1 phone ${method.toUpperCase()} ${path}`,
  /** a reply to the request whose seal had this nonce */
  reply: (nonce: string) => `manul/1 mac reply ${nonce}`,
  /** the seq-th event of the stream opened by the request whose seal had this nonce */
  event: (nonce: string, seq: number) => `manul/1 mac event ${nonce} ${seq}`,
}

// ---------------------------------------------------------------- base64url (no Buffer on the phone)
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const INDEX = Object.fromEntries([...ABC].map((c, i) => [c, i]))

export function b64url(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63]
    if (i + 1 < bytes.length) out += ABC[(n >> 6) & 63]
    if (i + 2 < bytes.length) out += ABC[n & 63]
  }
  return out
}

export function fromB64url(s: string): Uint8Array {
  if (s.length % 4 === 1) throw new Error('Not base64url.')
  const out = new Uint8Array(Math.floor((s.length * 3) / 4))
  let o = 0
  for (let i = 0; i < s.length; i += 4) {
    let n = 0
    for (let j = 0; j < 4; j++) {
      const v = i + j < s.length ? INDEX[s[i + j]] : 0
      if (v === undefined) throw new Error('Not base64url.')
      n = (n << 6) | v
    }
    out[o++] = (n >> 16) & 255
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

export const newKey = () => b64url(randomBytes(32))
export const newId = () => b64url(randomBytes(16))

// ---------------------------------------------------------------- QR code
const SCHEME = 'manul://pair#'

export const pairingUrl = (c: PairingCode) => SCHEME + b64url(utf8ToBytes(JSON.stringify(c)))

/** The pairing code in a scanned QR, or null when it is not Manul's, is for another version, or has expired. */
export function readPairingUrl(url: string, now = Date.now()): PairingCode | null {
  if (!url.startsWith(SCHEME)) return null
  try {
    const c = JSON.parse(bytesToUtf8(fromB64url(url.slice(SCHEME.length)))) as PairingCode
    if (c.v !== PROTOCOL || !c.mac || !c.secret || !Array.isArray(c.hosts) || !c.port) return null
    return c.expires > now ? c : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- seals
export class SealError extends Error {}

/** `value` sealed under `key` (base64url) and bound to `ad`: "<nonce>.<ciphertext>". */
export function seal(key: string, ad: string, value: unknown, now = Date.now()): string {
  const nonce = randomBytes(24)
  const box = xchacha20poly1305(fromB64url(key), nonce, utf8ToBytes(ad)).encrypt(utf8ToBytes(JSON.stringify({ t: now, d: value ?? null })))
  return `${b64url(nonce)}.${b64url(box)}`
}

/** What a seal holds and its nonce; throws SealError when it is not genuine, is bound to something else, or is stale. */
export function unseal<T = unknown>(key: string, ad: string, sealed: string, now = Date.now()): { value: T; nonce: string } {
  const [nonce, box] = String(sealed).split('.')
  let inner: { t: number; d: T }
  try {
    inner = JSON.parse(bytesToUtf8(xchacha20poly1305(fromB64url(key), fromB64url(nonce), utf8ToBytes(ad)).decrypt(fromB64url(box || ''))))
  } catch {
    throw new SealError('This message was not sealed by a paired device.')
  }
  if (!(Math.abs(now - inner.t) <= SKEW_MS)) throw new SealError('This message is too old, or a clock is off.')
  return { value: inner.d, nonce }
}

/** Refuses a nonce seen before. Seals expire after SKEW_MS, so it only remembers that long (both ways). */
export class ReplayGuard {
  private seen = new Map<string, number>()

  accept(nonce: string, now = Date.now()) {
    for (const [n, at] of this.seen) { if (now - at <= 2 * SKEW_MS) break; this.seen.delete(n) } // oldest first
    if (this.seen.has(nonce)) return false
    this.seen.set(nonce, now)
    return true
  }
}
