// Actual Bifrost + Postgres, fake Clerk/vendor. Run with a disposable probe and database.
import { createHmac } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { handle, type Env } from '../account/src/index'
import { postgresCreditStore, type CreditStore } from '../account/src/credit'

const gateway = process.env.BIFROST_PROBE
const database = process.env.ACCOUNT_TEST_DATABASE_URL
const setup = process.env.BIFROST_TEST_SETUP_TOKEN || 'probe-only'
const secret = 'whsec_' + Buffer.from('integration-signing-key').toString('base64')
const env: Env = { CLERK_ISSUER: 'https://clerk.integration', CLERK_SECRET_KEY: 'fake', BIFROST_URL: gateway || '', BIFROST_AUTH: '', BIFROST_SETUP_TOKEN: setup, BIFROST_PROVIDERS: 'anthropic,gemini,openai', DODO_WEBHOOK_SECRET: secret, GEMINI_API_KEY: 'fake' }
const fetchReal = globalThis.fetch
let store: CreditStore
let meta: any = {}
const user = 'user_integration_' + Date.now()
let recordingFailures = 0, lostReplies = 0, vendorCalls = 0
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const key = async (id: string) => {
  const r = await fetchReal(`${gateway}/api/governance/virtual-keys/${id}`, { headers: { 'X-Bifrost-Setup-Token': setup } })
  expect(r.status).toBe(200)
  return (await r.json() as any).virtual_key
}
const webhook = (id: string) => {
  const body = JSON.stringify({ type: 'payment.succeeded', data: { payment_id: id, total_amount: 1000, tax: 0, currency: 'USD', metadata: { user_id: user, virtual_key_id: meta.bifrost.virtual_key_id } } })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`integration.${ts}.${body}`).digest('base64')
  return new Request('https://account.integration/v1/dodo/webhook', { method: 'POST', body, headers: { 'webhook-id': 'integration', 'webhook-timestamp': ts, 'webhook-signature': 'v1,' + sig } })
}
const stub = () => vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
  const url = String(input)
  if (url.startsWith(gateway!)) {
    const r = await fetchReal(input, init)
    if (init.method === 'PUT' && lostReplies-- > 0) throw new Error('lost reply after real Bifrost PUT')
    return r
  }
  if (url.endsWith('/oauth/userinfo')) return reply({ sub: user, email: user + '@example.com' })
  if (url === 'https://api.clerk.com/v1/users/' + user) return reply({ private_metadata: meta })
  if (url.endsWith('/metadata')) {
    const patch = JSON.parse(String(init.body)).private_metadata
    if (patch.payments && recordingFailures-- > 0) return reply({}, 503)
    meta = { ...meta, ...patch }
    return reply({})
  }
  if (url.startsWith('https://generativelanguage.googleapis.com')) {
    vendorCalls++
    return reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } }] })
  }
  throw new Error('Unexpected integration URL ' + url)
})

describe.skipIf(!gateway || !database)('account provisioning and credit with real Bifrost and Postgres', () => {
  beforeAll(async () => { store = await postgresCreditStore(database!) })
  afterAll(async () => { await store?.close?.() })
  afterEach(() => vi.unstubAllGlobals())

  it('provisions a key against the local provider set and preserves the $2 non-resetting budget', async () => {
    stub()
    const req = () => new Request('https://account.integration/v1/key', { method: 'POST', headers: { authorization: 'Bearer fake-clerk' } })
    const r = await handle(req(), env, store)
    expect(r.status, await r.clone().text()).toBe(200)
    const account = await r.json() as any
    expect((await key(account.key_id)).budgets[0]).toMatchObject({ max_limit: 2, current_usage: 0, reset_duration: '100Y' })
    expect((await (await handle(req(), env, store)).json()).key_id).toBe(account.key_id)
  })

  it('survives a process/store restart after credit succeeds but Clerk recording fails', async () => {
    stub()
    recordingFailures = 1
    expect((await handle(webhook('payment_restart_' + user), env, store)).status).toBe(502)
    expect((await key(meta.bifrost.virtual_key_id)).budgets[0].max_limit).toBe(12)
    await store.close?.()
    store = await postgresCreditStore(database!)
    expect(await (await handle(webhook('payment_restart_' + user), env, store)).json()).toEqual({ ok: true, already: true })
    expect((await key(meta.bifrost.virtual_key_id)).budgets[0].max_limit).toBe(12)
  })

  it('recovers an ambiguous real gateway write without adding the payment twice', async () => {
    stub()
    lostReplies = 1
    await expect(handle(webhook('payment_lost_' + user), env, store)).rejects.toThrow('lost reply')
    expect((await key(meta.bifrost.virtual_key_id)).budgets[0].max_limit).toBe(22)
    await store.close?.()
    store = await postgresCreditStore(database!)
    expect((await handle(webhook('payment_lost_' + user), env, store)).status).toBe(200)
    expect((await key(meta.bifrost.virtual_key_id)).budgets[0].max_limit).toBe(22)
  })

  it('serializes independent replicas and simultaneous duplicate payments', async () => {
    stub()
    const second = await postgresCreditStore(database!)
    try {
      const same = 'payment_concurrent_' + user
      const rs = await Promise.all([handle(webhook(same), env, store), handle(webhook(same), env, second), handle(webhook('payment_other_' + user), env, second)])
      expect(rs.map(r => r.status)).toEqual([200, 200, 200])
      expect((await key(meta.bifrost.virtual_key_id)).budgets[0].max_limit).toBe(42)
    } finally { await second.close?.() }
  })

  it('blocks a disabled real key before contacting an audio vendor', async () => {
    const id = meta.bifrost.virtual_key_id
    const vk = await key(id)
    const r = await fetchReal(`${gateway}/api/governance/virtual-keys/${id}`, { method: 'PUT', headers: { 'X-Bifrost-Setup-Token': setup, 'content-type': 'application/json' }, body: JSON.stringify({ is_active: false }) })
    expect(r.status).toBe(200)
    stub()
    const audio = await handle(new Request('https://account.integration/v1/voice', { method: 'POST', headers: { authorization: 'Bearer ' + vk.value, 'x-manul-key-id': id }, body: '{"text":"Hello."}' }), env, store)
    expect(audio.status).toBe(403)
    expect(vendorCalls).toBe(0)
  })

  it('coordinates an audio debit and payment on different replicas without overwriting either', async () => {
    const id = meta.bifrost.virtual_key_id
    const vk = await key(id)
    await fetchReal(`${gateway}/api/governance/virtual-keys/${id}`, { method: 'PUT', headers: { 'X-Bifrost-Setup-Token': setup, 'content-type': 'application/json' }, body: JSON.stringify({ is_active: true }) })
    stub()
    const second = await postgresCreditStore(database!)
    try {
      const audio = new Request('https://account.integration/v1/voice', { method: 'POST', headers: { authorization: 'Bearer ' + vk.value, 'x-manul-key-id': id }, body: JSON.stringify({ text: 'Hello'.repeat(200) }) })
      const rs = await Promise.all([handle(audio, env, store), handle(webhook('payment_audio_' + user), env, second)])
      expect(rs.map(r => r.status)).toEqual([200, 200])
      expect((await key(id)).budgets[0]).toMatchObject({ max_limit: 51.98, current_usage: 0 })
    } finally { await second.close?.() }
  })
})
