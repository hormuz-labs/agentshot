// Actual Bifrost + Postgres (the wallet's tables made the way local runs make them), fake Clerk/vendor. Run with a
// disposable probe and database.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { handle, sync, type Env } from '../account/src/index'
import { costForCredits, STARTER_CREDITS } from '../account/src/plans'
import { postgresWallet, type Wallet } from '../account/src/wallet'

const gateway = process.env.BIFROST_PROBE
const database = process.env.ACCOUNT_TEST_DATABASE_URL
const setup = process.env.BIFROST_TEST_SETUP_TOKEN || 'probe-only'
const env: Env = { CLERK_ISSUER: 'https://clerk.integration', CLERK_SECRET_KEY: 'fake', BIFROST_URL: gateway || '', BIFROST_AUTH: '', BIFROST_SETUP_TOKEN: setup, BIFROST_PROVIDERS: 'anthropic,gemini,openai', GEMINI_API_KEY: 'fake' }
const fetchReal = globalThis.fetch
let wallet: Wallet
let meta: any = {}
const user = 'user_integration_' + Date.now()
let vendorCalls = 0
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const key = async (id: string) => {
  const r = await fetchReal(`${gateway}/api/governance/virtual-keys/${id}`, { headers: { 'X-Bifrost-Setup-Token': setup } })
  expect(r.status).toBe(200)
  return (await r.json() as any).virtual_key
}
const stub = (vendor: () => Response = () => reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } }] })) => vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
  const url = String(input)
  if (url.startsWith(gateway!)) return fetchReal(input, init)
  if (url.endsWith('/oauth/userinfo')) return reply({ sub: user, email: user + '@example.com' })
  if (url === 'https://api.clerk.com/v1/users/' + user) return reply({ private_metadata: meta })
  if (url.endsWith('/metadata')) { meta = { ...meta, ...JSON.parse(String(init.body)).private_metadata }; return reply({}) }
  if (url.startsWith('https://generativelanguage.googleapis.com')) { vendorCalls++; return vendor() }
  throw new Error('Unexpected integration URL ' + url)
})
const as = () => ({ authorization: `Bearer ${meta.key}`, 'x-manul-key-id': meta.bifrost.virtual_key_id })

describe.skipIf(!gateway || !database)('accounts and the wallet with real Bifrost and Postgres', () => {
  beforeAll(async () => { wallet = await postgresWallet(database!, database!, { createTables: true }) })
  afterAll(async () => { await wallet?.close?.() })
  afterEach(() => vi.unstubAllGlobals())

  it('provisions a key whose non-resetting budget is what the starter credits buy', async () => {
    stub()
    const r = await handle(new Request('https://account.integration/v1/key', { method: 'POST', headers: { authorization: 'Bearer fake-clerk' } }), env, wallet)
    expect(r.status, await r.clone().text()).toBe(200)
    meta.key = (await r.json() as any).key
    const vk = await key(meta.bifrost.virtual_key_id)
    expect(vk.budgets[0]).toMatchObject({ max_limit: expect.closeTo(costForCredits(STARTER_CREDITS), 5), reset_duration: '100Y' })
    expect((await wallet.account(meta.wallet))!.available).toBe(STARTER_CREDITS)
  })

  it('two replicas syncing at once change nothing (the probe meters no spend)', async () => {
    const id = meta.bifrost.virtual_key_id
    await Promise.all([sync(env, wallet, id), sync(env, wallet, id)])
    expect((await wallet.account(meta.wallet))!.available).toBe(STARTER_CREDITS)
    expect((await key(id)).budgets[0].max_limit).toBeCloseTo(costForCredits(STARTER_CREDITS), 5)
  })

  it('takes voice off the wallet and gives it back when the vendor fails', async () => {
    stub()
    const before = (await wallet.account(meta.wallet))!.available
    const ok = await handle(new Request('https://account.integration/v1/voice', { method: 'POST', headers: as(), body: JSON.stringify({ text: 'Hello.' }) }), env, wallet)
    expect(ok.status).toBe(200)
    expect((await wallet.account(meta.wallet))!.available).toBe(before - 1)
    stub(() => reply({}, 503))
    const down = await handle(new Request('https://account.integration/v1/voice', { method: 'POST', headers: as(), body: JSON.stringify({ text: 'Hello.' }) }), env, wallet)
    expect(down.status).toBe(502)
    expect((await wallet.account(meta.wallet))!.available).toBe(before - 1)
    expect(vendorCalls).toBe(2)
  })

  it('blocks a disabled real key before contacting an audio vendor', async () => {
    stub()
    const id = meta.bifrost.virtual_key_id
    await fetchReal(`${gateway}/api/governance/virtual-keys/${id}`, { method: 'PUT', headers: { 'X-Bifrost-Setup-Token': setup, 'content-type': 'application/json' }, body: JSON.stringify({ is_active: false }) })
    const calls = vendorCalls
    const r = await handle(new Request('https://account.integration/v1/voice', { method: 'POST', headers: as(), body: JSON.stringify({ text: 'x' }) }), env, wallet)
    expect(r.status).toBe(403)
    expect(vendorCalls).toBe(calls)
  })
})
