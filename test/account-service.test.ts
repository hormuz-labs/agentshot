import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, NEW_KEY, sync, syncAll, type Env } from '../account/src/index'
import { costForCredits, creditsForCost, STARTER_CREDITS } from '../account/src/plans'
import { memoryWallet } from '../account/src/wallet'

// The account service against fake Clerk (userinfo, users, metadata), fake Bifrost (customers, virtual keys), fake
// Dodo Payments (checkouts, customers, portal) and the wallet in memory (Pitch's ledger, in production).
const env: Env = {
  CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk_clerk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic YWRtaW46cHc=',
  DODO_API: 'https://dodo.test', DODO_API_KEY: 'dodo_key', DODO_PRODUCT_PRO_TEST: 'pdt_pro', DODO_PRODUCT_MAX_TEST: 'pdt_max', DODO_PRODUCT_FLEX_TEST: 'pdt_flex',
  HEADSCALE_URL: 'https://hs.test', HEADSCALE_PUBLIC_URL: 'https://mesh.manul.si', HEADSCALE_API_KEY: 'hs_secret', WORKER_POOL_SECRET: 'pool_secret_123',
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
      return_url: 'https://account.manul.si/paid',
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

describe('the account service: headscale mesh and worker pool', () => {
  const fp = 'a'.repeat(64)
  const secret = 's'.repeat(48)

  it('mints Headscale pre-auth keys for clients and workers', async () => {
    await ask('good')
    const clientJoin = await (await call('/v1/mesh/join', { method: 'POST', headers: asKey(), body: JSON.stringify({ role: 'client' }) })).json()
    expect(clientJoin).toEqual({ controlUrl: 'https://mesh.manul.si', authKey: 'tskey-tag:client-eph', tag: 'tag:client' })

    const poolJoin = await (await call('/v1/mesh/join', { method: 'POST', headers: { 'x-manul-pool-secret': 'pool_secret_123' }, body: '{}' })).json()
    expect(poolJoin).toEqual({ controlUrl: 'https://mesh.manul.si', authKey: 'tskey-tag:worker-perm', tag: 'tag:worker' })
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

    // Releasing frees it back to the pool
    const rel = await (await call('/v1/workers/release', { method: 'POST', headers: asKey(), body: JSON.stringify({ workerId: 'home-pool-1' }) })).json()
    expect(rel).toEqual({ released: true })
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
    expect(joined).toEqual({ controlUrl: 'https://mesh.manul.si', authKey: 'tskey-tag:worker-perm', tag: 'tag:worker' })
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
})
