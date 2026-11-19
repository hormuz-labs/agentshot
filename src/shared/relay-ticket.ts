// Short-lived routing credentials. They authorize a tunnel, never decrypt its pinned TLS bytes.
import { createHmac, timingSafeEqual } from 'node:crypto'

export type RelayTicket = { role: 'worker' | 'client'; worker: string; owner: string; expires: number }
export function signRelayTicket(secret: string, ticket: RelayTicket): string {
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url')
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
}
export function verifyRelayTicket(secret: string, raw: string, now = Date.now()): RelayTicket | undefined {
  if (!secret || raw.length > 2048) return
  const [body, mac, extra] = raw.split('.')
  if (!body || !mac || extra) return
  const expected = createHmac('sha256', secret).update(body).digest()
  const actual = Buffer.from(mac, 'base64url')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return
  try {
    const t = JSON.parse(Buffer.from(body, 'base64url').toString()) as RelayTicket
    if (!['worker', 'client'].includes(t.role) || typeof t.worker !== 'string' || !/^[a-zA-Z0-9._-]{3,80}$/.test(t.worker) || typeof t.owner !== 'string' || !t.owner || !Number.isSafeInteger(t.expires) || t.expires <= now) return
    return t
  } catch { return }
}
