// The phone ↔ Mac protocol of the phone companion app: the Mac's app serves it on the local network
// (src/main/remote.ts) and the phone app (mobile/) speaks it. It runs over plain HTTP: every request, reply and event
// is sealed with XChaCha20-Poly1305 under a key only the two share, so the network (and later Manul's relay) sees who
// talks to whom and nothing else.
//   pairing  the Mac shows a QR code: its name, addresses and a one-time secret good for five minutes. The phone seals
//            its own name with that secret; the Mac answers, sealed the same way, with the phone's device id and key.
//   after    each request names its device (DEVICE_HEADER) and carries a seal bound to its method and path (the body,
//            or SEAL_HEADER when there is none). The reply is bound to that request's seal, each event to its stream
//            and its place in it, so nothing can be replayed elsewhere.
//   uploads  footage goes up in chunks, each sealed as bytes (sealBytes) and bound to its upload and its offset, so a
//            chunk can't be moved, repeated or tampered with. A dropped upload asks the Mac how much it has and carries
//            on from there; once whole, the Mac adds the file to the project like any other.
// A seal holds the time it was made: the receiver refuses one more than SKEW_MS off its clock, or seen before.
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { bytesToUtf8, randomBytes, utf8ToBytes } from '@noble/ciphers/utils.js'

export const PROTOCOL = 1
export const PAIR_TTL_MS = 5 * 60_000
export const SKEW_MS = 2 * 60_000
export const DEVICE_HEADER = 'x-manul-device'
export const SEAL_HEADER = 'x-manul-seal'
/** bytes of footage per upload chunk */
export const CHUNK = 1 << 20
/** what sealing adds to a chunk: nonce, time, tag */
export const CHUNK_OVERHEAD = 24 + 8 + 16

export const routes = {
  pair: '/v1/pair',
  /** the Mac's name and where it can be reached now, so a paired phone keeps up (GET) */
  hello: '/v1/hello',
  projects: '/v1/projects',
  events: (project: string) => `/v1/projects/${encodeURIComponent(project)}/events`,
  messages: (project: string) => `/v1/projects/${encodeURIComponent(project)}/messages`,
  stop: (project: string) => `/v1/projects/${encodeURIComponent(project)}/stop`,
  /** start an upload into a project */
  uploads: (project: string) => `/v1/projects/${encodeURIComponent(project)}/uploads`,
  /** how much of an upload the Mac has (GET) */
  upload: (upload: string) => `/v1/uploads/${encodeURIComponent(upload)}`,
  /** the chunk that starts at offset (POST, sealed bytes) */
  chunk: (upload: string, offset: number) => `/v1/uploads/${encodeURIComponent(upload)}/${offset}`,
  cancel: (upload: string) => `/v1/uploads/${encodeURIComponent(upload)}/cancel`,
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
/** What the Mac says to a paired phone that asks (routes.hello). */
export type Hello = { mac: string; name: string; hosts: string[]; port: number }

/** A Tailscale address (100.64.0.0/10, its CGNAT range): the Mac on the person's tailnet, reachable away from home. */
export const isTailscale = (host: string) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)
/** A message to the agent, with files in the project's media/ attached (what the phone just uploaded). */
export type RemoteMessage = { text: string; files?: string[] }
/** A file the phone is about to send. */
export type UploadStart = { name: string; size: number }
/** Where an upload stands: bytes the Mac has, and once it is whole, where it landed in the project (media/…). */
export type UploadState = { upload: string; name: string; size: number; received: number; files?: string[] }

/** Additional data each seal is bound to: what it is, and for which request or stream. */
export const aad = {
  pair: 'manul/1 pair',
  paired: 'manul/1 paired',
  request: (method: string, path: string) => `manul/1 phone ${method.toUpperCase()} ${path}`,
  /** a reply to the request whose seal had this nonce */
  reply: (nonce: string) => `manul/1 mac reply ${nonce}`,
  /** the seq-th event of the stream opened by the request whose seal had this nonce */
  event: (nonce: string, seq: number) => `manul/1 mac event ${nonce} ${seq}`,
  /** the bytes of an upload that start at offset */
  chunk: (upload: string, offset: number) => `manul/1 phone chunk ${upload} ${offset}`,
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

/** Bytes sealed under `key` and bound to `ad`: nonce, then the box of the time it was made and the bytes. No JSON or
 *  base64 on the way, so a chunk of footage costs CHUNK_OVERHEAD more than itself. */
export function sealBytes(key: string, ad: string, bytes: Uint8Array, now = Date.now()): Uint8Array {
  const nonce = randomBytes(24)
  const inner = new Uint8Array(8 + bytes.length)
  new DataView(inner.buffer).setFloat64(0, now)
  inner.set(bytes, 8)
  const box = xchacha20poly1305(fromB64url(key), nonce, utf8ToBytes(ad)).encrypt(inner)
  const out = new Uint8Array(24 + box.length)
  out.set(nonce)
  out.set(box, 24)
  return out
}

/** The bytes in a sealBytes seal, and its nonce; throws SealError like unseal. */
export function unsealBytes(key: string, ad: string, sealed: Uint8Array, now = Date.now()): { value: Uint8Array; nonce: string } {
  let inner: Uint8Array
  try {
    if (sealed.length < CHUNK_OVERHEAD) throw new Error()
    inner = xchacha20poly1305(fromB64url(key), sealed.subarray(0, 24), utf8ToBytes(ad)).decrypt(sealed.subarray(24))
  } catch {
    throw new SealError('This message was not sealed by a paired device.')
  }
  const t = new DataView(inner.buffer, inner.byteOffset, 8).getFloat64(0)
  if (!(Math.abs(now - t) <= SKEW_MS)) throw new SealError('This message is too old, or a clock is off.')
  return { value: inner.subarray(8), nonce: b64url(sealed.subarray(0, 24)) }
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
