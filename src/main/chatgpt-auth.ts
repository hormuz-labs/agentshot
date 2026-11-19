// Public-client OAuth for local OSS ChatGPT plan usage. No Pi/Codex client impersonation.
import { createHash, createPublicKey, randomBytes, randomUUID, verify, type JsonWebKey } from 'node:crypto'
import { createServer } from 'node:http'
import type { ChatGPTStatus } from '../shared/chatgpt'

const ISSUER = 'https://auth.openai.com'
const RESOURCE = 'https://api.openai.com/v1'
const DIRECT = 'chatgpt.tokens.use.direct'
const SCOPES = `openid profile email offline_access resource.invoke ${DIRECT}`
const random = () => randomBytes(32).toString('base64url')
type Tokens = { access: string; refresh: string; idToken: string; expires: number; scopes: string[] }
type Account = { clientId: string; subject: string; email?: string; tokens?: Tokens }
export type ChatGPTStore = { hostId: string; active?: string; accounts: Account[]; welcomed?: boolean }
export type ChatGPTModel = {
  slug: string; display_name: string; visibility: string
  supported_in_api?: boolean; context_window?: number; input_modalities?: string[]
  supported_reasoning_levels?: { effort: string }[]
}
type TokenResponse = { access_token: string; refresh_token?: string; id_token?: string; token_type: string; expires_in: number; scope?: string }

/** Always verify the signature before reading identity; never trust a decoded JWT alone. */
export async function validateChatGPTIdToken(token: string, clientId: string, nonce: string | undefined, request: typeof fetch, subject?: string) {
  const invalid = () => new Error('ChatGPT identity validation failed. Please sign in again.')
  try {
    const parts = token.split('.')
    if (parts.length !== 3) throw invalid()
    const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString())
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid()
    const r = await request(`${ISSUER}/.well-known/jwks.json`, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
    if (!r.ok) throw invalid()
    const { keys } = await r.json() as { keys: (JsonWebKey & { kid?: string; use?: string })[] }
    const jwk = keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.use || k.use === 'sig'))
    if (!jwk || !verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: 'jwk' }), Buffer.from(parts[2], 'base64url'))) throw invalid()
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    const now = Date.now() / 1000
    if (claims.iss !== ISSUER || !(Array.isArray(claims.aud) ? claims.aud.includes(clientId) : claims.aud === clientId) ||
      typeof claims.exp !== 'number' || claims.exp <= now || (claims.nbf !== undefined && claims.nbf > now + 30) ||
      typeof claims.sub !== 'string' || !claims.sub || (nonce !== undefined && claims.nonce !== nonce) || (subject && claims.sub !== subject)) throw invalid()
    return { subject: claims.sub as string, email: typeof claims.email === 'string' ? claims.email : undefined }
  } catch { throw invalid() }
}

/** Inject storage and HTTP for deterministic tests; production storage is encrypted and atomic. */
export class ChatGPTAuth {
  private state: ChatGPTStore
  private pending?: AbortController
  private refreshing = new Map<string, Promise<string>>()
  private catalogs = new Map<string, { models: ChatGPTModel[]; at: number }>()
  private sessions = new Map<string, AbortController>()
  private warning?: string
  // A registration whose code exchange failed has no verified identity yet. Keep it
  // separate from accounts, but reuse its issued client for fresh authorization.
  private registration?: string
  constructor(private storage: { read(): ChatGPTStore | undefined; write(s: ChatGPTStore): void }, private request: typeof fetch = (...a) => fetch(...a)) {
    this.state = storage.read() || { hostId: `urn:uuid:${randomUUID()}`, accounts: [] }
  }
  status(available = true): ChatGPTStatus {
    return { available, active: this.state.active, accounts: this.state.accounts.map(a => ({ id: a.clientId,
      label: `${a.email || 'ChatGPT account'} · ${a.clientId.slice(-8)}`, connected: !!a.tokens })), warning: this.warning }
  }
  private save(next: ChatGPTStore) { this.storage.write(next); this.state = next }
  private account(id = this.state.active) { return this.state.accounts.find(a => a.clientId === id) }
  cancel() { this.pending?.abort() }
  requestSignal(id: string) {
    if (!this.account(id)?.tokens || this.state.active !== id) throw new Error('ChatGPT session changed. Please retry.')
    let session = this.sessions.get(id)
    if (!session || session.signal.aborted) { session = new AbortController(); this.sessions.set(id, session) }
    return session.signal
  }
  async signIn(open: (url: string) => Promise<void> | void, id?: string, timeoutMs = 5 * 60_000) {
    for (let attempt = 0; ; attempt++) {
      try { return await this.signInAttempt(open, id, timeoutMs) }
      catch (error) {
        if (attempt !== 0 || (error as { code?: string }).code !== 'invalid_grant') throw error
        // Never replay an authorization code. New listener, state, nonce and PKCE.
      }
    }
  }
  private async signInAttempt(open: (url: string) => Promise<void> | void, id?: string, timeoutMs = 5 * 60_000): Promise<ChatGPTStatus & { firstSignIn: boolean }> {
    if (this.pending) throw new Error('A ChatGPT sign-in is already in progress.')
    const selected = id ? this.account(id) : undefined
    const issuedClient = selected?.clientId || (!id ? this.registration : undefined)
    if (id && !selected) throw new Error('Unknown ChatGPT account.')
    // Persist the stable host before the first browser authorization.
    this.save(this.state)
    const controller = new AbortController()
    this.pending = controller
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const state = random(), nonce = random(), verifier = random()
    let redirect = ''
    let received = false
    const server = createServer()
    try {
      const result = await new Promise<{ code: string; clientId: string }>((resolve, reject) => {
        const abort = () => reject(new Error('ChatGPT sign-in was cancelled or timed out.'))
        controller.signal.addEventListener('abort', abort, { once: true })
        server.on('error', () => reject(new Error('Could not start the ChatGPT callback listener.')))
        server.on('request', (req, res) => {
          const url = new URL(req.url || '/', redirect)
          if (req.method !== 'GET' || url.pathname !== '/auth/callback') { res.writeHead(404).end(); return }
          if (received || url.searchParams.getAll('state').length !== 1 || url.searchParams.get('state') !== state) { res.writeHead(400).end('Invalid sign-in state.'); return }
          const error = url.searchParams.get('error')
          if (error) { received = true; res.writeHead(400).end('ChatGPT was not connected.'); reject(new Error('ChatGPT permission was not granted. Please try again.')); return }
          const code = url.searchParams.get('code')
           const clientId = url.searchParams.get('client_id') || issuedClient
           if (!code || !clientId || clientId === 'dynamic_agent_client' || (issuedClient && clientId !== issuedClient) ||
            url.searchParams.getAll('code').length !== 1 || url.searchParams.getAll('client_id').length > 1) {
            res.writeHead(400).end('Incomplete registration.'); return
          }
          received = true
          res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end('Return to AgentShot to finish connecting ChatGPT. You can close this tab.')
          resolve({ code, clientId })
        })
        server.listen(0, '127.0.0.1', async () => {
          const address = server.address()
          if (!address || typeof address === 'string') { abort(); return }
          redirect = `http://127.0.0.1:${address.port}/auth/callback`
           const params = new URLSearchParams({ client_id: issuedClient || 'dynamic_agent_client', ext_agent_host_id: this.state.hostId,
            response_type: 'code', redirect_uri: redirect, scope: SCOPES, resource: RESOURCE, state, nonce,
            code_challenge_method: 'S256', code_challenge: createHash('sha256').update(verifier).digest('base64url') })
           if (!issuedClient) params.set('agent_name_hint', 'AgentShot')
          if (selected?.tokens?.idToken) params.set('id_token_hint', selected.tokens.idToken)
          if (selected?.email) params.set('login_hint', selected.email)
          try { if (!controller.signal.aborted) await open(`${ISSUER}/api/accounts/authorize?${params}`) } catch { reject(new Error('Could not open the browser for ChatGPT sign-in.')) }
        })
      })
      server.close(); server.closeAllConnections()
      if (!selected) this.registration = result.clientId
      const token = await this.token({ grant_type: 'authorization_code', client_id: result.clientId, code: result.code,
        code_verifier: verifier, redirect_uri: redirect, resource: RESOURCE }, controller.signal)
      if (!token.id_token) throw new Error('ChatGPT did not return an identity token.')
      const identity = await validateChatGPTIdToken(token.id_token, result.clientId, nonce, this.request, selected?.subject)
      const tokens = this.tokens(token)
      controller.signal.throwIfAborted()
      const existing = this.account(result.clientId)
      if (existing && existing.subject !== identity.subject) throw new Error('The ChatGPT account did not match its registration.')
      const account: Account = { clientId: result.clientId, ...identity, tokens }
      const catalog = await this.fetchCatalog(tokens.access, controller.signal)
      controller.signal.throwIfAborted()
      this.save({ ...this.state, active: account.clientId, accounts: [...this.state.accounts.filter(a => a.clientId !== account.clientId), account] })
      for (const session of this.sessions.values()) session.abort()
      this.catalogs.set(account.clientId, { models: catalog, at: Date.now() })
      this.warning = undefined
      this.registration = undefined
      return { ...this.status(), firstSignIn: !this.state.welcomed }
    } finally {
      clearTimeout(timer); server.close(); server.closeAllConnections()
      if (this.pending === controller) this.pending = undefined
    }
  }
  welcome() { this.save({ ...this.state, welcomed: true }) }
  select(id: string) {
    if (this.pending) throw new Error('Finish or cancel ChatGPT sign-in first.')
    if (!this.account(id)?.tokens) throw new Error('Sign in to this ChatGPT account first.')
    this.save({ ...this.state, active: id })
    for (const session of this.sessions.values()) session.abort()
    return this.status()
  }
  private async token(body: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
    const r = await this.request(`${ISSUER}/api/accounts/oauth/token`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (!r.ok) {
      const data = await r.json().catch(() => ({})) as { error?: string | { code?: string }; error_code?: string }
      // Never forward error descriptions or raw bodies: providers can echo grant credentials.
      const raw = typeof data.error === 'string' ? data.error : data.error?.code || data.error_code
      const code = typeof raw === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(raw) ? raw : undefined
      const requestId = r.headers.get('x-request-id')
      const reference = requestId && /^[a-zA-Z0-9_-]{1,100}$/.test(requestId) ? `; request ${requestId}` : ''
      const stage = body.grant_type === 'authorization_code' ? 'ChatGPT sign-in was rejected' : 'ChatGPT session could not be renewed'
      const recovery = code === 'invalid_client' ? 'The app’s OAuth registration was rejected; retrying alone may not fix it.'
        : r.status >= 500 || r.status === 429 ? 'Could not reach ChatGPT. Try again in a moment.' : 'Please try signing in again.'
      throw Object.assign(new Error(`${stage} (HTTP ${r.status}${code ? `; ${code}` : ''}${reference}). ${recovery}`), { code })
    }
    return await r.json() as TokenResponse
  }
  private tokens(t: TokenResponse, previous?: Tokens): Tokens {
    const scopes = t.scope === undefined && previous ? previous.scopes : typeof t.scope === 'string' ? t.scope.split(/\s+/) : []
    if (t.token_type?.toLowerCase() !== 'bearer' || typeof t.access_token !== 'string' || !t.access_token ||
      typeof t.expires_in !== 'number' || !Number.isFinite(t.expires_in) || t.expires_in <= 0 ||
      !scopes.includes(DIRECT) || !scopes.includes('resource.invoke') ||
      typeof (t.refresh_token || previous?.refresh) !== 'string' || !(t.refresh_token || previous?.refresh) ||
      typeof (t.id_token || previous?.idToken) !== 'string' || !(t.id_token || previous?.idToken)) {
      throw new Error('ChatGPT plan usage was not enabled or the token response was incomplete. Sign in again.')
    }
    return { access: t.access_token, refresh: t.refresh_token || previous!.refresh, idToken: t.id_token || previous!.idToken,
      expires: Date.now() + t.expires_in * 1000, scopes }
  }
  /** Serialized rotating refresh; signing out cannot be undone by an in-flight refresh. */
  async accessToken(id = this.state.active): Promise<string> {
    const a = this.account(id)
    if (!a?.tokens) throw new Error('Connect your ChatGPT account in Settings → Keys.')
    if (a.tokens.expires > Date.now() + 3 * 60_000) return a.tokens.access
    const inflight = this.refreshing.get(a.clientId)
    if (inflight) return inflight
    const previous = a.tokens
    const work = (async () => {
      const response = await this.token({ grant_type: 'refresh_token', client_id: a.clientId, refresh_token: previous.refresh, resource: RESOURCE })
      if (response.id_token) await validateChatGPTIdToken(response.id_token, a.clientId, undefined, this.request, a.subject)
      const tokens = this.tokens(response, previous)
      if (this.account(a.clientId)?.tokens !== previous) throw new Error('ChatGPT session changed. Please try again.')
      this.save({ ...this.state, accounts: this.state.accounts.map(x => x.clientId === a.clientId ? { ...x, tokens } : x) })
      return tokens.access
    })()
    this.refreshing.set(a.clientId, work)
    try { return await work } finally { if (this.refreshing.get(a.clientId) === work) this.refreshing.delete(a.clientId) }
  }
  private async fetchCatalog(access: string, signal?: AbortSignal) {
    const r = await this.request(`${RESOURCE}/models`, { redirect: 'error', headers: { authorization: `Bearer ${access}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) })
    if (!r.ok) throw new Error('Could not load the models available to your ChatGPT account. Try again.')
    const data = await r.json() as { models: ChatGPTModel[] }
    if (!Array.isArray(data.models)) throw new Error('ChatGPT returned an invalid model list.')
    return data.models.filter(m => m.visibility === 'list' && m.supported_in_api !== false && typeof m.slug === 'string' && m.slug && typeof m.display_name === 'string')
  }
  async models() {
    const id = this.state.active
    if (!this.account(id)?.tokens || !id) return []
    const cached = this.catalogs.get(id)
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.models
    const models = await this.fetchCatalog(await this.accessToken(id))
    if (this.state.active !== id || !this.account(id)?.tokens) return []
    this.catalogs.set(id, { models, at: Date.now() })
    return models
  }
  async signOut(id = this.state.active) {
    this.cancel()
    const a = this.account(id)
    if (!a) return this.status()
    const refresh = a.tokens?.refresh
    this.save({ ...this.state, active: this.state.active === id ? undefined : this.state.active,
      accounts: this.state.accounts.map(x => x.clientId === id ? { ...x, tokens: undefined } : x) })
    this.sessions.get(a.clientId)?.abort()
    this.catalogs.delete(a.clientId)
    this.warning = undefined
    if (refresh) {
      try {
        const discovery = await this.request(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
        if (!discovery.ok) throw new Error()
        const { revocation_endpoint: endpoint } = await discovery.json() as { revocation_endpoint: string }
        if (new URL(endpoint).origin !== ISSUER) throw new Error()
        let ok = false
        for (let attempt = 0; attempt < 2; attempt++) {
          const r = await this.request(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token: refresh, token_type_hint: 'refresh_token', client_id: a.clientId }) })
          if (r.status === 200) { ok = true; break }
          if (r.status < 500) break
          await new Promise(resolve => setTimeout(resolve, 500))
        }
        if (!ok) throw new Error()
      } catch { this.warning = 'Signed out locally. Remote revocation was not confirmed; disconnect AgentShot in ChatGPT Settings → Usage.' }
    }
    return this.status()
  }
}
