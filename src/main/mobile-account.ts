import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { AUTH, oauthLogin, cancelSignIn } from './account'

type Session = { access: string; refresh?: string; expires: number; email: string; sub: string; id: string; issuer: string; client: string }
let session: Session | undefined
let refreshing: Promise<string> | undefined
let generation = 0
const file = () => join(app.getPath('userData'), 'mobile-account.enc')
function read() {
  if (!session) {
    try { session = JSON.parse(safeStorage.decryptString(readFileSync(file()))) } catch { /* Not signed in. */ }
  }
  if (session && (session.issuer !== AUTH.issuer() || session.client !== AUTH.clientId())) session = undefined
  return session
}
function save(value: Session) {
  writeFileSync(file(), safeStorage.encryptString(JSON.stringify(value)), { mode: 0o600 })
  session = value
}
export const mobileAccount = () => { const s = read(); return s ? { email: s.email, id: s.id, sub: s.sub } : undefined }
export async function mobileSignIn(open: (url: string) => Promise<void>) {
  const attempt = ++generation
  const previous = read()
  const tokens = await oauthLogin(open, 5 * 60_000, true)
  const response = await fetch(`${AUTH.issuer()}/oauth/userinfo`, { headers: { authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error('Could not verify your Manul account')
  const who = await response.json() as { sub: string; email?: string }
  if (!who.sub) throw new Error('Missing account identity')
  if (attempt !== generation) throw new Error('Sign-in cancelled')
  save({ access: tokens.access_token, refresh: tokens.refresh_token, expires: Date.now() + (tokens.expires_in || 3600) * 1000, email: who.email || 'Manul account', sub: who.sub, id: previous?.sub === who.sub ? previous.id : randomBytes(16).toString('hex'), issuer: AUTH.issuer(), client: AUTH.clientId() })
}
export async function mobileAccessToken(): Promise<string> {
  const s = read()
  if (!s) throw new Error('Sign in to Manul first')
  if (s.expires > Date.now() + 60_000) return s.access
  if (refreshing) return refreshing
  refreshing = (async () => {
    if (!s.refresh) throw new Error('Sign in to Manul again')
    const response = await fetch(`${AUTH.issuer()}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: s.refresh, client_id: AUTH.clientId() }), signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error('Sign in to Manul again')
    const tokens = await response.json() as { access_token: string; refresh_token?: string; expires_in?: number }
    if (!tokens.access_token || session !== s) throw new Error('Sign-in changed')
    save({ ...s, access: tokens.access_token, refresh: tokens.refresh_token || s.refresh, expires: Date.now() + (tokens.expires_in || 3600) * 1000 })
    return tokens.access_token
  })().finally(() => { refreshing = undefined })
  return refreshing
}
export function mobileSignOut() { generation++; cancelSignIn(); session = undefined; rmSync(file(), { force: true }) }
