// Signing in to AgentShot (Settings → Keys → AgentShot key): Clerk in the system browser (OAuth with PKCE, AgentShot being a public
// client), back to a one-shot server on 127.0.0.1, then AgentShot's account service swaps the sign-in for the person's
// AgentShot key (account/src/index.ts), kept in the keychain like any key. Who's signed in (their email, and the key's id
// for asking about credits) is in config.json. Credits and plans are Pitch's (one wallet for both apps): a plan or a
// top-up is a Dodo Payments checkout in the browser, managing it is Dodo's billing page.
import { createServer, type Server } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { getConfig, setConfig } from './config'
import { MANUL_KEY } from './gateway'
import { setKey } from './keys'
import type { AccountStatus, Balance } from '../shared/types'
import { brandPage } from '../shared/brand-page'

/** Clerk's Frontend API (the OAuth issuer, production), the "AgentShot desktop" OAuth app's client id (public, PKCE), and the
 *  account service. For the development instance: MANUL_AUTH_ISSUER=https://good-wildcat-5360.clerk.accounts.dev
 *  MANUL_AUTH_CLIENT_ID=5E3y3JppmCuVr1UD (and an account service pointed at it). */
export const AUTH = {
  issuer: () => (process.env.MANUL_AUTH_ISSUER || 'https://clerk.agentshot.si').replace(/\/+$/, ''),
  clientId: () => process.env.MANUL_AUTH_CLIENT_ID ?? 'cYz60VvV9IL4cGH5',
  account: () => (process.env.MANUL_ACCOUNT || 'https://account.agentshot.si').replace(/\/+$/, ''),
}
/** Registered in the Clerk OAuth app as the redirect URI. */
export const CALLBACK_PORT = 47619
const REDIRECT = `http://127.0.0.1:${CALLBACK_PORT}/oauth/callback`

export const accountStatus = (): AccountStatus => ({ email: getConfig().account?.email, available: !!AUTH.clientId() })

const b64url = (b: Buffer) => b.toString('base64url')
const PAGE = brandPage

let pending: { server: Server; cancel: () => void; link?: string } | null = null

/** The sign-in link while a sign-in waits: to open in another browser than the default one (the one signed in to the
 *  right Google account). It comes back to this computer either way. */
export const signInLink = () => pending?.link ?? null

/** Sign in: opens the browser, waits for the way back, stores the key. Resolves with who signed in. */
export async function signIn(open: (url: string) => Promise<void> | void, timeoutMs = 5 * 60_000): Promise<AccountStatus> {
  if (!AUTH.clientId()) throw new Error('Signing in isn’t available in this build.')
  pending?.cancel()
  const verifier = b64url(randomBytes(32))
  const state = b64url(randomBytes(16))
  const code = await new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url || '/', REDIRECT)
      if (u.pathname !== '/oauth/callback') { res.writeHead(404).end(); return }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code')
      res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
        .end(PAGE(ok ? 'Signed in. You can close this tab and go back to AgentShot.' : 'Signing in didn’t finish. Go back to AgentShot and try again.'))
      if (!ok) return
      done(); resolve(u.searchParams.get('code')!)
    })
    const timer = setTimeout(() => { done(); reject(new Error('Signing in took too long. Try again.')) }, timeoutMs)
    const done = () => { clearTimeout(timer); server.close(); pending = null }
    pending = { server, cancel: () => { done(); reject(new Error('Signing in was cancelled.')) } }
    server.on('error', e => { done(); reject((e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new Error(`Port ${CALLBACK_PORT} is busy: close what uses it and try again.`) : e) })
    server.listen(CALLBACK_PORT, '127.0.0.1', async () => {
      const q = new URLSearchParams({
        response_type: 'code', client_id: AUTH.clientId(), redirect_uri: REDIRECT, scope: 'openid email profile',
        state, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
      })
      const link = `${AUTH.issuer()}/oauth/authorize?${q}`
      if (pending) pending.link = link
      try { await open(link) } catch (e) { done(); reject(e) }
    })
  })

  const tok = await fetch(`${AUTH.issuer()}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: AUTH.clientId(), code_verifier: verifier }),
  })
  if (!tok.ok) throw new Error('Signing in didn’t finish. Try again.')
  const { access_token } = await tok.json() as { access_token: string }

  const got = await fetch(`${AUTH.account()}/v1/key`, { method: 'POST', headers: { authorization: `Bearer ${access_token}` } })
  const body = await got.json().catch(() => ({})) as { key?: string; key_id?: string; email?: string; error?: string }
  if (!got.ok || !body.key) throw new Error(body.error || 'Could not get your AgentShot key. Try again in a moment.')
  setKey(MANUL_KEY, body.key)
  setConfig({ account: { email: body.email, keyId: body.key_id } })
  return accountStatus()
}

/** Signs this computer in with an AgentShot key from the person's phone, once the account service accepts it. */
export async function adoptKey(account: { key: string; keyId?: string; email?: string }): Promise<AccountStatus> {
  const r = await fetch(`${AUTH.account()}/v1/balance`, { headers: { authorization: `Bearer ${account.key}`, ...(account.keyId ? { 'x-manul-key-id': account.keyId } : {}) } }).catch(() => null)
  if (!r?.ok) throw new Error('That AgentShot sign-in didn’t work. Sign in again on your phone.')
  setKey(MANUL_KEY, account.key)
  setConfig({ account: { email: account.email, keyId: account.keyId } })
  return accountStatus()
}

/** The account service, as the signed-in key. */
async function asKeyRaw(path: string, init: RequestInit = {}) {
  const keyId = getConfig().account?.keyId
  const key = process.env[MANUL_KEY]
  if (!keyId || !key) throw new Error('Sign in to AgentShot first.')
  const r = await fetch(`${AUTH.account()}${path}`, { ...init, headers: { authorization: `Bearer ${key}`, 'x-manul-key-id': keyId, 'content-type': 'application/json' } })
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as Record<string, unknown>
    throw new Error((body.error as string) || 'Could not reach AgentShot. Try again in a moment.')
  }
  return r
}
const asKey = async (path: string, init: RequestInit = {}) => await (await asKeyRaw(path, init)).json().catch(() => ({})) as Record<string, unknown>

/** Voice or music made by AgentShot (it picks the vendor), paid with the signed-in person's credits. */
export async function agentshotMedia(kind: 'voice' | 'music', body: unknown, signal?: AbortSignal) {
  const r = await asKeyRaw(`/v1/${kind}`, { method: 'POST', body: JSON.stringify(body), signal })
  const type = r.headers.get('content-type') || ''
  return { data: new Uint8Array(await r.arrayBuffer()), ext: /wav/.test(type) ? 'wav' : 'mp3', cost: Number(r.headers.get('x-manul-cost')) || 0 }
}

/** The signed-in person's credits, plan, model tiers, and the plans and top-ups on sale. */
export const balance = async () => (await asKey('/v1/balance')) as unknown as Balance

/** A plan (pro, max, pro_annual, max_annual) or a top-up (flex): a Dodo Payments checkout in the browser. */
export async function checkout(open: (url: string) => Promise<void> | void, what: { plan: string } | { topup: string }) {
  const { url } = await asKey('/v1/checkout', { method: 'POST', body: JSON.stringify(what) }) as { url: string }
  await open(url)
}

/** Change the card, see invoices or cancel: Dodo's billing page in the browser. */
export async function manageBilling(open: (url: string) => Promise<void> | void) {
  const { url } = await asKey('/v1/portal', { method: 'POST' }) as { url: string }
  await open(url)
}

export function cancelSignIn() { pending?.cancel(); codeWaiting?.() }

let codeWaiting: (() => void) | null = null

/** Sign in with a code, for a computer whose browser is signed in to someone else: the account service gives a code to
 *  show ([show]); once it's typed on the person's phone, signed in there, this computer has the same account. Resolves
 *  with who signed in. */
export async function signInWithCode(show: (code: string, expiresAt: number) => void, everyMs = 2_000): Promise<AccountStatus> {
  codeWaiting?.()
  const r = await fetch(`${AUTH.account()}/v1/link/start`, { method: 'POST', signal: AbortSignal.timeout(15_000) }).catch(() => null)
  if (!r?.ok) throw new Error('Could not reach AgentShot. Try again in a moment.')
  const { code, secret, expiresAt } = await r.json() as { code: string; secret: string; expiresAt: number }
  show(code, expiresAt)
  let cancelled = false
  codeWaiting = () => { cancelled = true }
  try {
    while (!cancelled && Date.now() < expiresAt) {
      await new Promise(done => setTimeout(done, everyMs))
      if (cancelled) break
      const t = await fetch(`${AUTH.account()}/v1/link/take`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, secret }), signal: AbortSignal.timeout(15_000),
      }).catch(() => null)
      if (!t || t.status === 202 || t.status >= 500) continue // waiting for the phone, or a hiccup: ask again
      if (!t.ok) break
      const got = await t.json() as { key: string; key_id: string; email: string }
      setKey(MANUL_KEY, got.key)
      setConfig({ account: { email: got.email, keyId: got.key_id } })
      return accountStatus()
    }
    throw new Error(cancelled ? 'Signing in was cancelled.' : 'That code ran out. Make a new one.')
  } finally {
    codeWaiting = null
  }
}

/** Sign out on this computer: the key goes (it stays the person's: signing in again brings it back). */
export function signOut(): AccountStatus {
  setKey(MANUL_KEY, '')
  setConfig({ account: undefined })
  return accountStatus()
}

export type DiscoveredWorker = {
  id: string
  name: string
  pool: boolean
  urls: string[]
  fingerprint: string
  token: string
  capabilities: Record<string, unknown>
  expiresAt: number
}

export async function meshJoin(role: 'client' | 'worker', poolSecret?: string, opts: { persistent?: boolean } = {}): Promise<{ controlUrl: string; authKey: string; tag: string }> {
  if (poolSecret) {
    const r = await fetch(`${AUTH.account()}/v1/mesh/join`, {
      method: 'POST',
      headers: { 'x-manul-pool-secret': poolSecret, 'content-type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    const body = (await r.json().catch(() => ({}))) as { controlUrl?: string; authKey?: string; tag?: string; error?: string }
    if (!r.ok || !body.controlUrl || !body.authKey) throw new Error(body.error || 'Could not join mesh.')
    return { controlUrl: body.controlUrl, authKey: body.authKey, tag: body.tag || 'tag:worker' }
  }
  return (await asKey('/v1/mesh/join', { method: 'POST', body: JSON.stringify({ role, ...opts }) })) as { controlUrl: string; authKey: string; tag: string }
}

/** What the account says back to a worker's heartbeat: whether it's a cloud worker and who leases it, until when. */
export type HeartbeatReply = { pool?: boolean; leasedTo?: string | null; leasedUntil?: number | null }

export async function workerHeartbeat(body: Record<string, unknown>, poolSecret?: string): Promise<HeartbeatReply> {
  if (poolSecret) {
    const r = await fetch(`${AUTH.account()}/v1/workers/heartbeat`, {
      method: 'POST',
      headers: { 'x-manul-pool-secret': poolSecret, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw new Error('Worker heartbeat failed.')
    return (await r.json().catch(() => ({}))) as HeartbeatReply
  }
  return (await asKey('/v1/workers/heartbeat', { method: 'POST', body: JSON.stringify(body) })) as HeartbeatReply
}

export async function accountWorkers(): Promise<{ workers: DiscoveredWorker[]; poolAvailable: number }> {
  return (await asKey('/v1/workers')) as { workers: DiscoveredWorker[]; poolAvailable: number }
}

export async function leaseAccountWorker(opts: { projectId?: string; workerId?: string } = {}): Promise<DiscoveredWorker> {
  const out = (await asKey('/v1/workers/lease', { method: 'POST', body: JSON.stringify(opts) })) as { worker: DiscoveredWorker }
  return out.worker
}

export async function releaseAccountWorker(workerId: string): Promise<boolean> {
  const out = (await asKey('/v1/workers/release', { method: 'POST', body: JSON.stringify({ workerId }) })) as { released: boolean }
  return !!out.released
}
