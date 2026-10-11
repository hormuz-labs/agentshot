// Manul accounts (served by server.mjs, in the cluster next to the gateway): who is signing in (Clerk), that person's
// Manul key (a Bifrost virtual key under their own Bifrost customer, so every request and every dollar in the gateway is
// theirs), and their credit (the key's budget: FREE_CREDIT when they first sign in, raised by every payment).
//
//   POST /v1/key            Bearer <Clerk OAuth access token>              → { key, key_id, email }
//   GET  /v1/balance        Bearer <Manul key>, X-Manul-Key-Id: <key_id>   → { credit, used, left }
//   POST /v1/checkout       same, body { amount? } (USD)                   → { url }  (Dodo Payments checkout)
//   POST /v1/dodo/webhook   Dodo Payments, signed (Standard Webhooks)      → payment.succeeded raises the budget
//   GET  /paid              where the checkout returns to
//   GET  /v1/voices         as the key                                     → { voices: [{ name, about }] }
//   POST /v1/voice          as the key, body VoiceRequest (media.ts)       → the audio (MP3 or WAV)
//   POST /v1/music          as the key, body MusicRequest (media.ts)       → the audio
//
// Voice and music are made with Manul's own vendor keys; which vendor and model, the voices and the prices are in
// media.json (MEDIA_CONFIG, re-read every 30 s so a changed ConfigMap applies without a restart). The app is never
// told who made it. The price is taken off the key's credit after the audio is made.
//
// Which key is whose, and which payments were already credited, live in the Clerk user's private metadata:
// { bifrost: { customer_id, virtual_key_id }, payments: { <payment_id>: <dollars> } }. The key's name is the Clerk user
// id. A key turned off in the gateway's dashboard stays off: signing in again doesn't make a new one.

import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { changeCredit, reconcile, type Budget, type CreditStore, type Journal } from './credit.ts'
import { checkMusic, checkVoice, compose, KEY_ENV, MediaError, speak, VENDOR_NAME, VOICES, type Choice, type MusicRequest, type Voice, type VoiceRequest } from './media.ts'

export interface Env {
  /** Clerk's Frontend API, e.g. https://clerk.manul.si (the OAuth issuer) */
  CLERK_ISSUER: string
  /** Clerk Backend API secret (sk_…) */
  CLERK_SECRET_KEY: string
  /** the gateway's admin API, e.g. http://bifrost:8080 */
  BIFROST_URL: string
  /** the gateway's admin credential, as the Authorization header: "Basic base64(user:password)" */
  BIFROST_AUTH: string
  /** Persistent account credit journal (Postgres); independent of Bifrost's tables. */
  ACCOUNT_DATABASE_URL?: string
  /** Separate local account metadata from deployed keys/payments in the same Clerk instance. */
  ACCOUNT_METADATA_KEY?: string
  /** Configured provider IDs, used to keep new-key grants valid for this gateway. */
  BIFROST_PROVIDERS?: string
  /** Only before local dashboard setup; production uses BIFROST_AUTH. */
  BIFROST_SETUP_TOKEN?: string
  /** JSON: what a new key gets (rate_limit, provider_configs); default NEW_KEY below */
  NEW_KEY?: string
  /** USD a new person starts with; default 2 */
  FREE_CREDIT?: string
  /** Dodo Payments: https://test.dodopayments.com or https://live.dodopayments.com */
  DODO_API?: string
  DODO_API_KEY?: string
  /** the "Manul credit" product (one-time, Pay What You Want) */
  DODO_PRODUCT_ID?: string
  /** the webhook endpoint's signing secret (whsec_…) */
  DODO_WEBHOOK_SECRET?: string
  /** where the account service is reached, for the checkout's return page; default https://account.manul.si */
  PUBLIC_URL?: string
  /** path to media.json (which vendor makes voice and music, the voices, the prices); default MEDIA below */
  MEDIA_CONFIG?: string
  GEMINI_API_KEY?: string
  ELEVENLABS_API_KEY?: string
  OPENAI_API_KEY?: string
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

/** A budget that never resets: credit, used up and topped up. */
const FOREVER = '100Y'

/** A new person's key: a rate limit, and the models the gateway's `manul` routing rule may pick. */
export const NEW_KEY = {
  rate_limit: { request_max_limit: 300, request_reset_duration: '1h' },
  provider_configs: [
    { provider: 'anthropic', allowed_models: ['claude-opus-5-5', 'claude-sonnet-5-5'], key_ids: ['*'], weight: 1 },
    { provider: 'gemini', allowed_models: ['gemini-3.8-flash', 'gemini-3.1-pro-preview'], key_ids: ['*'], weight: 1 },
    { provider: 'openai', allowed_models: ['gpt-5.5'], key_ids: ['*'], weight: 1 },
    { provider: 'azure', allowed_models: ['gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna', 'gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'], key_ids: ['*'], weight: 1 },
  ],
}

const CLERK_API = 'https://api.clerk.com/v1'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const fail = (status: number, error: string) => json({ error }, status)
const page = (msg: string) => new Response(`<!doctype html><meta charset="utf-8"><title>Manul</title><body style="font:15px system-ui;display:grid;place-items:center;height:90vh;color:#141413;background:#fbfbf9"><p>${msg}</p>`, { headers: { 'content-type': 'text/html; charset=utf-8' } })
const cents = (usd: number) => Math.round(usd * 100)

type VirtualKey = { id: string; name: string; description?: string; value: string; is_active: boolean; budgets?: Budget[] }
type Meta = { bifrost?: { customer_id: string; virtual_key_id: string }; payments?: Record<string, number> }

export async function handle(req: Request, env: Env, credits?: CreditStore): Promise<Response> {
  const url = new URL(req.url)
  const clerk = (path: string, init: RequestInit = {}) =>
    fetch(`${CLERK_API}${path}`, { signal: AbortSignal.timeout(10_000), ...init, headers: { authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'content-type': 'application/json', ...init.headers } })
  const bifrost = (path: string, init: RequestInit = {}) =>
    fetch(`${env.BIFROST_URL.replace(/\/+$/, '')}/api/governance${path}`, { signal: AbortSignal.timeout(10_000), ...init, headers: { ...(env.BIFROST_AUTH ? { authorization: env.BIFROST_AUTH } : { 'X-Bifrost-Setup-Token': env.BIFROST_SETUP_TOKEN || '' }), 'content-type': 'application/json', ...init.headers } })
  const getKey = async (id: string) => {
    const r = await bifrost(`/virtual-keys/${encodeURIComponent(id)}`)
    return r.ok ? ((await r.json()) as { virtual_key: VirtualKey }).virtual_key : r.status === 404 ? null : undefined
  }
  const meta = async (userId: string) => {
    const r = await clerk(`/users/${encodeURIComponent(userId)}`)
    if (!r.ok) return undefined
    const all = ((await r.json()) as { private_metadata?: Record<string, unknown> }).private_metadata || {}
    return (env.ACCOUNT_METADATA_KEY ? all[env.ACCOUNT_METADATA_KEY] || {} : all) as Meta
  }
  const saveMeta = (userId: string, m: Meta) =>
    clerk(`/users/${encodeURIComponent(userId)}/metadata`, { method: 'PATCH', body: JSON.stringify({ private_metadata: env.ACCOUNT_METADATA_KEY ? { [env.ACCOUNT_METADATA_KEY]: m } : m }) })

  /** The caller's key, proven by its value (the app sends the Manul key and the key id it was given with it). */
  const caller = async (): Promise<VirtualKey | Response> => {
    const value = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    const id = req.headers.get('x-manul-key-id')
    if (!value || !id) return fail(401, 'Sign in first.')
    const vk = await getKey(id)
    if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
    if (!vk || !same(vk.value, value)) return fail(401, 'Sign in again.')
    // Audio and checkout use the admin API, so Bifrost's inference middleware cannot enforce this for us.
    if (!vk.is_active) return fail(403, 'Your Manul key is turned off. Contact support.')
    return vk
  }

  if (url.pathname === '/v1/key' && req.method === 'POST') return signIn()
  if (url.pathname === '/v1/balance' && req.method === 'GET') {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const b = vk.budgets?.[0]
    const credit = b?.max_limit ?? 0, used = b?.current_usage ?? 0
    return json({ credit, used, left: Math.max(0, credit - used) })
  }
  if (url.pathname === '/v1/checkout' && req.method === 'POST') return checkout()
  if (url.pathname === '/v1/dodo/webhook' && req.method === 'POST') return webhook()
  if (url.pathname === '/v1/voices' && req.method === 'GET') {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const cfg = await mediaConfig(env)
    return json({ voices: Object.entries({ ...VOICES, ...cfg.voices }).map(([name, v]) => ({ name, about: v.about })) })
  }
  if (url.pathname === '/v1/voice' && req.method === 'POST') return generate('voice')
  if (url.pathname === '/v1/music' && req.method === 'POST') return generate('music')
  if (url.pathname === '/paid') return page('Payment received. Your credit is added in a moment: go back to Manul.')
  return fail(404, 'Not found.')

  async function signIn() {
    const token = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '')?.[1]
    if (!token) return fail(401, 'Sign in first.')
    // who: Clerk checks its own token
    const who = await fetch(`${env.CLERK_ISSUER.replace(/\/+$/, '')}/oauth/userinfo`, { signal: AbortSignal.timeout(10_000), headers: { authorization: `Bearer ${token}` } })
    if (!who.ok) return fail(401, 'Your sign-in has expired. Sign in again.')
    const { sub, email } = await who.json() as { sub: string; email?: string }
    if (!sub) return fail(401, 'Your sign-in has expired. Sign in again.')

    const m = await meta(sub)
    if (!m) return fail(502, 'Could not reach accounts. Try again in a moment.')
    const link = m.bifrost

    // a returning person: the same key
    if (link?.virtual_key_id) {
      const vk = await getKey(link.virtual_key_id)
      if (vk === undefined) return fail(502, 'Could not reach the gateway. Try again in a moment.')
      if (vk) {
        if (!vk.is_active) return fail(403, 'Your Manul key is turned off. Contact support.')
        return json({ key: vk.value, key_id: vk.id, email })
      }
      // the key was deleted in the gateway: make a new one below (credit starts again from what they paid)
    }

    // a new person: their customer, their key with the free credit, and the link from the Clerk user
    const name = email || sub
    let customerId = link?.customer_id
    if (!customerId) {
      const c = await bifrost('/customers', { method: 'POST', body: JSON.stringify({ name }) })
      if (!c.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
      customerId = ((await c.json()) as { customer: { id: string } }).customer.id
    }
    const paid = Object.values(m.payments || {}).reduce((a, b) => a + b, 0)
    const credit = (link ? 0 : Number(env.FREE_CREDIT ?? 2)) + paid
    const grants = env.NEW_KEY ? JSON.parse(env.NEW_KEY) : NEW_KEY
    // Local gateways can omit Azure; granting an absent provider makes key creation fail.
    const providers = env.BIFROST_PROVIDERS?.split(',').map(p => p.trim()).filter(Boolean)
    const v = await bifrost('/virtual-keys', {
      method: 'POST',
      body: JSON.stringify({
        ...grants,
        ...(providers ? { provider_configs: grants.provider_configs.filter((p: { provider: string }) => providers.includes(p.provider)) } : {}),
        budgets: [{ max_limit: credit, reset_duration: FOREVER }],
        name: sub, description: name, customer_id: customerId, is_active: true,
      }),
    })
    if (!v.ok) return fail(502, 'Could not create your Manul key. Try again in a moment.')
    const vk = ((await v.json()) as { virtual_key: VirtualKey }).virtual_key
    const saved = await saveMeta(sub, { bifrost: { customer_id: customerId, virtual_key_id: vk.id } })
    if (!saved.ok) return fail(502, 'Could not save your Manul key. Try again in a moment.')
    return json({ key: vk.value, key_id: vk.id, email })
  }

  async function checkout() {
    const vk = await caller()
    if (vk instanceof Response) return vk
    if (!env.DODO_API_KEY || !env.DODO_PRODUCT_ID) return fail(503, 'Adding credit isn’t available yet.')
    const body = await req.json().catch(() => ({})) as { amount?: number }
    const amount = body.amount != null ? Number(body.amount) : undefined
    if (amount != null && !(Number.isFinite(amount) && amount >= 5 && amount <= 1000)) return fail(400, 'Choose an amount between $5 and $1,000.')
    const r = await fetch(`${(env.DODO_API || 'https://test.dodopayments.com').replace(/\/+$/, '')}/checkouts`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.DODO_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        product_cart: [{ product_id: env.DODO_PRODUCT_ID, quantity: 1, ...(amount != null ? { amount: cents(amount) } : {}) }],
        ...(vk.description?.includes('@') ? { customer: { email: vk.description } } : {}),
        return_url: `${(env.PUBLIC_URL || 'https://account.manul.si').replace(/\/+$/, '')}/paid`,
        metadata: { virtual_key_id: vk.id, user_id: vk.name },
        // Credit is denominated in USD and the webhook intentionally rejects other currencies.
        billing_currency: 'USD',
        feature_flags: { allow_currency_selection: false },
      }),
    })
    const out = await r.json().catch(() => ({})) as { checkout_url?: string }
    if (!r.ok || !out.checkout_url) return fail(502, 'Could not start the payment. Try again in a moment.')
    return json({ url: out.checkout_url })
  }

  /** Voice or music, made with Manul's keys and paid for with the caller's credit. */
  async function generate(kind: 'voice' | 'music') {
    if (!credits) return fail(503, 'Credit storage is unavailable. Try again later.')
    const id = req.headers.get('x-manul-key-id')
    if (!id) return fail(401, 'Sign in first.')
    return credits.lock(id, journal => generateLocked(kind, journal))
  }

  async function generateLocked(kind: 'voice' | 'music', journal: Journal) {
    const vk = await caller()
    if (vk instanceof Response) return vk
    const put = putBudget(vk.id)
    await reconcile(journal, put)
    const fresh = await getKey(vk.id)
    if (!fresh) return fail(502, 'Could not reach the gateway.')
    if (!fresh.is_active) return fail(403, 'Your Manul key is turned off. Contact support.')
    const body = await req.json().catch(() => null) as VoiceRequest & MusicRequest
    const cfg = await mediaConfig(env)
    const choice = cfg[kind], voices = { ...VOICES, ...cfg.voices }
    const what = kind === 'voice' ? 'Voice' : 'Music'
    try { kind === 'voice' ? checkVoice(body, voices) : checkMusic(body) } catch (e) { return fail(400, (e as Error).message) }
    const cost = price(cfg.prices?.[choice.model], body)
    const key = env[KEY_ENV[choice.provider] as keyof Env]
    if (cost == null || !key) {
      console.error(`media: ${kind} → ${choice.provider}/${choice.model} has no ${cost == null ? 'price in media.json' : 'key'}`)
      return fail(503, `${what} isn’t available right now. Try again later.`)
    }
    const b = fresh.budgets?.[0]
    const left = (b?.max_limit ?? 0) - (b?.current_usage ?? 0)
    if (left < cost) return fail(402, `You're out of Manul credit: this needs $${cost.toFixed(2)} and $${Math.max(0, left).toFixed(2)} is left. Add credit in Settings → Keys → Manul key.`)
    if (!b) return fail(402, 'You are out of Manul credit.')
    const operation = 'media:' + randomUUID()
    // Reserve before the vendor call, so concurrent gateway inference sees the reduced budget.
    await changeCredit(journal, operation, vk.id, -cost, b, put)

    let audio
    try {
      audio = kind === 'voice' ? await speak(choice, key, body, { voices }) : await compose(choice, key, body)
    } catch (e) {
      const now = await getKey(vk.id)
      if (!now?.budgets?.[0]) throw new Error('Could not refund failed media generation.')
      await changeCredit(journal, operation + ':refund', vk.id, cost, now.budgets[0], put)
      if (!(e instanceof MediaError)) throw e
      console.error(`media: ${kind} → ${choice.provider}/${choice.model}: ${e.message}`)
      if (e.status !== 422) return fail(e.status === 429 ? 429 : 502, `${what} couldn't be made right now. Try again in a moment.`)
      // the request itself was refused (a named artist, a blocked word): say why, without saying who refused it
      const hide = new RegExp([choice.model, choice.provider, VENDOR_NAME[choice.provider]].map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi')
      return fail(422, `${what} couldn't be made: ${e.message.replace(hide, 'the model')}.`)
    }

    console.log(JSON.stringify({ media: kind, user: vk.name, provider: choice.provider, model: choice.model, usd: cost }))
    return new Response(audio.data as Uint8Array<ArrayBuffer>, { headers: { 'content-type': audio.type, 'x-manul-cost': cost.toFixed(4) } })
  }

  function putBudget(id: string) {
    return async (budget: Budget) => {
      const r = await bifrost(`/virtual-keys/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ budgets: [{ id: budget.id, max_limit: budget.max_limit, reset_duration: budget.reset_duration }] }) })
      if (!r.ok) throw new Error('Could not update the credit. Try again in a moment.')
    }
  }

  async function webhook() {
    const raw = await req.text()
    if (!env.DODO_WEBHOOK_SECRET || !(await verify(env.DODO_WEBHOOK_SECRET, req.headers, raw))) return fail(401, 'Bad signature.')
    let event: { type: string; data: { payment_id: string; total_amount: number; tax?: number | null; currency: string; metadata?: Record<string, string> } }
    try { event = JSON.parse(raw) } catch { return fail(400, 'Invalid webhook payload.') }
    if (event.type !== 'payment.succeeded') return json({ ok: true })
    const { payment_id, metadata } = event.data
    const userId = metadata?.user_id, keyId = metadata?.virtual_key_id
    if (!userId || !keyId) return json({ ok: true, skipped: 'not a Manul credit payment' })
    if (event.data.currency !== 'USD') return fail(422, `Unexpected currency ${event.data.currency}.`)
    const dollars = (event.data.total_amount - (event.data.tax || 0)) / 100   // the price, before tax
    if (!payment_id || !Number.isSafeInteger(event.data.total_amount) || !Number.isSafeInteger(event.data.tax || 0) || dollars <= 0) return fail(422, 'Invalid payment amount.')
    if (!credits) return fail(503, 'Credit storage is unavailable. Try again later.')
    return credits.lock(keyId, async journal => {
      await reconcile(journal, putBudget(keyId))
      const m = await meta(userId)
      if (!m) return fail(502, 'Could not reach accounts.')                     // Dodo retries
      if (m.payments?.[payment_id] != null) return json({ ok: true, already: true })
      const vk = await getKey(keyId)
      if (!vk) return fail(502, 'Could not reach the gateway.')
      if (vk.name !== userId || m.bifrost?.virtual_key_id !== keyId) return fail(422, 'Payment does not match this account.')
      const b = vk.budgets?.[0]
      if (!b) return fail(502, 'The key has no credit budget.')
      const added = await changeCredit(journal, 'dodo:' + payment_id, keyId, dollars, b, putBudget(keyId))
      // Clerk is a mirror, not the idempotency record. Retry this write without repeating the credit.
      const saved = await saveMeta(userId, { payments: { ...(m.payments || {}), [payment_id]: dollars } })
      if (!saved.ok) return fail(502, 'Could not record the payment.')
      return json(added ? { ok: true, credited: dollars } : { ok: true, already: true })
    })
  }
}

/** Standard Webhooks: base64(HMAC-SHA256(key, `${id}.${timestamp}.${body}`)), key = base64 after "whsec_"; within 5 minutes. */
export async function verify(secret: string, headers: Headers, body: string, now = Date.now()) {
  const id = headers.get('webhook-id'), ts = headers.get('webhook-timestamp'), sigs = headers.get('webhook-signature')
  if (!id || !ts || !sigs || !/^\d+$/.test(ts) || Math.abs(now / 1000 - Number(ts)) > 300) return false
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret.replace(/^whsec_/, '')), c => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${ts}.${body}`)))
  const want = btoa(String.fromCharCode(...mac))
  return sigs.split(' ').some(s => same(s.replace(/^v1,/, ''), want))
}

/** Equal strings, compared in constant time. */
function same(a: string, b: string) {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}
