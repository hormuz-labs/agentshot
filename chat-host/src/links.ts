// Video links for the editor page: an address on the hosted server that plays one project's files for a while, for
// the person it was made for. Signed, so a link can't be changed into another person's or another project's; it
// runs out, so a copied link stops working.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type Link = { sub: string; dir: string; exp: number }

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
const sig = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url')

export function signLink(secret: string, link: Link) {
  const payload = b64(JSON.stringify([link.sub, link.dir, link.exp]))
  return `${payload}.${sig(secret, payload)}`
}

export function readLink(secret: string, token: string, now = Date.now()): Link | undefined {
  const [payload, given, ...rest] = token.split('.')
  if (!payload || !given || rest.length) return
  const want = Buffer.from(sig(secret, payload)), got = Buffer.from(given)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return
  try {
    const [sub, dir, exp] = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (typeof sub !== 'string' || typeof dir !== 'string' || typeof exp !== 'number' || exp <= now) return
    return { sub, dir, exp }
  } catch { return }
}
