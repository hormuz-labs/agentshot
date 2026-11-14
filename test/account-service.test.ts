import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { handle, NEW_KEY, sync, syncAll, type Env } from '../account/src/index'
import { costForCredits, creditsForCost, STARTER_CREDITS } from '../account/src/plans'
import { memoryWallet } from '../account/src/wallet'

// The account service against fake Clerk (userinfo, users, metadata), fake Bifrost (customers, virtual keys), fake
// Dodo Payments (checkouts, customers, portal) and the wallet in memory (Pitch's ledger, in production).
const env: Env = {
  CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk_clerk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic YWRtaW46cHc=',
  DODO_API: 'https://dodo.test', DODO_API_KEY: 'dodo_key', DODO_PRODUCT_PRO_TEST: 'pdt_pro', DODO_PRODUCT_MAX_TEST: 'pdt_max', DODO_PRODUCT_FLEX_TEST: 'pdt_flex',
  HEADSCALE_URL: 'https://hs.test', HEADSCALE_PUBLIC_URL: 'https://mesh.agentshot.si', HEADSCALE_API_KEY: 'hs_secret', WORKER_POOL_SECRET: 'pool_secret_123',
}
let metadata: any
let keys: Record<string, any>
let calls: { method: string; url: string; auth?: string; body?: any }[]
let hsUsers: { id: string; name: string }[]
let hsRejectIdPreauth = false
let wallet: ReturnType<typeof memoryWallet>

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  metadata = {}
  keys = {}
  calls = []
  hsUsers = [{ id: '1', name: 'manul' }]
  hsRejectIdPreauth = false
  wallet = memoryWallet()
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method || 'GET'
    const auth = new Headers(init.headers).get('authorization') || undefined
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth, body })
    if (url === 'https://clerk.test/oauth/userinfo') {
      if (auth === 'Bearer good') return reply({ sub: 'user_1', email: 'ada@example.com' })
      if (auth === 'Bearer good_2') return reply({ sub: 'user_2', email: 'grace@example.com' })
      return reply({}, 401)
    }
    if (url === 'https://api.clerk.com/v1/users/user_1' && method === 'GET') return reply({ id: 'user_1', private_metadata: metadata.user_1 || metadata })
    if (url === 'https://api.clerk.com/v1/users/user_2' && method === 'GET') return reply({ id: 'user_2', private_metadata: metadata.user_2 || {} })
    if (url === 'https://api.clerk.com/v1/users/user_1/metadata' && method === 'PATCH') { metadata = { ...metadata, ...body.private_metadata }; return reply({}) }
    if (url === 'https://api.clerk.com/v1/users/user_2/metadata' && method === 'PATCH') { metadata.user_2 = { ...(metadata.user_2 || {}), ...body.private_metadata }; return reply({}) }
    if (url === 'https://gw.test/api/governance/customers' && method === 'POST') return reply({ customer: { id: 'cus_1', name: body.name } })
    if (url === 'https://gw.test/api/governance/virtual-keys' && method === 'POST') {
      const id = `vk_${Object.keys(keys).length + 1}`
      keys[id] = { id, name: body.name, description: body.description, value: `sk-bf-${id}`, is_active: true, provider_configs: body.provider_configs, budgets: body.budgets.map((b: any, i: number) => ({ ...b, id: `b${i}`, current_usage: 0 })) }
      return reply({ virtual_key: keys[id] })
    }
    const vk = /^https:\/\/gw\.test\/api\/governance\/virtual-keys\/(.+)$/.exec(url)?.[1]
    if (vk && method === 'PUT') {
      for (const b of body.budgets) Object.assign(keys[vk].budgets.find((x: any) => x.id === b.id), b)   // in place: usage kept
      if (body.provider_configs) keys[vk].provider_configs = body.provider_configs
      return reply({ virtual_key: keys[vk] })
    }
    if (vk) return keys[vk] ? reply({ virtual_key: keys[vk] }) : reply({ error: 'not found' }, 404)
    if (url === 'https://ph.test/i/v0/e/') return reply({ status: 1 })
    if (url === 'https://dodo.test/checkouts' && method === 'POST') return auth === 'Bearer dodo_key' ? reply({ session_id: 'cks_1', checkout_url: 'https://checkout.dodo.test/cks_1' }) : reply({}, 401)
    if (url === 'https://dodo.test/customers?email=ada%40example.com') return reply({ items: [{ customer_id: 'cus_dodo' }] })
    if (url === 'https://dodo.test/customers/cus_dodo/customer-portal/session' && method === 'POST') return reply({ link: 'https://portal.dodo.test/x' })
    if (url === 'https://hs.test/api/v1/user' && method === 'GET') return auth === 'Bearer hs_secret' ? reply({ users: hsUsers }) : reply({}, 401)
    if (url === 'https://hs.test/api/v1/user' && method === 'POST') {
      if (auth !== 'Bearer hs_secret') return reply({}, 401)
      const created = { id: '99', name: body.name }
      hsUsers.push(created)
      return reply({ user: created })
    }
    if (url === 'https://hs.test/api/v1/preauthkey' && method === 'POST') {
      if (auth !== 'Bearer hs_secret') return reply({}, 401)
      if (hsRejectIdPreauth && body.user !== 'manul') return reply({ message: 'user not found by id' }, 400)
      return reply({ preAuthKey: { key: `tskey-${body.aclTags?.[0]}-${body.ephemeral ? 'eph' : 'perm'}` } })
    }
    return reply({ error: `unexpected ${method} ${url}` }, 500)
  })
})
afterEach(() => vi.unstubAllGlobals())

const call = (path: string, init: RequestInit = {}) => handle(new Request(`https://account.test${path}`, init), env, wallet)
const ask = (token?: string) => call('/v1/key', { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} })
const asKey = (key = 'sk-bf-vk_1', id = 'vk_1') => ({ authorization: `Bearer ${key}`, 'x-manul-key-id': id })
const balance = async () => (await call('/v1/balance', { headers: asKey() })).json()
const subscribe = (userId: string, plan = 'pro', status = 'active') =>
  wallet.subscriptions.set(userId, { plan, status, credits_per_cycle: 10_000, period_end: '2026-11-21T00:00:00.000Z', cancelled: status !== 'active' })
const models = (vk: any) => vk.provider_configs.flatMap((p: any) => p.allowed_models).sort()

describe('the account service: signing in', () => {
  it('turns away anyone Clerk does not vouch for', async () => {
    expect((await ask()).status).toBe(401)
    expect((await ask('forged')).status).toBe(401)
    expect(calls.some(c => c.url.startsWith('https://gw.test'))).toBe(false)
  })

  it('first sign-in: a wallet with the starter credits, and a key whose budget is what those credits buy', async () => {
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', key_id: 'vk_1', email: 'ada@example.com' })
    const created = calls.find(c => c.url.endsWith('/virtual-keys') && c.method === 'POST')!
    expect(created.auth).toBe('Basic YWRtaW46cHc=')
    expect(created.body).toMatchObject({ ...NEW_KEY, name: 'user_1', description: 'ada@example.com', customer_id: 'cus_1', is_active: true })
    expect(metadata).toEqual({ bifrost: { customer_id: 'cus_1', virtual_key_id: 'vk_1' }, wallet: 'manul_user_1' })
    expect(wallet.ledger).toEqual([expect.objectContaining({ userId: 'manul_user_1', delta: STARTER_CREDITS, type: 'promo' })])
    expect(keys.vk_1.budgets[0]).toMatchObject({ max_limit: costForCredits(STARTER_CREDITS), reset_duration: '100Y' })
    expect(models(keys.vk_1)).toEqual(['gemini-3.8-flash', 'gemini-4-argon', 'gpt-5.6-luna'])
  })

  it('a Pitch subscriber (same email) gets their own wallet: their plan, their credits, every tier', async () => {
    wallet.profiles.set('user_pitch', { email: 'Ada@Example.com' })
    await wallet.post('user_pitch', 7_000, 'promo', 'left from Pitch', 'sub_grant:x:initial')
    subscribe('user_pitch', 'max')
    await ask('good')
    expect(metadata.wallet).toBe('user_pitch')
    expect(wallet.profiles.size).toBe(1)
    expect(keys.vk_1.budgets[0].max_limit).toBeCloseTo(costForCredits(7_000 + STARTER_CREDITS))
    expect(models(keys.vk_1)).toEqual(['gemini-3.8-flash', 'gemini-4-argon', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-6.1-sol'])
  })

  it('later sign-ins (any device) get the same key: no second starter credit', async () => {
    await ask('good')
    calls = []
    expect(await (await ask('good')).json()).toEqual({ key: 'sk-bf-vk_1', key_id: 'vk_1', email: 'ada@example.com' })
    expect(calls.some(c => c.method === 'POST' && c.url.startsWith('https://gw.test'))).toBe(false)
    expect(wallet.ledger).toHaveLength(1)
  })

  it('a key turned off in the gateway stays off', async () => {
    await ask('good')
    keys.vk_1.is_active = false
    expect((await ask('good')).status).toBe(403)
  })

  it('a key deleted in the gateway is replaced, and the wallet is still theirs', async () => {
    await ask('good')
    delete keys.vk_1
    await ask('good')
    expect(Object.values(keys)[0].budgets[0].max_limit).toBeCloseTo(costForCredits(STARTER_CREDITS))
    expect(wallet.ledger).toHaveLength(1)
  })
})

describe('the account service: credits and plans', () => {
  it('what the key spends in the gateway comes off the wallet once, and the budget follows the wallet', async () => {
    await ask('good')
    keys.vk_1.budgets[0].current_usage = 0.5
    await sync(env, wallet, 'vk_1')
    await sync(env, wallet, 'vk_1')   // again: nothing more to charge
    const spent = creditsForCost(0.5)
    expect(wallet.ledger.filter(r => r.type === 'usage')).toEqual([expect.objectContaining({ delta: -spent, key: `manul:gateway:vk_1:${spent}` })])
    expect(keys.vk_1.budgets[0].max_limit).toBeCloseTo(0.5 + costForCredits(STARTER_CREDITS - spent))
    // spending in Pitch (or a grant from Pitch's webhook) reaches the key on the next sync
    await wallet.post('manul_user_1', 10_000, 'promo', 'pro plan', 'sub_grant:sub_1:initial')
    await syncAll(env, wallet)
    expect(keys.vk_1.budgets[0].max_limit).toBeCloseTo(0.5 + costForCredits(STARTER_CREDITS - spent + 10_000))
  })

  it('a key from before wallets is linked by its email when it asks, and its old spend isn’t charged', async () => {
    keys.vk_1 = { id: 'vk_1', name: 'user_1', description: 'ada@example.com', value: 'sk-bf-vk_1', is_active: true, budgets: [{ id: 'b0', max_limit: 2, current_usage: 1.78, reset_duration: '100Y' }], provider_configs: [] }
    const b = await balance()
    expect(b.credits).toBe(STARTER_CREDITS)
    expect(wallet.ledger.filter(r => r.type === 'usage')).toEqual([])
    expect(keys.vk_1.budgets[0].max_limit).toBeCloseTo(1.78 + costForCredits(STARTER_CREDITS))
    expect(metadata.wallet).toBe('manul_user_1')
  })

  it('shows credits, the plan, the tiers and what can be bought, only to the key itself', async () => {
    await ask('good')
    subscribe('manul_user_1')
    const b = await balance()
    expect(b.discount).toEqual({ percent: 50, on: 'model usage' })
    expect(b).toMatchObject({ credits: STARTER_CREDITS, plan: { key: 'pro', name: 'Pro', every: 'month', renews: true, until: '2026-11-21T00:00:00.000Z' } })
    expect(b.tiers.filter((t: any) => t.available).map((t: any) => t.tier)).toEqual(['low', 'medium', 'high', 'max', 'ultra'])
    expect(b.plans.map((p: any) => [p.key, p.price, p.credits, p.buyable])).toEqual([['pro', 45, 10_000, true], ['max', 80, 30_000, true], ['pro_annual', 432, 120_000, false], ['max_annual', 768, 360_000, false]])
    expect((await call('/v1/balance', { headers: asKey('sk-bf-wrong') })).status).toBe(401)
    expect((await call('/v1/balance')).status).toBe(401)
  })

  it('a cancelled plan keeps its tiers to the end of what was paid for; an ended one does not', async () => {
    await ask('good')
    subscribe('manul_user_1', 'max', 'cancelled')
    expect((await balance()).plan).toMatchObject({ key: 'max', renews: false })
    expect(models(keys.vk_1)).toContain('gpt-6-astra')
    wallet.subscriptions.delete('manul_user_1')
    expect((await balance()).plan).toBeNull()
    expect(models(keys.vk_1)).not.toContain('gpt-6-astra')
  })

  it('starts a Dodo checkout for a plan, tagged the way Pitch’s webhook grants it', async () => {
    await ask('good')
    const res = await call('/v1/checkout', { method: 'POST', headers: asKey(), body: JSON.stringify({ plan: 'pro' }) })
    expect(await res.json()).toEqual({ url: 'https://checkout.dodo.test/cks_1' })
    expect(calls.find(c => c.url === 'https://dodo.test/checkouts')!.body).toEqual({
      product_cart: [{ product_id: 'pdt_pro', quantity: 1 }],
      customer: { email: 'ada@example.com' },
      return_url: 'https://account.agentshot.si/paid',
      metadata: { clerk_user_id: 'manul_user_1', credits: '10000', pack: 'pro', type: 'subscription', affiliate_cookie: '', source: 'manul' },
      billing_currency: 'USD',
      feature_flags: { allow_currency_selection: false },
    })
  })

  it('one plan at a time, top-ups only on a plan, and nothing unknown or unsold', async () => {
    await ask('good')
    const buy = async (body: object) => (await call('/v1/checkout', { method: 'POST', headers: asKey(), body: JSON.stringify(body) })).status
    calls = []
    expect(await buy({ topup: 'flex' })).toBe(403)
    expect(await buy({ plan: 'enterprise' })).toBe(400)
    expect(await buy({})).toBe(400)
    expect(await buy({ plan: 'pro_annual' })).toBe(503)      // no product set for it
    subscribe('manul_user_1')
    expect(await buy({ plan: 'max' })).toBe(409)
    expect(calls.some(c => c.url.startsWith('https://dodo.test'))).toBe(false)
    expect(await buy({ topup: 'flex' })).toBe(200)
    expect(calls.find(c => c.url === 'https://dodo.test/checkouts')!.body.metadata).toMatchObject({ pack: 'flex', type: 'topup', credits: '5000' })
  })

  it('opens Dodo’s billing page for the account’s email', async () => {
    await ask('good')
    expect(await (await call('/v1/portal', { method: 'POST', headers: asKey() })).json()).toEqual({ url: 'https://portal.dodo.test/x' })
  })

  it('blocks disabled keys on every account endpoint', async () => {
    await ask('good')
    keys.vk_1.is_active = false
    for (const path of ['/v1/balance', '/v1/voices', '/v1/checkout', '/v1/portal', '/v1/voice', '/v1/music']) {
      const get = ['/v1/balance', '/v1/voices'].includes(path)
      expect((await call(path, { method: get ? 'GET' : 'POST', headers: asKey(), body: get ? undefined : '{}' })).status).toBe(403)
    }
    expect(calls.some(c => c.url.startsWith('https://dodo.test'))).toBe(false)
  })

  it('grants only configured gateway providers', async () => {
    const r = await handle(new Request('https://account.test/v1/key', { method: 'POST', headers: { authorization: 'Bearer good' } }), { ...env, BIFROST_PROVIDERS: 'gemini,openai,anthropic' }, wallet)
    expect(r.status).toBe(200)
    const created = calls.find(c => c.url.endsWith('/virtual-keys') && c.method === 'POST')!
    expect(created.body.provider_configs.map((p: any) => p.provider)).toEqual(['gemini'])
  })
  it('tells PostHog about sign-ins and checkouts as the wallet’s user, never with an email', async () => {
    const tracked = { ...env, POSTHOG_KEY: 'phc_1', POSTHOG_HOST: 'https://ph.test' }
    await handle(new Request('https://account.test/v1/key', { method: 'POST', headers: { authorization: 'Bearer good' } }), tracked, wallet)
    await handle(new Request('https://account.test/v1/checkout', { method: 'POST', headers: asKey(), body: '{"plan":"max"}' }), tracked, wallet)
    await new Promise(r => setTimeout(r, 0))
    const events = calls.filter(c => c.url === 'https://ph.test/i/v0/e/').map(c => c.body)
    expect(events.map(e => [e.event, e.distinct_id, e.api_key])).toEqual([['manul signed in', 'manul_user_1', 'phc_1'], ['manul checkout started', 'manul_user_1', 'phc_1']])
    expect(JSON.stringify(events)).not.toContain('ada@example.com')
  })
})

describe('the account service as production runs it', () => {
  it('loads with Node stripping its types (no TypeScript-only syntax such as parameter properties or enums)', () => {
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./account/src/index.ts'); await import('./account/src/wallet.ts')"], {
      cwd: join(import.meta.dirname, '..'), encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' },
    })
    expect(run.stderr.replace(/.*ExperimentalWarning.*\n?|.*--trace-warnings.*\n?/g, '')).not.toMatch(/Error/)
    expect(run.status).toBe(0)
  })
})

describe('the account service: headscale mesh and worker pool', () => {
  const fp = 'a'.repeat(64)
  const secret = 's'.repeat(48)

  it('mints Headscale pre-auth keys for clients and workers', async () => {
    await ask('good')
    const clientJoin = await (await call('/v1/mesh/join', { method: 'POST', headers: asKey(), body: JSON.stringify({ role: 'client' }) })).json()
    expect(clientJoin).toEqual({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-tag:client-eph', tag: 'tag:client' })

    const poolJoin = await (await call('/v1/mesh/join', { method: 'POST', headers: { 'x-manul-pool-secret': 'pool_secret_123' }, body: '{}' })).json()
    expect(poolJoin).toEqual({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-tag:worker-perm', tag: 'tag:worker' })
  })

  it('registers personal and pooled workers, prefers sticky/priority workers on lease, and signs stateless tokens', async () => {
    await ask('good')
    // Personal worker owned by this user
    const hbOwn = await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: asKey(),
      body: JSON.stringify({ id: 'home-mac', name: 'Home Mac Studio', urls: ['https://100.64.0.2:47821'], fingerprint: fp, secret, capabilities: { gpu: 'videotoolbox' } }),
    })
    expect(hbOwn.status).toBe(200)

    // Two shared pool workers (one cloud, one home pool with cached project)
    await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id: 'cloud-1', name: 'Cloud Worker 1', urls: ['https://100.64.0.10:47821'], fingerprint: fp, secret, capabilities: { priority: 1 } }),
    })
    await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id: 'home-pool-1', name: 'Home Pool GPU', urls: ['https://100.64.0.11:47821'], fingerprint: fp, secret, capabilities: { priority: 5, projects: ['proj_abc'] } }),
    })

    const listed = await (await call('/v1/workers', { headers: asKey() })).json()
    expect(listed.poolAvailable).toBe(2)
    expect(listed.workers).toHaveLength(1)
    expect(listed.workers[0]).toMatchObject({ id: 'home-mac', name: 'Home Mac Studio', pool: false, urls: ['https://100.64.0.2:47821'] })
    expect(listed.workers[0].token).toMatch(/^lease\.\d+\./)

    // Leasing picks the higher-priority / sticky-cache home-pool-1 worker first
    const leased = await (await call('/v1/workers/lease', { method: 'POST', headers: asKey(), body: JSON.stringify({ projectId: 'proj_abc' }) })).json()
    expect(leased.worker).toMatchObject({ id: 'home-pool-1', pool: true, urls: ['https://100.64.0.11:47821'] })
    expect(leased.worker.token).toMatch(/^lease\.\d+\./)

    // the worker learns who holds it from its next heartbeat (and enforces it)
    const poolBeat = (id: string) => call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id, name: 'Home Pool GPU', urls: ['https://100.64.0.11:47821'], fingerprint: fp, secret, capabilities: { priority: 5 } }),
    }).then(r => r.json())
    const held = await poolBeat('home-pool-1')
    expect(held.pool).toBe(true)
    expect(held.leasedTo).toBeTruthy()
    expect(held.leasedUntil).toBeGreaterThan(Date.now())

    // Releasing frees it back to the pool, and the worker hears so
    const rel = await (await call('/v1/workers/release', { method: 'POST', headers: asKey(), body: JSON.stringify({ workerId: 'home-pool-1' }) })).json()
    expect(rel).toEqual({ released: true })
    const freed = await poolBeat('home-pool-1')
    expect(!freed.leasedTo || freed.leasedUntil <= Date.now()).toBe(true)
  })

  it('sends a phone signing in back into the app with the code, and nothing else', async () => {
    const res = await call('/oauth/phone?code=abc&state=xyz&scope=openid&redirect=https://evil.test')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('agentshot://auth/callback?code=abc&state=xyz')
    expect(await res.text()).toContain('href="agentshot://auth/callback?code=abc&amp;state=xyz"')
    const refused = await call('/oauth/phone?error=access_denied&state=xyz')
    expect(refused.headers.get('location')).toBe('agentshot://auth/callback?state=xyz&error=access_denied')
  })

  it('makes a cloud worker only with the pool secret, never because a signed-in machine says so', async () => {
    await ask('good')
    const hb = await (await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: asKey(),
      body: JSON.stringify({ id: 'sneaky-pc', name: 'Not a pool', urls: ['https://100.64.0.3:47821'], fingerprint: fp, secret, pool: true }),
    })).json()
    expect(hb.pool).toBe(false)
    const listed = await (await call('/v1/workers', { headers: asKey() })).json()
    expect(listed.workers.find((w: { id: string }) => w.id === 'sneaky-pc')).toMatchObject({ pool: false })
  })

  it('auto-creates the Headscale manul user when absent, falls back to username preauthkey, and enforces auth & config', async () => {
    await ask('good')
    // Unauthenticated & bad pool secret rejected
    expect((await call('/v1/mesh/join', { method: 'POST', body: '{}' })).status).toBe(401)
    expect((await call('/v1/mesh/join', { method: 'POST', headers: { 'x-manul-pool-secret': 'wrong_secret' }, body: '{}' })).status).toBe(401)

    // Missing Headscale config returns 503
    const noHs = await handle(new Request('https://account.test/v1/mesh/join', { method: 'POST', headers: asKey(), body: '{}' }), { ...env, HEADSCALE_URL: undefined }, wallet)
    expect(noHs.status).toBe(503)

    // Auto-creates 'manul' user and falls back when Headscale v0.23 expects username instead of numeric ID
    hsUsers = []
    hsRejectIdPreauth = true
    const joined = await (await call('/v1/mesh/join', { method: 'POST', headers: asKey(), body: JSON.stringify({ role: 'worker' }) })).json()
    expect(joined).toEqual({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-tag:worker-perm', tag: 'tag:worker' })
    expect(hsUsers).toEqual([{ id: '99', name: 'manul' }])
  })

  it('validates worker registration fields and rejects malformed URLs, fingerprints, or secrets', async () => {
    await ask('good')
    const badCases = [
      { id: '../bad', name: 'W', urls: ['https://100.64.0.1:47821'], fingerprint: fp, secret },
      { id: 'valid-id', name: 'W', urls: ['http://100.64.0.1:47821'], fingerprint: fp, secret },
      { id: 'valid-id', name: 'W', urls: [], fingerprint: fp, secret },
      { id: 'valid-id', name: 'W', urls: ['https://100.64.0.1:47821'], fingerprint: 'not-hex', secret },
      { id: 'valid-id', name: 'W', urls: ['https://100.64.0.1:47821'], fingerprint: fp, secret: 'too-short' },
    ]
    for (const payload of badCases) {
      const res = await call('/v1/workers/heartbeat', { method: 'POST', headers: asKey(), body: JSON.stringify(payload) })
      expect(res.status).toBe(400)
    }
    expect((await call('/v1/workers/release', { method: 'POST', headers: asKey(), body: '{}' })).status).toBe(400)
  })

  it('isolates personal workers and active pool leases between users, expires stale workers, and reclaims expired leases', async () => {
    await ask('good')   // user_1 → vk_1
    await ask('good_2') // user_2 → vk_2
    const asUser1 = asKey('sk-bf-vk_1', 'vk_1')
    const asUser2 = asKey('sk-bf-vk_2', 'vk_2')

    // User 1 registers a personal home worker
    await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: asUser1,
      body: JSON.stringify({ id: 'u1-personal', name: 'Ada Mac', urls: ['https://100.64.0.2:47821'], fingerprint: fp, secret }),
    })
    // One shared pool worker
    await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id: 'pool-only', name: 'Shared GPU', urls: ['https://100.64.0.50:47821'], fingerprint: fp, secret }),
    })

    // User 2 cannot see User 1's personal worker
    const u2List = await (await call('/v1/workers', { headers: asUser2 })).json()
    expect(u2List.workers).toEqual([])
    expect(u2List.poolAvailable).toBe(1)

    // User 1 leases the only pool worker
    const u1Lease = await call('/v1/workers/lease', { method: 'POST', headers: asUser1, body: '{}' })
    expect(u1Lease.status).toBe(200)

    // User 2 cannot lease it while User 1 holds the lease, nor can User 2 release User 1's lease
    expect((await call('/v1/workers/lease', { method: 'POST', headers: asUser2, body: '{}' })).status).toBe(404)
    const u2Rel = await (await call('/v1/workers/release', { method: 'POST', headers: asUser2, body: JSON.stringify({ workerId: 'pool-only' }) })).json()
    expect(u2Rel).toEqual({ released: false })

    // User 1 re-leasing gets the same sticky worker
    const u1Again = await (await call('/v1/workers/lease', { method: 'POST', headers: asUser1, body: '{}' })).json()
    expect(u1Again.worker.id).toBe('pool-only')

    // Simulate lease expiry: User 2 can now lease it
    wallet.workers.get('pool-only')!.leasedUntil = Date.now() - 1_000
    const u2Lease = await (await call('/v1/workers/lease', { method: 'POST', headers: asUser2, body: '{}' })).json()
    expect(u2Lease.worker.id).toBe('pool-only')

    // Simulate stale worker heartbeat (> 2 minutes old): excluded from listings and leases
    wallet.workers.get('pool-only')!.updatedAt = Date.now() - 3 * 60_000
    const u2AfterStale = await (await call('/v1/workers', { headers: asUser2 })).json()
    expect(u2AfterStale.workers).toEqual([])
    expect(u2AfterStale.poolAvailable).toBe(0)
  })

  it('keeps a worker id to the machine that registered it: a signed-in computer can\'t take over a cloud worker\'s entry', async () => {
    await ask('good')
    const pool = { id: 'pool-guarded', name: 'Cloud', urls: ['https://100.64.0.70:47821'], fingerprint: fp, secret }
    expect((await call('/v1/workers/heartbeat', { method: 'POST', headers: { 'x-manul-pool-secret': 'pool_secret_123' }, body: JSON.stringify(pool) })).status).toBe(200)
    const hijack = await call('/v1/workers/heartbeat', {
      method: 'POST', headers: asKey(),
      body: JSON.stringify({ ...pool, name: 'Mine now', urls: ['https://203.0.113.9:47821'], secret: 'x'.repeat(48) }),
    })
    expect(hijack.status).toBe(409)
    expect(wallet.workers.get('pool-guarded')).toMatchObject({ pool: true, urls: pool.urls, secret })
    // and nobody's lease of it is touched
    const leased = await (await call('/v1/workers/lease', { method: 'POST', headers: asKey(), body: JSON.stringify({ workerId: 'pool-guarded' }) })).json()
    expect(leased.worker.urls).toEqual(pool.urls)
  })

  it('ends a run of cloud leases at 8 hours, however busy, and says when the person can take a spot again', async () => {
    await ask('good')
    const beat = async (activity?: unknown) => (await call('/v1/workers/heartbeat', {
      method: 'POST', headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id: 'pool-capped', name: 'Cloud', urls: ['https://100.64.0.71:47821'], fingerprint: fp, secret, activity }),
    })).json()
    await beat()
    await call('/v1/workers/lease', { method: 'POST', headers: asKey(), body: '{}' })
    const user = (await beat()).leasedTo as string
    // the run began almost 8 hours ago: busy or not, the lease ends at the 8-hour mark
    const rec = wallet.workers.get('pool-capped')!
    rec.leasedSince = Date.now() - 8 * 60 * 60_000 + 60_000
    const busy = await beat({ user, idleMs: 0, busy: true })
    expect(busy.leasedUntil).toBe(rec.leasedSince + 8 * 60 * 60_000)
    // it has: taking a spot again is refused, saying for how long (each heartbeat stores a fresh record)
    const now = wallet.workers.get('pool-capped')!
    now.leasedSince = rec.leasedSince - 2 * 60_000; now.leasedUntil = now.leasedSince + 8 * 60 * 60_000
    const again = await call('/v1/workers/lease', { method: 'POST', headers: asKey(), body: '{}' })
    expect(again.status).toBe(429)
    const body = await again.json()
    expect(body.error).toMatch(/8 hours in a row.*take it again in 2[89] minutes/)
    expect(body.retryAt).toBe(now.leasedUntil + 30 * 60_000)
    // and the worker hears it's free
    expect((await beat()).leasedTo).toBeUndefined()
  })

  it('frees a cloud lease nobody uses for 15 minutes, keeps it while used or while anything runs, and never revives it', async () => {
    await ask('good')
    await ask('good_2')
    const asUser1 = asKey('sk-bf-vk_1', 'vk_1')
    const beat = async (activity?: unknown) => (await call('/v1/workers/heartbeat', {
      method: 'POST',
      headers: { 'x-manul-pool-secret': 'pool_secret_123' },
      body: JSON.stringify({ id: 'pool-idle', name: 'Cloud', urls: ['https://100.64.0.60:47821'], fingerprint: fp, secret, activity }),
    })).json()
    await beat()
    const leased = await (await call('/v1/workers/lease', { method: 'POST', headers: asUser1, body: '{}' })).json()
    const IDLE = 15 * 60_000
    // the lease starts at 15 minutes; the token outlives it (the lease, kept alive by use, is what counts)
    const held = await beat()
    const user = held.leasedTo as string
    expect(held.leasedUntil - Date.now()).toBeGreaterThan(IDLE - 5_000)
    expect(held.leasedUntil - Date.now()).toBeLessThanOrEqual(IDLE)
    expect(leased.worker.expiresAt - Date.now()).toBeGreaterThan(23 * 60 * 60_000)

    // used a minute ago: 14 minutes left
    const used = await beat({ user, idleMs: 60_000, busy: false })
    expect(used.leasedTo).toBe(user)
    expect(Math.abs(used.leasedUntil - (Date.now() + IDLE - 60_000))).toBeLessThan(5_000)

    // something still runs (a render, the agent) after an hour away: kept for another 15 minutes from now
    wallet.workers.get('pool-idle')!.leasedUntil = Date.now() + 30_000
    const busy = await beat({ user, idleMs: 60 * 60_000, busy: true })
    expect(busy.leasedTo).toBe(user)
    expect(Math.abs(busy.leasedUntil - (Date.now() + IDLE))).toBeLessThan(5_000)

    // someone else's activity (a stale report after a handover) changes nothing
    const before = wallet.workers.get('pool-idle')!.leasedUntil
    await beat({ user: 'user_someone_else', idleMs: 0, busy: true })
    expect(wallet.workers.get('pool-idle')!.leasedUntil).toBe(before)

    // nothing running and unused for 15 minutes: the lease ends with this heartbeat and the spot is free
    const idle = await beat({ user, idleMs: IDLE, busy: false })
    expect(idle.leasedTo).toBeUndefined()
    const list2 = await (await call('/v1/workers', { headers: asKey('sk-bf-vk_2', 'vk_2') })).json()
    expect(list2.poolAvailable).toBe(1)

    // a lapsed lease isn't brought back by a late report of work
    const late = await beat({ user, idleMs: 0, busy: true })
    expect(late.leasedTo).toBeUndefined()
    const u2 = await (await call('/v1/workers/lease', { method: 'POST', headers: asKey('sk-bf-vk_2', 'vk_2'), body: '{}' })).json()
    expect(u2.worker.id).toBe('pool-idle')
  })
})

// What the cloud jobs server (hormuz-labs/agentshot-worker) asks: its side is api/account-worker.v1.md there.
describe('the account service: cloud jobs', () => {
  const secret = 'jobs_secret_123'
  const jobsEnv: Env = { ...env, WORKER_JOBS_SECRET: secret }
  const to = (path: string, init: RequestInit = {}, e: Env = jobsEnv) => handle(new Request(`https://account.test${path}`, init), e, wallet)
  const trusted = { 'x-agentshot-worker': secret, 'content-type': 'application/json' }
  const who = (key = asKey()) => to('/v1/worker/who', { headers: { ...key, ...trusted } })
  const charge = (operation: unknown, credits: unknown, key = asKey()) =>
    to('/v1/worker/charge', { method: 'POST', headers: { ...key, ...trusted }, body: JSON.stringify({ operation, credits, label: 'AgentShot: upscale to 4K' }) })
  const refund = (operation: unknown, userId: unknown = 'manul_user_1') => to('/v1/worker/refund', { method: 'POST', headers: trusted, body: JSON.stringify({ userId, operation }) })
  const left = async (userId = 'manul_user_1') => (await wallet.account(userId))!.available
  const rows = (operation: string) => wallet.ledger.filter(r => r.key.startsWith(operation))
  const job = 'manul:job:1794610731-25b051dc'

  it('does not exist for anyone but the jobs server', async () => {
    await ask('good')
    const before = wallet.ledger.length
    const body = JSON.stringify({ operation: job, credits: 150, userId: 'manul_user_1' })
    for (const headers of [{ ...asKey() }, { ...asKey(), 'x-agentshot-worker': 'jobs_secret_124' }, { ...asKey(), 'x-agentshot-worker': '' }]) {
      expect((await to('/v1/worker/who', { headers })).status).toBe(404)
      expect((await to('/v1/worker/charge', { method: 'POST', headers, body })).status).toBe(404)
      expect((await to('/v1/worker/refund', { method: 'POST', headers, body })).status).toBe(404)
    }
    // with no secret set on the service, even the right-looking header opens nothing (and an empty one never matches)
    for (const e of [env, { ...env, WORKER_JOBS_SECRET: '' }]) {
      expect((await to('/v1/worker/who', { headers: { ...asKey(), ...trusted } }, e)).status).toBe(404)
      expect((await to('/v1/worker/charge', { method: 'POST', headers: { ...asKey(), ...trusted }, body }, e)).status).toBe(404)
      expect((await to('/v1/worker/refund', { method: 'POST', headers: { 'x-agentshot-worker': '' }, body }, e)).status).toBe(404)
    }
    expect(wallet.ledger.length).toBe(before)
    expect(wallet.voids.size).toBe(0)
  })

  it('says whose key it is and what they can spend, with the gateway’s spend already taken off', async () => {
    await ask('good')
    keys.vk_1.budgets[0].current_usage = 0.5
    // a plain ask only reads: nothing is charged and the gateway is asked nothing but whose key it is
    const before = calls.length
    const plain = await who()
    expect(plain.status).toBe(200)
    expect(await plain.json()).toEqual({ userId: 'manul_user_1', email: 'ada@example.com', credits: STARTER_CREDITS })
    expect(calls.slice(before).map(c => c.method)).toEqual(['GET'])
    expect(wallet.ledger.filter(r => r.type === 'usage')).toEqual([])
    // before a job is priced, what the key has spent in the gateway is taken off first
    const r = await to('/v1/worker/who?sync=1', { headers: { ...asKey(), ...trusted } })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ userId: 'manul_user_1', email: 'ada@example.com', credits: STARTER_CREDITS - creditsForCost(0.5) })
    // a key that isn't theirs, and one that has been turned off
    expect((await who(asKey('sk-bf-forged'))).status).toBe(401)
    expect((await who({ authorization: 'Bearer sk-bf-vk_1' } as any)).status).toBe(401)
    keys.vk_1.is_active = false
    expect((await who()).status).toBe(403)
  })

  it('takes a job’s credits once, however often it is asked', async () => {
    await ask('good')
    const r = await charge(job, 150)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ charged: 150 })
    expect(await left()).toBe(STARTER_CREDITS - 150)
    expect(rows(job)).toEqual([{ userId: 'manul_user_1', delta: -150, type: 'usage', description: 'AgentShot: upscale to 4K', key: job }])
    // the key's budget follows the wallet, so the credits can't also be spent on models
    expect(keys.vk_1.budgets[0].max_limit).toBeCloseTo(costForCredits(STARTER_CREDITS - 150))

    // an answer lost on the way: asked again, with the same or even another amount, it says what it took the first time
    expect(await (await charge(job, 150)).json()).toEqual({ charged: 150 })
    expect(await (await charge(job, 300)).json()).toEqual({ charged: 150 })
    expect(await left()).toBe(STARTER_CREDITS - 150)
    expect(rows(job)).toHaveLength(1)
  })

  it('takes nothing when there are too few credits, and all of them when there are just enough', async () => {
    await ask('good')
    const r = await charge(job, STARTER_CREDITS + 1)
    expect(r.status).toBe(402)
    expect(await r.json()).toMatchObject({ credits: STARTER_CREDITS })
    expect(await left()).toBe(STARTER_CREDITS)
    expect(rows(job)).toEqual([])
    expect((await charge(job, STARTER_CREDITS)).status).toBe(200)
    expect(await left()).toBe(0)
  })

  it('counts what the key spent in the gateway before deciding there is enough', async () => {
    await ask('good')
    keys.vk_1.budgets[0].current_usage = costForCredits(900)
    const r = await charge(job, 150)
    expect(r.status).toBe(402)
    expect((await r.json()).credits).toBe(STARTER_CREDITS - 900)
    expect(rows(job)).toEqual([])
  })

  it('two charges at once can’t spend the same credits', async () => {
    await ask('good')
    const [a, b] = await Promise.all([charge('manul:job:a', 600), charge('manul:job:b', 600)])
    expect([a.status, b.status].sort()).toEqual([200, 402])
    expect(await left()).toBe(STARTER_CREDITS - 600)
    // and the same charge asked twice at once is taken once
    const twice = await Promise.all([charge('manul:job:c', 100), charge('manul:job:c', 100)])
    expect(twice.map(r => r.status)).toEqual([200, 200])
    expect(await left()).toBe(STARTER_CREDITS - 700)
    expect(rows('manul:job:c')).toHaveLength(1)
  })

  it('gives a charge back once, to the person it was taken from', async () => {
    await ask('good')
    await charge(job, 150)
    const r = await refund(job)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ refunded: 150 })
    expect(await left()).toBe(STARTER_CREDITS)
    expect(await (await refund(job)).json()).toEqual({ refunded: 150 })
    expect(await (await refund(job)).json()).toEqual({ refunded: 150 })
    expect(await left()).toBe(STARTER_CREDITS)
    expect(rows(job).map(r => [r.delta, r.key])).toEqual([[-150, job], [150, `${job}:refund`]])
    // a refunded charge is not taken again under the same name
    expect((await charge(job, 150)).status).toBe(409)
    expect(await left()).toBe(STARTER_CREDITS)
  })

  it('returns nothing for a charge that was never taken, and then never takes it', async () => {
    await ask('good')
    // the jobs server gave up waiting for the charge's answer and asked for it back; the charge arrives after
    expect(await (await refund(job)).json()).toEqual({ refunded: 0 })
    expect(await left()).toBe(STARTER_CREDITS)
    const late = await charge(job, 150)
    expect(late.status).toBe(409)
    expect(await left()).toBe(STARTER_CREDITS)
    expect(rows(job)).toEqual([])
    expect(await (await refund(job)).json()).toEqual({ refunded: 0 })
  })

  it('finishes a refund that stopped halfway without paying it twice', async () => {
    await ask('good')
    await charge(job, 150)
    // the credits went back, but the service stopped before it could mark the charge called off
    await wallet.post('manul_user_1', 150, 'usage', 'AgentShot: cloud job refund', `${job}:refund`)
    expect(await left()).toBe(STARTER_CREDITS)
    expect(await (await refund(job)).json()).toEqual({ refunded: 150 })
    expect(await left()).toBe(STARTER_CREDITS)
    expect(rows(job)).toHaveLength(2)
  })

  it('never gives one person’s charge to another, or charges two people under one name', async () => {
    await ask('good')
    await ask('good_2')
    await charge(job, 150)
    expect((await refund(job, 'manul_user_2')).status).toBe(400)
    expect(await left()).toBe(STARTER_CREDITS - 150)
    expect(await left('manul_user_2')).toBe(STARTER_CREDITS)
    expect(wallet.voids.size).toBe(0)
    expect((await charge(job, 150, asKey('sk-bf-vk_2', 'vk_2'))).status).toBe(409)
    expect(await left('manul_user_2')).toBe(STARTER_CREDITS)
    // the right person still gets it back
    expect(await (await refund(job)).json()).toEqual({ refunded: 150 })
    expect((await refund(job, 'manul_user_2')).status).toBe(400)
    expect(await left()).toBe(STARTER_CREDITS)
  })

  it('touches no ledger row but a job’s own', async () => {
    await ask('good')
    await wallet.post('manul_user_1', 10_000, 'promo', 'pro plan', 'sub_grant:sub_1:initial')
    await charge(job, 150)
    for (const name of ['manul:starter:manul_user_1', 'sub_grant:sub_1:initial', 'manul:gateway:vk_1:200', `${job}:refund`, 'manul:job:', 'manul:job:A B', '', 7, null]) {
      expect((await charge(name, 150)).status, String(name)).toBe(400)
      expect((await refund(name)).status, String(name)).toBe(400)
    }
    expect((await refund(job, '')).status).toBe(400)
    expect((await to('/v1/worker/charge', { method: 'POST', headers: { ...asKey(), ...trusted }, body: '{ not json' })).status).toBe(400)
    expect((await to('/v1/worker/refund', { method: 'POST', headers: trusted, body: '{ not json' })).status).toBe(400)
    expect(await left()).toBe(STARTER_CREDITS + 10_000 - 150)
    expect(wallet.voids.size).toBe(0)
  })

  it('refuses an amount that isn’t a whole number of credits above nothing', async () => {
    await ask('good')
    for (const credits of [0, -150, 1.5, '150', null, undefined, NaN, Infinity, 1_000_001, 2 ** 60]) {
      expect((await charge(job, credits)).status, String(credits)).toBe(400)
    }
    expect(await left()).toBe(STARTER_CREDITS)
    expect(rows(job)).toEqual([])
  })
})
