import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, NEW_KEY, sync, syncAll, type Env } from '../account/src/index'
import { costForCredits, creditsForCost, STARTER_CREDITS } from '../account/src/plans'
import { memoryWallet } from '../account/src/wallet'

// The account service against fake Clerk (userinfo, users, metadata), fake Bifrost (customers, virtual keys), fake
// Dodo Payments (checkouts, customers, portal) and the wallet in memory (Pitch's ledger, in production).
const env: Env = {
  CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk_clerk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic YWRtaW46cHc=',
  DODO_API: 'https://dodo.test', DODO_API_KEY: 'dodo_key', DODO_PRODUCT_PRO_TEST: 'pdt_pro', DODO_PRODUCT_MAX_TEST: 'pdt_max', DODO_PRODUCT_FLEX_TEST: 'pdt_flex',
}
let metadata: any
let keys: Record<string, any>
let calls: { method: string; url: string; auth?: string; body?: any }[]
let wallet: ReturnType<typeof memoryWallet>

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
beforeEach(() => {
  metadata = {}
  keys = {}
  calls = []
  wallet = memoryWallet()
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method || 'GET'
    const auth = new Headers(init.headers).get('authorization') || undefined
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, url, auth, body })
    if (url === 'https://clerk.test/oauth/userinfo') return auth === 'Bearer good' ? reply({ sub: 'user_1', email: 'ada@example.com' }) : reply({}, 401)
    if (url === 'https://api.clerk.com/v1/users/user_1' && method === 'GET') return reply({ id: 'user_1', private_metadata: metadata })
    if (url === 'https://api.clerk.com/v1/users/user_1/metadata' && method === 'PATCH') { metadata = { ...metadata, ...body.private_metadata }; return reply({}) }
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
