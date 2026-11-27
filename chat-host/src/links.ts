// Video links for the editor page: an address on the hosted server that plays one project's files for a while, for
// the person it was made for. Signed, so a link can't be changed into another person's or another project's; it
// runs out, so a copied link stops working.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type Link = { sub: string; dir: string; exp: number }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const sig = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

/** An upload link: one file, this name and size, for this person, as a new project or into [dir]. */
export type Upload = { sub: string; name: string; size: number; dir?: string; exp: number }

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

export const signLink = (secret: string, link: Link) => sign(secret, 'media', [link.sub, link.dir, link.exp])

export function readLink(secret: string, token: string, now = Date.now()): Link | undefined {
  const f = read(secret, 'media', token, now)
  if (!f) return
  const [sub, dir, exp] = f
  return typeof sub === 'string' && typeof dir === 'string' ? { sub, dir, exp: exp as number } : undefined
}

export const signUpload = (secret: string, u: Upload) => sign(secret, 'upload', [u.sub, u.name, u.size, u.dir ?? null, u.exp])

export function readUpload(secret: string, token: string, now = Date.now()): Upload | undefined {
  const f = read(secret, 'upload', token, now)
  if (!f) return
  const [sub, name, size, dir, exp] = f
  if (typeof sub !== 'string' || typeof name !== 'string' || typeof size !== 'number' || (dir !== null && typeof dir !== 'string')) return
  return { sub, name, size, ...(dir ? { dir: dir as string } : {}), exp: exp as number }
}
