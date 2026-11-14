// The cloud jobs endpoints on a real Postgres (the wallet's tables made the way local runs make them), with a fake
// gateway and Clerk: the locking and the SQL are what this is for. Run with a disposable database:
//   ACCOUNT_TEST_DATABASE_URL=postgres://… npx vitest run test/account-jobs.integration.test.ts
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, type Env } from '../account/src/index'
import { postgresWallet, type Wallet } from '../account/src/wallet'

const database = process.env.ACCOUNT_TEST_DATABASE_URL
const secret = 'jobs_secret_pg'
const env: Env = { CLERK_ISSUER: 'https://clerk.integration', CLERK_SECRET_KEY: 'fake', BIFROST_URL: 'https://gw.integration', BIFROST_AUTH: 'Basic x', WORKER_JOBS_SECRET: secret }
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const run = Date.now()
let wallet: Wallet
let n = 0
let keys: Record<string, any> = {}

/** A person with 1000 credits and a key of their own. */
async function person() {
  const mine = ++n
  const id = `${run}_${mine}`
  const userId = await wallet.link(`jobs_${id}@example.com`, `user_${id}`)
  await wallet.post(userId, 1000, 'promo', 'starter', `test:starter:${userId}`)
  const keyId = `vk_${id}`
  keys[keyId] = { id: keyId, name: `user_${id}`, description: `jobs_${id}@example.com`, value: `sk-bf-${id}`, is_active: true, provider_configs: [], budgets: [{ id: 'b0', max_limit: 2.5, current_usage: 0, reset_duration: '100Y' }] }
  await wallet.setCharged(keyId, userId, 0)
  const headers = { authorization: `Bearer sk-bf-${id}`, 'x-manul-key-id': keyId, 'x-agentshot-worker': secret, 'content-type': 'application/json' }
  return {
    userId,
    job: `manul:job:${run}-${mine}`,
    left: async () => (await wallet.account(userId))!.available,
    charge: (operation: string, credits: number) => handle(new Request('https://account.integration/v1/worker/charge', { method: 'POST', headers, body: JSON.stringify({ operation, credits, label: 'AgentShot: upscale to 4K' }) }), env, wallet),
    refund: (operation: string, who = userId) => handle(new Request('https://account.integration/v1/worker/refund', { method: 'POST', headers: { 'x-agentshot-worker': secret, 'content-type': 'application/json' }, body: JSON.stringify({ userId: who, operation }) }), env, wallet),
    who: () => handle(new Request('https://account.integration/v1/worker/who', { headers }), env, wallet),
  }
}

describe.skipIf(!database)('cloud job charges on real Postgres', () => {
  beforeAll(async () => { wallet = await postgresWallet(database!, database!, { createTables: true }) })
  afterAll(async () => { await wallet?.close?.() })
  beforeEach(() => {
    vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
      const id = /^https:\/\/gw\.integration\/api\/governance\/virtual-keys\/(.+)$/.exec(String(input))?.[1]
      if (!id) throw new Error('Unexpected URL ' + input)
      if (!keys[id]) return reply({ error: 'not found' }, 404)
      if (init.method === 'PUT') {
        const body = JSON.parse(String(init.body))
        for (const b of body.budgets) Object.assign(keys[id].budgets.find((x: any) => x.id === b.id), b)
        if (body.provider_configs) keys[id].provider_configs = body.provider_configs
      }
      return reply({ virtual_key: keys[id] })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('finds a ledger row by its name, and keeps the first word on a charge called off', async () => {
    const p = await person()
    expect(await wallet.posted(p.job)).toBeUndefined()
    await wallet.post(p.userId, -40, 'usage', 'a job', p.job)
    expect(await wallet.posted(p.job)).toEqual({ userId: p.userId, delta: -40 })
    expect(await wallet.voided(p.job)).toBeUndefined()
    await wallet.setVoided(p.job, p.userId, 40)
    await wallet.setVoided(p.job, 'someone_else', 0)
    expect(await wallet.voided(p.job)).toEqual({ userId: p.userId, refunded: 40 })
  })

  it('says who a key belongs to and what they have', async () => {
    const p = await person()
    const r = await p.who()
    expect(r.status, await r.clone().text()).toBe(200)
    expect(await r.json()).toMatchObject({ userId: p.userId, credits: 1000 })
  })

  it('takes a charge once and gives it back once', async () => {
    const p = await person()
    const r = await p.charge(p.job, 150)
    expect(r.status, await r.clone().text()).toBe(200)
    expect(await r.json()).toEqual({ charged: 150 })
    expect(await (await p.charge(p.job, 150)).json()).toEqual({ charged: 150 })
    expect(await p.left()).toBe(850)
    expect(await (await p.refund(p.job)).json()).toEqual({ refunded: 150 })
    expect(await (await p.refund(p.job)).json()).toEqual({ refunded: 150 })
    expect(await p.left()).toBe(1000)
    expect((await p.charge(p.job, 150)).status).toBe(409)
    expect(await p.left()).toBe(1000)
    expect(await wallet.posted(`${p.job}:refund`)).toEqual({ userId: p.userId, delta: 150 })
  })

  it('charges at once can’t spend the same credits, and one charge asked many times at once is taken once', async () => {
    const p = await person()
    const racing = await Promise.all(['a', 'b', 'c', 'd'].map(x => p.charge(`${p.job}-${x}`, 400)))
    expect(racing.map(r => r.status).sort()).toEqual([200, 200, 402, 402])
    expect(await p.left()).toBe(200)
    const same = await Promise.all([1, 2, 3, 4, 5].map(() => p.charge(`${p.job}-e`, 200)))
    expect(same.map(r => r.status)).toEqual([200, 200, 200, 200, 200])
    expect(await p.left()).toBe(0)
  })

  it('a refund and its charge racing each other never leave the person out of pocket', async () => {
    for (let i = 0; i < 20; i++) {
      const p = await person()
      const [c, r] = await Promise.all([p.charge(p.job, 150), p.refund(p.job)])
      const refunded = (await r.json() as any).refunded
      // either the charge got in first and came straight back, or it was called off before it could be taken
      if (c.status === 200 && refunded === 0) {
        // the refund ran first… which must mean the charge was refused, so this can't happen
        throw new Error('a charge was taken after it had been called off')
      }
      expect([200, 409]).toContain(c.status)
      expect(await (await p.refund(p.job)).json()).toEqual({ refunded })
      expect(await p.left()).toBe(1000)
    }
  })

  it('many people at once don’t hold each other up, however many are waiting on a lock', async () => {
    // more at once than the wallet has connections: each needs a lock and then connections for its own work
    const people = await Promise.all(Array.from({ length: 12 }, () => person()))
    const started = Date.now()
    const answers = await Promise.all(people.flatMap(p => [p.charge(p.job, 100), p.charge(`${p.job}-b`, 100), p.who()]))
    expect(answers.map(r => r.status)).toEqual(answers.map(() => 200))
    expect(Date.now() - started).toBeLessThan(8000)
    for (const p of people) expect(await p.left()).toBe(800)
    // and one person asking a great deal at once
    const p = people[0]
    const burst = await Promise.all(Array.from({ length: 20 }, (_, i) => p.charge(`${p.job}-burst-${i}`, 10)))
    expect(burst.map(r => r.status)).toEqual(burst.map(() => 200))
    expect(await p.left()).toBe(600)
  })

  it('returns nothing for a charge never taken, then never takes it', async () => {
    const p = await person()
    expect(await (await p.refund(p.job)).json()).toEqual({ refunded: 0 })
    expect((await p.charge(p.job, 150)).status).toBe(409)
    expect(await p.left()).toBe(1000)
  })

  it('gives nothing to someone the charge wasn’t taken from', async () => {
    const [p, other] = [await person(), await person()]
    await p.charge(p.job, 150)
    expect((await p.refund(p.job, other.userId)).status).toBe(400)
    expect(await other.left()).toBe(1000)
    expect(await p.left()).toBe(850)
    expect(await (await p.refund(p.job)).json()).toEqual({ refunded: 150 })
  })
})
