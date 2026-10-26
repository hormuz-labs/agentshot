// AgentShot accounts (served by server.mjs, in the cluster next to the gateway): who is signing in (Clerk), that person's
// AgentShot key (a Bifrost virtual key under their own Bifrost customer, so every request and every dollar in the gateway is
// theirs), and their credits and plan, which are Pitch's: one wallet for both apps (wallet.ts, plans.ts).
//
//   POST /v1/key            Bearer <Clerk OAuth access token>              → { key, key_id, email }
//   GET  /v1/balance        Bearer <AgentShot key>, X-Manul-Key-Id: <key_id>   → { credits, plan, tiers, plans, … }
//   POST /v1/checkout       same, body { plan } or { topup }               → { url }  (Dodo Payments checkout, Pitch's products)
//   POST /v1/portal         same                                           → { url }  (Dodo's page to manage or cancel the plan)
//   GET  /paid              where the checkout returns to
//   GET  /v1/voices         as the key                                     → { voices: [{ name, about }] }
//   POST /v1/voice          as the key, body VoiceRequest (media.ts)       → the audio (MP3 or WAV)
//   POST /v1/music          as the key, body MusicRequest (media.ts)       → the audio
//
// Plans are granted by Pitch's Dodo webhook (subscription.active / renewed, payment.succeeded for top-ups), which reads
// the checkout's metadata: the wallet's user id as clerk_user_id, the plan as pack, its credits. Checkouts made here
// carry the same metadata, so the same webhook grants them.
//
// Voice and music are made with AgentShot's own vendor keys; which vendor and model, the voices and the prices are in
// media.json (MEDIA_CONFIG, re-read every 30 s so a changed ConfigMap applies without a restart). The app is never
// told who made it. The price, in credits, is taken off the wallet before the audio is made and given back if it fails.
//
// Which key is whose lives in the Clerk user's private metadata: { bifrost: { customer_id, virtual_key_id }, wallet }.
// The key's name is the Clerk user id. A key turned off in the gateway's dashboard stays off: signing in again doesn't
// make a new one.

import { readFile } from 'node:fs/promises'
import { createHmac, randomUUID } from 'node:crypto'
import { brandPage } from '../../src/shared/brand-page.ts'
import { costForCredits, creditsForCost, creditsForPrice, DISCOUNT, isPaid, PLANS, productEnv, providerConfigs, STARTER_CREDITS, TIERS, tiersFor, TOPUPS, type PlanKey, type TopupKey } from './plans.ts'
import { planOf, type Wallet, type WorkerCapabilities, type WorkerRecord } from './wallet.ts'
import { checkMusic, checkVoice, compose, KEY_ENV, MediaError, speak, VENDOR_NAME, VOICES, type Choice, type MusicRequest, type Voice, type VoiceRequest } from './media.ts'

export interface Env {
  /** Clerk's Frontend API, e.g. https://clerk.agentshot.si (the OAuth issuer) */
  CLERK_ISSUER: string
  /** Clerk Backend API secret (sk_…) */
  CLERK_SECRET_KEY: string
  /** the gateway's admin API, e.g. http://bifrost:8080 */
  BIFROST_URL: string
  /** the gateway's admin credential, as the Authorization header: "Basic base64(user:password)" */
  BIFROST_AUTH: string
  /** AgentShot's own tables (what each key was charged), in the gateway's Postgres */
  ACCOUNT_DATABASE_URL?: string
  /** The wallet: Pitch's Postgres (profiles, subscriptions, the credit ledger) */
  WALLET_DATABASE_URL?: string
  /** Separate local account metadata from deployed keys/payments in the same Clerk instance. */
  ACCOUNT_METADATA_KEY?: string
  /** Configured provider IDs, used to keep new-key grants valid for this gateway. */
  BIFROST_PROVIDERS?: string
  /** Only before local dashboard setup; production uses BIFROST_AUTH. */
  BIFROST_SETUP_TOKEN?: string
  /** JSON: what a new key gets (rate_limit, provider_configs); default NEW_KEY below */
  NEW_KEY?: string
  /** Credits a new AgentShot account starts with; default STARTER_CREDITS */
  STARTER_CREDITS?: string
  /** Dodo Payments (Pitch's business): https://test.dodopayments.com or https://live.dodopayments.com */
  DODO_API?: string
  DODO_API_KEY?: string
  /** and its products, as Pitch names them: DODO_PRODUCT_PRO_LIVE, DODO_PRODUCT_FLEX_TEST, … */
  [product: `DODO_PRODUCT_${string}`]: string | undefined
  /** where the account service is reached, for the checkout's return page; default https://account.agentshot.si */
  PUBLIC_URL?: string
  /** PostHog (Pitch's project, so a person's events in both apps are one person's): account events only */
  POSTHOG_KEY?: string
  POSTHOG_HOST?: string
  /** path to media.json (which vendor makes voice and music, the voices, the prices); default MEDIA below */
  MEDIA_CONFIG?: string
  GEMINI_API_KEY?: string
  ELEVENLABS_API_KEY?: string
  OPENAI_API_KEY?: string
  /** Headscale control server inside the cluster (e.g. http://headscale:8080) and its public URL (https://mesh.agentshot.si) */
  HEADSCALE_URL?: string
  HEADSCALE_PUBLIC_URL?: string
  HEADSCALE_API_KEY?: string
  /** Shared secret for registering pooled workers (cloud or home pool) */
  WORKER_POOL_SECRET?: string
}

/** What a person pays (USD) per model: per 1,000 characters said, per minute of music, and/or per request. */
export type Price = { per_1k_chars?: number; per_minute?: number; per_request?: number }
export type MediaConfig = { voice: Choice; music: Choice; prices: Record<string, Price>; voices?: Record<string, Voice> }

/** Without a media.json (tests, local runs): Gemini for both. */
export const MEDIA: MediaConfig = {
  voice: { provider: 'gemini', model: 'gemini-3.8-flash-tts' },
  music: { provider: 'gemini', model: 'lyria-3.5' },
  prices: { 'gemini-3.8-flash-tts': { per_1k_chars: 0.02 }, 'lyria-3.5': { per_request: 0.08 } },
}

let media: { at: number; config: MediaConfig } | undefined
async function mediaConfig(env: Env): Promise<MediaConfig> {
  if (!env.MEDIA_CONFIG) return MEDIA
  if (media && Date.now() - media.at < 30_000) return media.config
  let config = media?.config ?? MEDIA
  try { config = JSON.parse(await readFile(env.MEDIA_CONFIG, 'utf8')) } catch (e) { console.error('media.json:', (e as Error).message) }
  media = { at: Date.now(), config }
  return config
}

/** The price of one request, or undefined when the model has none (then it isn't offered). */
export function price(p: Price | undefined, r: { text?: string; seconds?: number }) {
  if (!p) return undefined
  const usd = (p.per_request || 0) + (p.per_1k_chars || 0) * ((r.text?.length || 0) / 1000) + (p.per_minute || 0) * ((r.seconds || 0) / 60)
  return Math.max(0.0001, Math.round(usd * 10000) / 10000)
}

/** A budget that never resets: what the key has used plus what the wallet has left. */
const FOREVER = '100Y'

/** A new person's key: a rate limit; the models it may reach follow its plan's tiers (plans.ts). */
export const NEW_KEY = {
  rate_limit: { request_max_limit: 300, request_reset_duration: '1h' },
}

const CLERK_API = 'https://api.clerk.com/v1'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (status: number, error: string) => json({ error }, status)
const page = (msg: string) => new Response(brandPage(msg), { headers: { 'content-type': 'text/html; charset=utf-8' } })
const round6 = (n: number) => Math.floor(n * 1e6) / 1e6
/** Bifrost refuses a budget of 0: a millionth of a dollar is as good as empty. */
const EMPTY = 0.000001

export type Budget = { id: string; max_limit: number; current_usage?: number; reset_duration: string }
type ProviderConfig = { provider: string; allowed_models?: string[] }
type VirtualKey = { id: string; name: string; description?: string; value: string; is_active: boolean; budgets?: Budget[]; provider_configs?: ProviderConfig[] }
type Meta = { bifrost?: { customer_id: string; virtual_key_id: string }; wallet?: string }

/** The account service's calls to Bifrost's admin API, shared by requests and the background sync. */
function gateway(env: Env) {
  const bifrost = (path: string, init: RequestInit = {}) =>
    fetch(`${env.BIFROST_URL.replace(/\/+$/, '')}/api/governance${path}`, { signal: AbortSignal.timeout(10_000), ...init, headers: { ...(env.BIFROST_AUTH ? { authorization: env.BIFROST_AUTH } : { 'X-Bifrost-Setup-Token': env.BIFROST_SETUP_TOKEN || '' }), 'content-type': 'application/json', ...init.headers } })
  const getKey = async (id: string) => {
    const r = await bifrost(`/virtual-keys/${encodeURIComponent(id)}`)
    return r.ok ? ((await r.json()) as { virtual_key: VirtualKey }).virtual_key : r.status === 404 ? null : undefined
  }
  const providers = () => env.BIFROST_PROVIDERS?.split(',').map(p => p.trim()).filter(Boolean)
  return { bifrost, getKey, providers }
}

/**
 * Brings a key and the wallet together: what the key spent in the gateway since the last look is taken off the wallet
 * (in credits), then the key's budget is set to what it has used plus what the wallet has left, and the models it may
 * reach to its plan's tiers. Safe to repeat: each charge's ledger key is the key's total charged so far.
 */
export async function sync(env: Env, wallet: Wallet, keyId: string, userId?: string) {
  const { bifrost, getKey, providers } = gateway(env)
  const owner = userId || (await wallet.charged(keyId))?.userId
  if (!owner) return undefined
  return wallet.lock(owner, async () => {
    const vk = await getKey(keyId)
    if (!vk) return undefined
    const b = vk.budgets?.[0]
    const used = b?.current_usage ?? 0
    const total = creditsForCost(used)
    const before = await wallet.charged(keyId)
    // A key's spend from before it had a wallet (the old free dollars) isn't charged.
    const charged = before?.userId === owner ? before.credits : total
    if (total > charged) await wallet.post(owner, -(total - charged), 'usage', 'AgentShot: model usage', `manul:gateway:${keyId}:${total}`)
    if (!before || before.credits !== total || before.userId !== owner) await wallet.setCharged(keyId, owner, total)

    const account = await wallet.account(owner)
    if (!account) return undefined
    const plan = account.subscription?.plan
    const max_limit = Math.max(EMPTY, round6(used + costForCredits(account.available)))
    const want = providerConfigs(isPaid(plan) ? plan : undefined, providers())
    const same = (a?: ProviderConfig[]) => JSON.stringify((a || []).map(p => [p.provider, [...(p.allowed_models || [])].sort()]).sort()) ===
      JSON.stringify(want.map(p => [p.provider, [...p.allowed_models].sort()]).sort())
    if (!b || Math.abs(b.max_limit - max_limit) > 1e-6 || !same(vk.provider_configs)) {
      const r = await bifrost(`/virtual-keys/${encodeURIComponent(keyId)}`, {
        method: 'PUT',
        body: JSON.stringify({
          budgets: [b ? { id: b.id, max_limit, reset_duration: b.reset_duration } : { max_limit, reset_duration: FOREVER }],
          ...(same(vk.provider_configs) ? {} : { provider_configs: want }),
        }),
      })
      if (!r.ok) throw new Error(`gateway: could not update key ${keyId}: ${r.status} ${await r.text().catch(() => '')}`)
    }
    return account
  })
}

/** Every key, now and then: spend in the gateway reaches the wallet, and what Pitch spent or granted reaches the key. */
export async function syncAll(env: Env, wallet: Wallet) {
  for (const keyId of await wallet.keys()) {
    try { await sync(env, wallet, keyId) } catch (e) { console.error('sync:', (e as Error).message) }
  }
}

/**
 * An account event in PostHog, as the wallet's user (Pitch identifies people by the same id), never with their email.
 * Fire and forget: analytics never hold up or break an account request.
 */
export function track(env: Env, event: string, distinctId: string, properties: Record<string, unknown> = {}) {
  if (!env.POSTHOG_KEY) return
  fetch(`${(env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '')}/i/v0/e/`, {
    method: 'POST', signal: AbortSignal.timeout(5_000), headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ api_key: env.POSTHOG_KEY, event, distinct_id: distinctId, properties: { ...properties, app: 'manul', $geoip_disable: true } }),
  }).catch(() => {})
}

export async function handle(req: Request, env: Env, wallet?: Wallet): Promise<Response> {
  const url = new URL(req.url)
  const clerk = (path: string, init: RequestInit = {}) =>
    fetch(`${CLERK_API}${path}`, { signal: AbortSignal.timeout(10_000), ...init, headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'content-type': 'application/json', ...init.headers } })
  const { bifrost, getKey, providers } = gateway(env)
  const meta = async (userId: string) => {
    const r = await clerk(`/users/${encodeURIComponent(userId)}`)
    if (!r.ok) return undefined
    const all = ((await r.json()) as { private_metadata?: Record<string, unknown> }).private_metadata || {}
    return (env.ACCOUNT_METADATA_KEY ? all[env.ACCOUNT_METADATA_KEY] || {} : all) as Meta
  }
  const saveMeta = (userId: string, m: Meta) =>
    clerk(`/users/${encodeURIComponent(userId)}/metadata`, { method: 'PATCH', body: JSON.stringify({ private_metadata: env.ACCOUNT_METADATA_KEY ? { [env.ACCOUNT_METADATA_KEY]: m } : m }) })
  const dodo = (path: string, init: RequestInit = {}) =>
    fetch(`${(env.DODO_API || 'https://test.dodopayments.com').replace(/\/+$/, '')}${path}`, { signal: AbortSignal.timeout(15_000), ...init, headers: { authorization: `Bearer ${env.DODO_API_KEY}`, 'content-type': 'application/json', ...init.headers } })
  const live = /live\./.test(env.DODO_API || '')

  /** The caller's key, proven by its value (the app sends the AgentShot key and the key id it was given with it). */
  const caller = async (): Promise<VirtualKey | Response> => {
    const value = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    const id = req.headers.get('x-manul-key-id')
    if (!value || !id) return fail(401, 'Sign in first.')
    const vk = await getKey(id)
    if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
    if (!vk || !same(vk.value, value)) return fail(401, 'Sign in again.')
    // Audio and checkout use the admin API, so Bifrost's inference middleware cannot enforce this for us.
    if (!vk.is_active) return fail(403, 'Your AgentShot key is turned off. Contact support.')
    return vk
  }
  /** The caller's wallet user: the key's, else (keys from before wallets) linked now by the key's email. */
  const owner = async (vk: VirtualKey) => {
    if (!wallet) return undefined
    const known = await wallet.charged(vk.id)
    if (known) return known.userId
    const m = await meta(vk.name)
    if (m?.wallet) return m.wallet
    if (!vk.description?.includes('@')) return undefined
    const userId = await linkWallet(vk.name, vk.description, m)
    return userId
  }
  async function linkWallet(sub: string, email: string, m?: Meta) {
    const userId = await wallet!.link(email, sub)
    await wallet!.post(userId, Number(env.STARTER_CREDITS ?? STARTER_CREDITS), 'promo', 'AgentShot starter credits', `manul:starter:${userId}`)
    if (m && m.wallet !== userId) await saveMeta(sub, { ...m, wallet: userId })
    return userId
  }

  if (url.pathname === '/v1/key' && req.method === 'POST') return signIn()
  if (url.pathname === '/v1/balance' && req.method === 'GET') return balance()
  if (url.pathname === '/v1/checkout' && req.method === 'POST') return checkout()
  if (url.pathname === '/v1/portal' && req.method === 'POST') return portal()
  if (url.pathname === '/v1/voices' && req.method === 'GET') {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const cfg = await mediaConfig(env)
    return json({ voices: Object.entries({ ...VOICES, ...cfg.voices }).map(([name, v]) => ({ name, about: v.about })) })
  }
  if (url.pathname === '/v1/voice' && req.method === 'POST') return generate('voice')
  if (url.pathname === '/v1/music' && req.method === 'POST') return generate('music')
  if (url.pathname === '/paid') return page('Payment received. Your plan and credits show up in a moment: go back to AgentShot.')
  // Signing in on the phone: Clerk comes back here, and this sends the browser on into the app with the code. (Not a
  // server in the app itself: Android freezes an app in the background while the person signs in, so it can't answer.)
  if (url.pathname === '/oauth/phone') return phoneCallback(url)
  if (url.pathname === '/v1/mesh/join' && req.method === 'POST') return joinMesh()
  if (url.pathname === '/v1/workers/heartbeat' && req.method === 'POST') return heartbeatWorker()
  if (url.pathname === '/v1/workers' && req.method === 'GET') return listWorkers()
  if (url.pathname === '/v1/workers/lease' && req.method === 'POST') return leaseWorker()
  if (url.pathname === '/v1/workers/release' && req.method === 'POST') return releaseWorker()
  return fail(404, 'Not found.')

  async function signIn() {
    const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    if (!token) return fail(401, 'Sign in first.')
    // who: Clerk checks its own token
    const who = await fetch(`${env.CLERK_ISSUER.replace(/\/+$/, '')}/oauth/userinfo`, { signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}` } })
    if (!who.ok) return fail(401, 'Your sign-in has expired. Sign in again.')
    const { sub, email } = await who.json() as { sub: string; email?: string }
    if (!sub) return fail(401, 'Your sign-in has expired. Sign in again.')
    if (!wallet) return fail(503, 'Accounts are unavailable. Try again later.')
    // Credits follow the email (it is how a Pitch subscriber is found), so a person without one can't have them.
    if (!email) return fail(400, 'Your account has no email address. Add one and sign in again.')

    const m = await meta(sub)
    if (!m) return fail(502, 'Could not reach accounts. Try again in a moment.')
    const link = m.bifrost
    const userId = await linkWallet(sub, email, m)

    // a returning person: the same key
    if (link?.virtual_key_id) {
      const vk = await getKey(link.virtual_key_id)
      if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
      if (vk) {
        if (!vk.is_active) return fail(403, 'Your AgentShot key is turned off. Contact support.')
        await sync(env, wallet, vk.id, userId)
        track(env, 'manul signed in', userId, { new_key: false, from_pitch: !userId.startsWith('manul_') })
        return json({ key: vk.value, key_id: vk.id, email })
      }
      // the key was deleted in the gateway: make a new one below (the wallet is unchanged)
    }

    // a new key: their customer, their key (its budget is set from the wallet by sync), and the link from the Clerk user
    let customerId = link?.customer_id
    if (!customerId) {
      const c = await bifrost('/customers', { method: 'POST', body: JSON.stringify({ name: email }) })
      if (!c.ok) return fail(502, 'Could not create your AgentShot key. Try again in a moment.')
      customerId = ((await c.json()) as { customer: { id: string } }).customer.id
    }
    const grants = env.NEW_KEY ? JSON.parse(env.NEW_KEY) : NEW_KEY
    const v = await bifrost('/virtual-keys', {
      method: 'POST',
      body: JSON.stringify({
        ...grants,
        provider_configs: providerConfigs(undefined, providers()),
        budgets: [{ max_limit: EMPTY, reset_duration: FOREVER }],
        name: sub, description: email, customer_id: customerId, is_active: true,
      }),
    })
    if (!v.ok) return fail(502, 'Could not create your AgentShot key. Try again in a moment.')
    const vk = ((await v.json()) as { virtual_key: VirtualKey }).virtual_key
    const saved = await saveMeta(sub, { ...m, bifrost: { customer_id: customerId, virtual_key_id: vk.id }, wallet: userId })
    if (!saved.ok) return fail(502, 'Could not save your AgentShot key. Try again in a moment.')
    await sync(env, wallet, vk.id, userId)
    track(env, 'manul signed in', userId, { new_key: true, from_pitch: !userId.startsWith('manul_') })
    return json({ key: vk.value, key_id: vk.id, email })
  }

  async function balance() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const account = await sync(env, wallet, vk.id, userId)
    if (!account) return fail(502, 'Could not reach the gateway. Try again in a moment.')
    const sub = account.subscription, plan = planOf(account, PLANS)
    const b = (await getKey(vk.id))?.budgets?.[0]
    return json({
      credits: Math.max(0, account.available),
      plan: sub && plan ? { key: sub.plan, name: plan.name, every: plan.every, credits: sub.credits_per_cycle, renews: sub.status === 'active', until: sub.period_end } : null,
      tiers: TIERS.map(t => ({ tier: t.tier, name: t.name, paid: t.paid, available: tiersFor(sub?.plan).includes(t.tier) })),
      plans: Object.values(PLANS).map(p => ({ ...p, buyable: !!env[productEnv(p.key as PlanKey, live)] })),
      topups: Object.values(TOPUPS).map(p => ({ ...p, buyable: !!env[productEnv(p.key as TopupKey, live)] })),
      // the launch offer: model usage below its list rate
      discount: DISCOUNT > 0 ? { percent: DISCOUNT, on: 'model usage' } : null,
      // for apps from before plans: the same, in dollars of model cost
      credit: b?.max_limit ?? 0, used: b?.current_usage ?? 0, left: Math.max(0, (b?.max_limit ?? 0) - (b?.current_usage ?? 0)),
    })
  }

  async function checkout() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const body = await req.json().catch(() => ({})) as { plan?: string; topup?: string }
    const plan = body.plan && body.plan in PLANS ? PLANS[body.plan as PlanKey] : undefined
    const topup = body.topup && body.topup in TOPUPS ? TOPUPS[body.topup as TopupKey] : undefined
    if (!plan === !topup) return fail(400, 'Choose a plan or a top-up.')
    const product = env[productEnv((plan || topup)!.key as PlanKey | TopupKey, live)]
    if (!env.DODO_API_KEY || !product) return fail(503, 'This plan isn’t available yet.')
    const account = await wallet.account(userId)
    const active = account?.subscription?.status === 'active'
    if (topup && !active) return fail(403, 'Top-ups are for Pro and Max plans. Choose a plan first.')
    if (plan && active) return fail(409, 'You already have a plan. Manage or cancel it first.')
    const r = await dodo('/checkouts', {
      method: 'POST',
      body: JSON.stringify({
        product_cart: [{ product_id: product, quantity: 1 }],
        customer: { email: account?.email || vk.description },
        return_url: `${(env.PUBLIC_URL || 'https://account.agentshot.si').replace(/\/+$/, '')}/paid`,
        // what Pitch's webhook reads to grant the plan or the top-up
        metadata: { clerk_user_id: userId, credits: String((plan || topup)!.credits), pack: (plan || topup)!.key, type: plan ? 'subscription' : 'topup', affiliate_cookie: '', source: 'manul' },
        billing_currency: 'USD',
        feature_flags: { allow_currency_selection: false },
      }),
    })
    const out = await r.json().catch(() => ({})) as { checkout_url?: string }
    if (!r.ok || !out.checkout_url) {
      console.error('checkout:', r.status, JSON.stringify(out).slice(0, 300))
      return fail(502, 'Could not start the payment. Try again in a moment.')
    }
    console.log(JSON.stringify({ checkout: (plan || topup)!.key, user: userId }))
    track(env, 'manul checkout started', userId, { pack: (plan || topup)!.key, type: plan ? 'subscription' : 'topup', price: (plan || topup)!.price })
    return json({ url: out.checkout_url })
  }

  /** Dodo's own page to change the card, see invoices or cancel, for the customer with the account's email. */
  async function portal() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    const account = userId ? await wallet!.account(userId) : undefined
    if (!account || !env.DODO_API_KEY) return fail(503, 'Accounts are unavailable. Try again later.')
    const list = await dodo(`/customers?email=${encodeURIComponent(account.email)}`)
    const customers = list.ok ? ((await list.json()) as { items?: { customer_id: string }[] }).items || [] : []
    if (!customers[0]) return fail(404, 'No plan to manage yet.')
    const r = await dodo(`/customers/${encodeURIComponent(customers[0].customer_id)}/customer-portal/session`, { method: 'POST' })
    const out = await r.json().catch(() => ({})) as { link?: string }
    if (!r.ok || !out.link) return fail(502, 'Could not open billing. Try again in a moment.')
    return json({ url: out.link })
  }

  /** Voice or music, made with AgentShot's keys and paid for with the caller's credits. */
  async function generate(kind: 'voice' | 'music') {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const body = await req.json().catch(() => null) as VoiceRequest & MusicRequest
    const cfg = await mediaConfig(env)
    const choice = cfg[kind], voices = { ...VOICES, ...cfg.voices }
    const what = kind === 'voice' ? 'Voice' : 'Music'
    try { kind === 'voice' ? checkVoice(body, voices) : checkMusic(body) } catch (e) { return fail(400, (e as Error).message) }
    const usd = price(cfg.prices?.[choice.model], body)
    const key = env[KEY_ENV[choice.provider] as keyof Env] as string | undefined
    if (usd == null || !key) {
      console.error(`media: ${kind} → ${choice.provider}/${choice.model} has no ${usd == null ? 'price in media.json' : 'key'}`)
      return fail(503, `${what} isn’t available right now. Try again later.`)
    }
    const cost = creditsForPrice(usd)
    const operation = `manul:media:${randomUUID()}`
    // Taken before the vendor call, under the wallet's lock, so two calls can't spend the same credits.
    const taken = await wallet.lock(userId, async () => {
      const left = (await wallet.account(userId))?.available ?? 0
      if (left < cost) return left
      await wallet.post(userId, -cost, 'usage', `AgentShot: ${kind}`, operation)
      return true
    })
    if (taken !== true) track(env, 'manul out of credits', userId, { kind })
    if (taken !== true) return fail(402, `You're out of AgentShot credits: this needs ${cost} and ${Math.max(0, taken)} are left. Get more in Settings → Keys → AgentShot key.`)
    let audio
    try {
      audio = kind === 'voice' ? await speak(choice, key, body, { voices }) : await compose(choice, key, body)
    } catch (e) {
      await wallet.post(userId, cost, 'usage', `AgentShot: ${kind} refund`, operation + ':refund')
      if (!(e instanceof MediaError)) throw e
      console.error(`media: ${kind} → ${choice.provider}/${choice.model}: ${e.message}`)
      if (e.status !== 422) return fail(e.status === 429 ? 429 : 502, `${what} couldn't be made right now. Try again in a moment.`)
      // the request itself was refused (a named artist, a blocked word): say why, without saying who refused it
      const hide = new RegExp([choice.model, choice.provider, VENDOR_NAME[choice.provider]].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
      return fail(422, `${what} couldn't be made: ${e.message.replace(hide, 'the model')}.`)
    } finally {
      // the gateway's budget follows the wallet
      await sync(env, wallet, vk.id, userId).catch(e => console.error('sync:', e.message))
    }

    console.log(JSON.stringify({ media: kind, user: userId, provider: choice.provider, model: choice.model, credits: cost }))
    return new Response(audio.data as Uint8Array<ArrayBuffer>, { headers: { 'content-type': audio.type, 'x-manul-cost': String(cost) } })
  }

  async function joinMesh() {
    const poolSecret = req.headers.get('x-manul-pool-secret') || ''
    const isPoolWorker = !!(env.WORKER_POOL_SECRET && poolSecret && same(poolSecret, env.WORKER_POOL_SECRET))
    if (!isPoolWorker) {
      const vk = await caller()
      if (vk instanceof Response) return vk
    }
    if (!env.HEADSCALE_URL || !env.HEADSCALE_API_KEY) return fail(503, 'Mesh is not configured yet.')
    const body = (await req.json().catch(() => ({}))) as { role?: 'client' | 'worker'; persistent?: boolean }
    const role = isPoolWorker || body.role === 'worker' ? 'worker' : 'client'
    // a paired phone keeps its node: an ephemeral one is deleted after 30 min offline and could never rejoin
    const ephemeral = role === 'client' && body.persistent !== true
    const hs = (path: string, init: RequestInit = {}) =>
      fetch(`${env.HEADSCALE_URL!.replace(/\/+$/, '')}${path}`, {
        signal: AbortSignal.timeout(10_000),
        ...init,
        headers: { authorization: `Bearer ${env.HEADSCALE_API_KEY}`, 'content-type': 'application/json', ...init.headers },
      })
    const usersRes = await hs('/api/v1/user')
    if (!usersRes.ok) return fail(502, 'Could not reach the mesh control server.')
    const usersData = (await usersRes.json().catch(() => ({}))) as { users?: { id: string; name: string }[] }
    let meshUser = usersData.users?.find(u => u.name === 'manul')
    if (!meshUser) {
      const created = await hs('/api/v1/user', { method: 'POST', body: JSON.stringify({ name: 'manul' }) })
      if (created.ok) {
        const out = (await created.json().catch(() => ({}))) as { user?: { id: string; name: string } }
        meshUser = out.user
      }
    }
    const tag = role === 'worker' ? 'tag:worker' : 'tag:client'
    const expiration = new Date(Date.now() + 60 * 60_000).toISOString()
    // Headscale v0.23 takes user by name; v0.24+ takes user by id. Try id first if present, fall back to 'manul'.
    let keyRes = await hs('/api/v1/preauthkey', {
      method: 'POST',
      body: JSON.stringify({ user: meshUser?.id || 'manul', reusable: false, ephemeral, expiration, aclTags: [tag] }),
    })
    if (!keyRes.ok && meshUser?.id) {
      keyRes = await hs('/api/v1/preauthkey', {
        method: 'POST',
        body: JSON.stringify({ user: 'manul', reusable: false, ephemeral, expiration, aclTags: [tag] }),
      })
    }
    const keyOut = (await keyRes.json().catch(() => ({}))) as { preAuthKey?: { key?: string } }
    if (!keyRes.ok || !keyOut.preAuthKey?.key) return fail(502, 'Could not create a mesh key.')
    return json({
      controlUrl: (env.HEADSCALE_PUBLIC_URL || env.HEADSCALE_URL).replace(/\/+$/, ''),
      authKey: keyOut.preAuthKey.key,
      tag,
    })
  }

  async function heartbeatWorker() {
    if (!wallet) return fail(503, 'Accounts are unavailable. Try again later.')
    const poolSecret = req.headers.get('x-manul-pool-secret') || ''
    const isPool = !!(env.WORKER_POOL_SECRET && poolSecret && same(poolSecret, env.WORKER_POOL_SECRET))
    let ownerId: string | undefined
    if (!isPool) {
      const vk = await caller()
      if (vk instanceof Response) return vk
      ownerId = await owner(vk)
      if (!ownerId) return fail(503, 'Accounts are unavailable. Try again later.')
    }
    const body = (await req.json().catch(() => ({}))) as {
      id?: string
      name?: string
      urls?: unknown
      fingerprint?: string
      secret?: string
      capabilities?: WorkerCapabilities
    }
    const id = typeof body.id === 'string' && /^[a-zA-Z0-9._-]{3,80}$/.test(body.id) ? body.id : ''
    const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim().slice(0, 80) : 'Worker'
    const urls = Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === 'string' && /^https:\/\/[^\s/]+$/.test(u)).slice(0, 12) : []
    const fingerprint = typeof body.fingerprint === 'string' && /^[0-9a-f]{64}$/i.test(body.fingerprint) ? body.fingerprint.toLowerCase() : ''
    const secret = typeof body.secret === 'string' && body.secret.length >= 32 && body.secret.length <= 256 ? body.secret : ''
    if (!id || !urls.length || !fingerprint || !secret) return fail(400, 'Invalid worker registration.')
    const rec = await wallet.upsertWorker({
      id,
      ownerId,
      // only the pool secret makes a cloud worker: a signed-in machine saying so stays the owner's own
      pool: isPool,
      name,
      urls,
      fingerprint,
      secret,
      capabilities: body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : {},
    })
    return json({ id: rec.id, pool: rec.pool, leasedTo: rec.leasedTo, leasedUntil: rec.leasedUntil })
  }

  async function listWorkers() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const { owned, leased, poolAvailable } = await wallet.workersFor(userId)
    const toClient = (w: WorkerRecord) => {
      const expiresAt = w.pool && w.leasedUntil ? w.leasedUntil : Date.now() + 24 * 60 * 60_000
      return {
        id: w.id,
        name: w.name,
        pool: w.pool,
        urls: w.urls,
        fingerprint: w.fingerprint,
        token: signWorkerToken(w.secret, userId, w.pool, expiresAt),
        capabilities: w.capabilities,
        expiresAt,
      }
    }
    return json({ workers: [...owned.map(toClient), ...leased.map(toClient)], poolAvailable })
  }

  async function leaseWorker() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const body = (await req.json().catch(() => ({}))) as { projectId?: string; workerId?: string }
    const leased = await wallet.leaseWorker(userId, {
      projectId: typeof body.projectId === 'string' ? body.projectId : undefined,
      workerId: typeof body.workerId === 'string' ? body.workerId : undefined,
    })
    if (!leased) return fail(404, 'No cloud workers are free right now. Try again in a moment.')
    const expiresAt = leased.leasedUntil ?? Date.now() + 60 * 60_000
    return json({
      worker: {
        id: leased.id,
        name: leased.name,
        pool: true,
        urls: leased.urls,
        fingerprint: leased.fingerprint,
        token: signWorkerToken(leased.secret, userId, true, expiresAt),
        capabilities: leased.capabilities,
        expiresAt,
      },
    })
  }

  async function releaseWorker() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const userId = await owner(vk)
    if (!wallet || !userId) return fail(503, 'Accounts are unavailable. Try again later.')
    const body = (await req.json().catch(() => ({}))) as { workerId?: string }
    if (typeof body.workerId !== 'string' || !body.workerId) return fail(400, 'Specify workerId.')
    const ok = await wallet.releaseWorker(userId, body.workerId)
    return json({ released: ok })
  }
}

/** On to agentshot://auth/callback with what Clerk sent (the code and state, or its error); a button too, for a browser
 *  that wants a tap before it opens an app. */
function phoneCallback(url: URL): Response {
  const back = new URL('agentshot://auth/callback')
  for (const key of ['code', 'state', 'error', 'error_description']) {
    const value = url.searchParams.get(key)
    if (value) back.searchParams.set(key, value)
  }
  const href = back.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return new Response(brandPage(`Signed in. <a href="${href}">Back to AgentShot</a>`), {
    status: 302,
    headers: { location: back.toString(), 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Equal strings, compared in constant time. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

/** Stateless HMAC token verified locally by MobileBridge on the worker without an account round-trip. */
export function signWorkerToken(workerSecret: string, userId: string, pool: boolean, expiresAt: number): string {
  const scope = pool ? `pool:${userId}` : `owner:${userId}`
  const payload = `${expiresAt}.${Buffer.from(scope, 'utf8').toString('base64url')}`
  const sig = createHmac('sha256', workerSecret).update(payload).digest('base64url')
  return `lease.${payload}.${sig}`
}
