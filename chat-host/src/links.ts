// Video links for the editor page: an address on the hosted server that plays one project's files for a while, for
// the person it was made for. Signed, so a link can't be changed into another person's or another project's; it
// runs out, so a copied link stops working.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/** A person's AgentShot key (people.ts). */
type Key = { key: string; keyId: string }
/** [key]: the person's AgentShot key, which a link carries sealed, so whichever copy of the server the link reaches
 *  (or the same one, started again) can lease their worker with nothing kept from before. */
export type Link = { sub: string; dir: string; exp: number; key?: Key }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const sig = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

/** An upload link: one file, this name and size, for this person, as a new project or into [dir]. */
export type Upload = { sub: string; name: string; size: number; dir?: string; exp: number; key?: Key }

// The key inside a link is sealed (AES-256-GCM, with a key of its own made from the secret): only this server reads
// it back; whoever holds the link, or reads it in a log, has nothing to spend.
const sealKey = (secret: string) => createHash('sha256').update(`agentshot link seal\0${secret}`).digest()
function seal(secret: string, key?: Key): string | null {
  if (!key) return null
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', sealKey(secret), iv)
  const body = Buffer.concat([c.update(JSON.stringify([key.key, key.keyId]), 'utf8'), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), body]).toString('base64url')
}
function unseal(secret: string, sealed: unknown): Key | undefined {
  if (typeof sealed !== 'string') return
  try {
    const raw = Buffer.from(sealed, 'base64url')
    const d = createDecipheriv('aes-256-gcm', sealKey(secret), raw.subarray(0, 12))
    d.setAuthTag(raw.subarray(12, 28))
    const [key, keyId] = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'))
    return typeof key === 'string' && typeof keyId === 'string' ? { key, keyId } : undefined
  } catch { return }
}

// what kind of link it is goes into what's signed: a video link can't be used to upload, nor the other way round
function sign(secret: string, kind: string, fields: unknown[]) {
  const payload = b64(JSON.stringify([kind, ...fields]))
  return `${payload}.${sig(secret, payload)}`
}
function read(secret: string, kind: string, token: string, now: number): unknown[] | undefined {
  const [payload, given, ...rest] = token.split('.')
  if (!payload || !given || rest.length) return
  const want = Buffer.from(sig(secret, payload)), got = Buffer.from(given)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return
  try {
    const all = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!Array.isArray(all) || all[0] !== kind) return
    const exp = all[all.length - 1]
    return typeof exp === 'number' && exp > now ? all.slice(1) : undefined
  } catch { return }
}

export const signLink = (secret: string, link: Link) => sign(secret, 'media', [link.sub, link.dir, seal(secret, link.key), link.exp])

export function readLink(secret: string, token: string, now = Date.now()): Link | undefined {
  const f = read(secret, 'media', token, now)
  if (!f) return
  const [sub, dir, sealed, exp] = f
  const key = unseal(secret, sealed)
  return typeof sub === 'string' && typeof dir === 'string' ? { sub, dir, exp: exp as number, ...(key ? { key } : {}) } : undefined
}

export const signUpload = (secret: string, u: Upload) => sign(secret, 'upload', [u.sub, u.name, u.size, u.dir ?? null, seal(secret, u.key), u.exp])

export function readUpload(secret: string, token: string, now = Date.now()): Upload | undefined {
  const f = read(secret, 'upload', token, now)
  if (!f) return
  const [sub, name, size, dir, sealed, exp] = f
  const key = unseal(secret, sealed)
  if (typeof sub !== 'string' || typeof name !== 'string' || typeof size !== 'number' || (dir !== null && typeof dir !== 'string')) return
  return { sub, name, size, ...(dir ? { dir: dir as string } : {}), exp: exp as number, ...(key ? { key } : {}) }
}
