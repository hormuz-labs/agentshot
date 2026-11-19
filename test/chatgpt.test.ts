import { generateKeyPairSync, sign, createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createModels } from '@earendil-works/pi-ai/models'
import { ChatGPTAuth, validateChatGPTIdToken, type ChatGPTStore } from '../src/main/chatgpt-auth'
import { chatGPTPayload, chatGPTProvider } from '../src/main/chatgpt-provider'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test', use: 'sig' }
function jwt(clientId: string, nonce?: string, extra: Record<string, unknown> = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url')
  const claims = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: clientId, sub: 'user', email: 'user@example.com', exp: Date.now() / 1000 + 3600, nonce, ...extra })).toString('base64url')
  return `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), privateKey).toString('base64url')}`
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status })
const scopes = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'
function fixture(expired = false) {
  let saved: ChatGPTStore = { hostId: 'urn:uuid:fixed', active: 'oaiapp_one', accounts: [{ clientId: 'oaiapp_one', subject: 'user', email: 'user@example.com',
    tokens: { access: 'access-secret', refresh: 'refresh-secret', idToken: jwt('oaiapp_one'), expires: Date.now() + (expired ? -1 : 3600_000), scopes: scopes.split(' ') } }] }
  const storage = { read: () => saved, write: vi.fn((s: ChatGPTStore) => { saved = s }) }
  const request = vi.fn(async (input: any, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    if (url.endsWith('jwks.json')) return json({ keys: [jwk] })
    if (url.endsWith('/models')) return json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol', visibility: 'list' }, { slug: 'hidden', display_name: 'Hidden', visibility: 'hidden' }] })
    if (url.endsWith('/openid-configuration')) return json({ revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' })
    if (url.endsWith('/revoke')) return new Response(null, { status: 200 })
    if (url.endsWith('/token')) return json({ access_token: 'new-access', refresh_token: 'new-refresh', token_type: 'Bearer', expires_in: 3600, scope: scopes,
      ...(String(init?.body).includes('authorization_code') ? { id_token: jwt('oaiapp_one', new URLSearchParams(String(init?.body)).get('nonce') || undefined) } : {}) })
    throw new Error('Unexpected HTTP call')
  })
  return { storage, request, auth: new ChatGPTAuth(storage, request as typeof fetch), saved: () => saved }
}

describe('ChatGPT identity verification', () => {
  const request = async () => json({ keys: [jwk] })
  it('validates a signed identity against issuer, client and nonce', async () => {
    expect(await validateChatGPTIdToken(jwt('client', 'nonce'), 'client', 'nonce', request)).toEqual({ subject: 'user', email: 'user@example.com' })
  })
  it.each([{ iss: 'https://evil.invalid' }, { aud: 'other' }, { nonce: 'wrong' }, { exp: 1 }, { sub: '' }])('rejects invalid claims %j', async extra => {
    await expect(validateChatGPTIdToken(jwt('client', 'nonce', extra), 'client', 'nonce', request)).rejects.toThrow('identity validation')
  })
  it('rejects a forged signature and a changed returning identity', async () => {
    const token = jwt('client', 'nonce')
    await expect(validateChatGPTIdToken(`${token.slice(0, token.lastIndexOf('.') + 1)}AAAA`, 'client', 'nonce', request)).rejects.toThrow('identity validation')
    await expect(validateChatGPTIdToken(token, 'client', 'nonce', request, 'different')).rejects.toThrow('identity validation')
  })
})

describe('ChatGPT session lifecycle', () => {
  it('recovers invalid_grant with fresh PKCE and authorization on the issued registration', async () => {
    let saved: ChatGPTStore = { hostId: 'urn:uuid:fixed', accounts: [] }
    const authorizations: URL[] = [], grants: URLSearchParams[] = []
    const request = vi.fn(async (u, init) => {
      if (String(u).endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body)); grants.push(body)
        if (grants.length === 1) return json({ error: 'invalid_grant' }, 400)
        return json({ access_token: 'fresh-access', refresh_token: 'fresh-refresh', id_token: jwt('oaiapp_issued', authorizations[1].searchParams.get('nonce')!), token_type: 'Bearer', expires_in: 3600, scope: scopes })
      }
      if (String(u).endsWith('jwks.json')) return json({ keys: [jwk] })
      return json({ models: [] })
    }) as typeof fetch
    const auth = new ChatGPTAuth({ read: () => saved, write: s => { saved = s } }, request)
    await auth.signIn(async raw => {
      const url = new URL(raw); authorizations.push(url)
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: `code-${authorizations.length}`, ...(authorizations.length === 1 ? { client_id: 'oaiapp_issued' } : {}) }).toString()
      await fetch(callback)
    })
    expect(authorizations).toHaveLength(2)
    expect(authorizations[0].searchParams.get('client_id')).toBe('dynamic_agent_client')
    expect(authorizations[1].searchParams.get('client_id')).toBe('oaiapp_issued')
    expect(authorizations[1].searchParams.has('agent_name_hint')).toBe(false)
    expect(grants[0].get('code')).not.toBe(grants[1].get('code'))
    expect(grants[0].get('code_verifier')).not.toBe(grants[1].get('code_verifier'))
    expect(saved.accounts[0].tokens?.access).toBe('fresh-access')
  })
  it('labels code-exchange failures accurately and exposes only safe diagnostics', async () => {
    const f = fixture()
    f.request.mockImplementation(async () => new Response(JSON.stringify({ error: 'invalid_client', error_description: 'refresh-secret code-secret' }),
      { status: 400, headers: { 'x-request-id': 'request_123' } }))
    await expect(f.auth.signIn(async raw => {
      const url = new URL(raw), callback = new URL(url.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({ state: url.searchParams.get('state')!, code: 'code-secret', client_id: 'oaiapp_one' }).toString()
      await fetch(callback)
    }, 'oaiapp_one')).rejects.toThrow('ChatGPT sign-in was rejected (HTTP 400; invalid_client; request request_123)')
    expect(f.saved().accounts[0].tokens?.refresh).toBe('refresh-secret')
  })
  it('does not forward raw token error bodies or unsafe identifiers', async () => {
    const f = fixture(true)
    f.request.mockImplementation(async () => json({ error: 'refresh-secret.access-secret', error_description: 'refresh-secret' }, 401))
    const error = await f.auth.accessToken().catch(e => e.message)
    expect(error).toContain('session could not be renewed (HTTP 401)')
    expect(error).not.toMatch(/refresh-secret|access-secret/)
  })
  it('exposes only public metadata, never tokens or shell environment', () => {
    const f = fixture()
    const status = JSON.stringify(f.auth.status())
    expect(status).not.toMatch(/access-secret|refresh-secret|idToken|tokens/)
    expect(f.auth.status().accounts[0].label).toContain('user@example.com')
    expect(Object.values(process.env)).not.toContain('access-secret')
  })
  it('serializes rotating refreshes, persisting replacement tokens together', async () => {
    const f = fixture(true)
    expect(await Promise.all([f.auth.accessToken(), f.auth.accessToken()])).toEqual(['new-access', 'new-access'])
    expect(f.request.mock.calls.filter(([u]) => String(u).endsWith('/token'))).toHaveLength(1)
    expect(f.saved().accounts[0].tokens?.refresh).toBe('new-refresh')
    const body = String(f.request.mock.calls.find(([u]) => String(u).endsWith('/token'))![1]!.body)
    expect(body).toContain('client_id=oaiapp_one')
    expect(body).not.toContain('scope=')
  })
  it('preserves credentials on temporary refresh failures', async () => {
    const f = fixture(true)
    f.request.mockImplementation(async () => json({}, 503))
    await expect(f.auth.accessToken()).rejects.toThrow('Could not reach')
    expect(f.saved().accounts[0].tokens?.refresh).toBe('refresh-secret')
  })
  it('rejects refresh grants that remove plan usage permission', async () => {
    const f = fixture(true)
    f.request.mockImplementation(async () => json({ access_token: 'bad', refresh_token: 'bad', token_type: 'Bearer', expires_in: 3600, scope: 'openid' }))
    await expect(f.auth.accessToken()).rejects.toThrow('not enabled')
    expect(f.saved().accounts[0].tokens?.access).toBe('access-secret')
  })
  it('loads only visible account-specific models and caches them', async () => {
    const f = fixture()
    expect((await f.auth.models()).map(m => m.slug)).toEqual(['gpt-6.1-sol'])
    await f.auth.models()
    expect(f.request.mock.calls).toHaveLength(1)
  })
  it('signs out locally even if remote revocation fails, retaining registration and host', async () => {
    const f = fixture()
    f.request.mockImplementation(async () => { throw new Error('offline') })
    const status = await f.auth.signOut()
    expect(status.active).toBeUndefined()
    expect(status.warning).toContain('not confirmed')
    expect(f.saved().hostId).toBe('urn:uuid:fixed')
    expect(f.saved().accounts[0].clientId).toBe('oaiapp_one')
    expect(f.saved().accounts[0].tokens).toBeUndefined()
    expect(await f.auth.models()).toEqual([])
  })
  it('revokes the refresh token using the issued client ID, never an access-token URL', async () => {
    const f = fixture()
    await f.auth.signOut()
    const [url, init] = f.request.mock.calls.find(([u]) => String(u).endsWith('/revoke'))!
    expect(url).not.toContain('secret')
    expect(String(init!.body)).toContain('token=refresh-secret')
    expect(String(init!.body)).toContain('client_id=oaiapp_one')
  })
  it('cannot resurrect a signed-out session from a racing refresh', async () => {
    const f = fixture(true)
    let release!: (r: Response) => void
    f.request.mockImplementation(async u => String(u).endsWith('/token') ? await new Promise<Response>(r => { release = r }) : json({}, 400))
    const refreshing = f.auth.accessToken()
    const rejected = expect(refreshing).rejects.toThrow('session changed')
    await f.auth.signOut()
    release(json({ access_token: 'resurrected', refresh_token: 'new', token_type: 'Bearer', expires_in: 3600, scope: scopes }))
    await rejected
    expect(f.saved().accounts[0].tokens).toBeUndefined()
  })
  it('binds returning browser login to the issued client, stable host, PKCE and validated identity', async () => {
    const f = fixture()
    let authorization: URL
    f.request.mockImplementation(async (u, init) => {
      if (String(u).endsWith('jwks.json')) return json({ keys: [jwk] })
      if (String(u).endsWith('/models')) return json({ models: [] })
      const body = new URLSearchParams(String(init?.body))
      expect(body.get('client_id')).toBe('oaiapp_one')
      expect(body.get('redirect_uri')).toBe(authorization.searchParams.get('redirect_uri'))
      expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'))
      return json({ access_token: 'signed-access', refresh_token: 'signed-refresh', id_token: jwt('oaiapp_one', authorization.searchParams.get('nonce')!), token_type: 'Bearer', expires_in: 3600, scope: scopes })
    })
    await f.auth.signIn(async raw => {
      authorization = new URL(raw)
      expect(authorization.searchParams.get('client_id')).toBe('oaiapp_one')
      expect(authorization.searchParams.has('agent_name_hint')).toBe(false)
      expect(authorization.searchParams.get('ext_agent_host_id')).toBe('urn:uuid:fixed')
      const callback = new URL(authorization.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({ state: 'wrong', code: 'code' }).toString()
      expect((await fetch(callback)).status).toBe(400)
      // Forged error callbacks must not terminate the legitimate login.
      callback.search = 'state=wrong&error=access_denied'
      expect((await fetch(callback)).status).toBe(400)
      callback.search = new URLSearchParams({ state: authorization.searchParams.get('state')!, code: 'code' }).toString()
      expect((await fetch(callback)).status).toBe(200)
    }, 'oaiapp_one')
    expect(f.saved().accounts[0].tokens?.access).toBe('signed-access')
  })
  it('supports new registration, multiple workspaces and first-sign-in confirmation', async () => {
    const f = fixture()
    let nonce: string
    const base = f.request.getMockImplementation()!
    f.request.mockImplementation(async (u, init) => String(u).endsWith('/token') ? json({ access_token: 'second', refresh_token: 'refresh-second', id_token: jwt('oaiapp_two', nonce), token_type: 'Bearer', expires_in: 3600, scope: scopes }) : base(u, init))
    const result = await f.auth.signIn(async raw => {
      const u = new URL(raw)
      nonce = u.searchParams.get('nonce')!
      expect(u.searchParams.get('client_id')).toBe('dynamic_agent_client')
      expect(u.searchParams.get('agent_name_hint')).toBe('AgentShot')
      const callback = new URL(u.searchParams.get('redirect_uri')!)
      callback.search = new URLSearchParams({ state: u.searchParams.get('state')!, code: 'code', client_id: 'oaiapp_two' }).toString()
      await fetch(callback)
    })
    expect(result.firstSignIn).toBe(true)
    expect(result.accounts).toHaveLength(2)
    expect(f.saved().active).toBe('oaiapp_two')
    f.auth.welcome()
    expect(f.saved().welcomed).toBe(true)
    expect(f.auth.select('oaiapp_one').active).toBe('oaiapp_one')
  })
  it('cancels sign-in without changing the active account', async () => {
    const f = fixture()
    await expect(f.auth.signIn(() => f.auth.cancel())).rejects.toThrow('cancelled')
    expect(f.auth.status().active).toBe('oaiapp_one')
  })
})

describe('ChatGPT inference compatibility', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('removes forbidden harness defaults and moves tools into additional_tools', () => {
    const payload = chatGPTPayload({ model: 'sol', store: true, stream: false, temperature: 0.7, max_output_tokens: 99,
      previous_response_id: 'old', metadata: {}, input: [{ role: 'system', content: 'prompt' }, { role: 'user', content: 'hello' }],
      tools: [{ type: 'function', name: 'edit' }] })
    expect(payload.store).toBe(false); expect(payload.stream).toBe(true)
    expect(payload).not.toHaveProperty('temperature'); expect(payload).not.toHaveProperty('max_output_tokens')
    expect(payload).not.toHaveProperty('previous_response_id'); expect(payload).not.toHaveProperty('tools')
    expect(payload.input[0]).toEqual({ type: 'additional_tools', role: 'developer', tools: [{ type: 'function', name: 'edit' }] })
    expect(payload.input[1].role).toBe('developer')
  })
  it('rejects unsupported hosted tools', () => {
    expect(() => chatGPTPayload({ input: [], tools: [{ type: 'tool_search' }] })).toThrow('not supported')
  })
  it('integrates with the real model registry without exposing a static bearer header', async () => {
    const f = fixture()
    const provider = chatGPTProvider(f.auth, await f.auth.models())
    const models = createModels()
    models.setProvider(provider)
    expect((await models.getAvailable()).map(m => m.provider)).toEqual(['chatgpt'])
    expect(provider.getModels()[0].headers).toBeUndefined()
    expect((await models.getAuth('chatgpt'))?.auth.apiKey).toBe('access-secret')
    await f.auth.signOut()
    expect(await models.getAvailable()).toEqual([])
  })
  it.each([undefined, 'low', 'high'] as const)('sends the selected ChatGPT effort, or omits it for Default: %s', async level => {
    const f = fixture()
    const provider = chatGPTProvider(f.auth, [{ slug: 'reasoner', display_name: 'Reasoner', visibility: 'list', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }] }])
    const models = createModels(); models.setProvider(provider)
    const fetcher = vi.fn(async (_input, init) => {
      const body = JSON.parse(init!.body as string)
      if (level) expect(body.reasoning.effort).toBe(level)
      else expect(body).not.toHaveProperty('reasoning')
      return new Response('data: {"type":"response.completed","response":{"id":"resp_test","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await models.completeSimple(provider.getModels()[0], { messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] }, level ? { reasoning: level } : {})
    expect(response.stopReason).toBe('stop'); expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['completed', 'incomplete', 'failed', 'interrupted'])('consumes a real Responses SSE stream: %s', async terminal => {
    const f = fixture()
    const provider = chatGPTProvider(f.auth, await f.auth.models())
    const models = createModels(); models.setProvider(provider)
    const events = terminal === 'interrupted' ? [] : [{ type: `response.${terminal}`, response: { id: 'resp_test', status: terminal,
      output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
      ...(terminal === 'failed' ? { error: { code: 'subscription_sharing_usage_unavailable', message: 'Unavailable' } } : {}),
      ...(terminal === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}) } }]
    const fetcher = vi.fn(async (input: any, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.openai.com/v1/responses')
      const request = new Request(input, init)
      expect(request.headers.get('authorization')).toBe('Bearer access-secret')
      const body = JSON.parse(await request.text())
      expect(body.store).toBe(false); expect(body.stream).toBe(true)
      expect(body).not.toHaveProperty('max_output_tokens')
      expect(body).not.toHaveProperty('temperature')
      expect(body.input.some((i: any) => i.role === 'system')).toBe(false)
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetcher)
    const response = await models.completeSimple(provider.getModels()[0], { systemPrompt: 'You edit videos.', messages: [{ role: 'user', content: 'Hello', timestamp: Date.now() }] }, { maxTokens: 50, temperature: 0.5 })
    expect(response.stopReason).toBe(terminal === 'completed' ? 'stop' : 'error')
    if (terminal === 'failed') expect(response.errorMessage).toContain('https://chatgpt.com/settings/usage')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('aborts subscription requests immediately on sign-out', async () => {
    const f = fixture()
    const signal = f.auth.requestSignal('oaiapp_one')
    await f.auth.signOut()
    expect(signal.aborted).toBe(true)
    expect(() => f.auth.requestSignal('oaiapp_one')).toThrow('session changed')
  })
})
