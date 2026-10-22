// Production smoke test for accounts and the wallet, run inside the cluster (gateway/k8s/e2e.sh): a throwaway person
// with a Manul key, a real request on every model tier, the spend coming off Pitch's ledger, a plan unlocking Max and
// Ultra, and a live Dodo checkout link (made, never paid). Everything it makes is removed at the end.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { sync } from '../account/src/index.ts'
import { STARTER_CREDITS, TIERS } from '../account/src/plans.ts'
import { postgresWallet } from '../account/src/wallet.ts'

const env = process.env
const ACCOUNT = 'http://account:8080', GATEWAY = 'http://bifrost:8080'
const email = `e2e-${Date.now()}@manul.si`, sub = 'e2e_' + Date.now()
const manulDb = `postgresql://${encodeURIComponent(env.PG_USER)}:${encodeURIComponent(env.PG_PASSWORD)}@${env.PG_HOST}:5432/bifrost?sslmode=require&uselibpqcompat=true`
const wallet = await postgresWallet(env.WALLET_DATABASE_URL, manulDb)
const pitch = new pg.Pool({ connectionString: env.WALLET_DATABASE_URL, max: 2 })
const admin = (path, init = {}) => fetch(`${GATEWAY}/api/governance${path}`, { ...init, headers: { authorization: env.BIFROST_AUTH, 'content-type': 'application/json' } })
let failed = 0
const check = (ok, what, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? ` (${detail})` : ''}`); if (!ok) failed++ }
const available = async userId => (await wallet.account(userId)).available

let userId, keyId, customerId
try {
  userId = await wallet.link(email, sub)
  await wallet.post(userId, STARTER_CREDITS, 'promo', 'Manul starter credits', `manul:starter:${userId}`)
  const c = await (await admin('/customers', { method: 'POST', body: JSON.stringify({ name: email }) })).json()
  customerId = c.customer.id
  const v = await (await admin('/virtual-keys', { method: 'POST', body: JSON.stringify({ name: sub, description: email, customer_id: customerId, is_active: true, budgets: [{ max_limit: 0.000001, reset_duration: '100Y' }], rate_limit: { request_max_limit: 300, request_reset_duration: '1h' } }) })).json()
  keyId = v.virtual_key.id
  const key = v.virtual_key.value
  await sync(env, wallet, keyId, userId)
  const as = { authorization: `Bearer ${key}`, 'x-manul-key-id': keyId }

  const b = await (await fetch(`${ACCOUNT}/v1/balance`, { headers: as })).json()
  check(b.credits === STARTER_CREDITS && b.plan === null, 'balance: starter credits, no plan', `${b.credits} credits`)
  check(b.plans?.every(p => p.buyable) && b.topups?.every(p => p.buyable), 'every plan and top-up has a live product')
  check(b.discount?.percent === 50, 'launch offer shown', JSON.stringify(b.discount))

  const ask = model => fetch(`${GATEWAY}/v1/chat/completions`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Write a 300-word note on editing a product video.' }], max_tokens: 4000 }) })
  const usage = async () => (await (await admin(`/virtual-keys/${keyId}`)).json()).virtual_key.budgets[0].current_usage
  const run = async (tier, expectOk) => {
    const before = await usage()
    const r = await ask(`manul-${tier}`)
    const text = await r.text()
    // the gateway records the cost a moment after replying
    let cost = 0
    for (let i = 0; i < 20 && r.ok && !(cost > 0); i++) { await new Promise(res => setTimeout(res, 500)); cost = (await usage()) - before }
    if (expectOk) check(r.ok && cost > 0, `manul-${tier} answers and costs something`, r.ok ? `$${cost.toFixed(6)}` : `${r.status} ${text.slice(0, 200)}`)
    else check(!r.ok, `manul-${tier} refused without a plan`, `${r.status} ${text.slice(0, 200)}`)
  }
  for (const t of TIERS) await run(t.tier, !t.paid)

  const before = await available(userId)
  await sync(env, wallet, keyId, userId)
  const after = await available(userId)
  check(after < before, 'gateway spend came off the wallet', `${before} → ${after} credits`)

  // a plan: as Pitch's webhook would record it
  await pitch.query(`INSERT INTO "Subscription" (id, "userId", "dodoSubscriptionId", "planKey", status, "creditsPerCycle", "currentPeriodStart", "currentPeriodEnd", "updatedAt")
    VALUES ($1, $2, $3, 'pro', 'active', 10000, now(), now() + interval '30 days', now())`, ['e2e_' + randomUUID(), userId, 'e2e_' + randomUUID()])
  await sync(env, wallet, keyId, userId)
  for (const t of TIERS.filter(t => t.paid)) await run(t.tier, true)
  const planned = await (await fetch(`${ACCOUNT}/v1/balance`, { headers: as })).json()
  check(planned.plan?.key === 'pro' && planned.tiers.every(t => t.available), 'balance: Pro, every tier')
  const dup = await fetch(`${ACCOUNT}/v1/checkout`, { method: 'POST', headers: as, body: '{"plan":"max"}' })
  check(dup.status === 409, 'a second plan is refused')
  const flex = await (await fetch(`${ACCOUNT}/v1/checkout`, { method: 'POST', headers: as, body: '{"topup":"flex"}' })).json()
  check(/^https:\/\/.*dodopayments/.test(flex.url || ''), 'Flex top-up gets a live Dodo checkout', flex.url ? new URL(flex.url).host : JSON.stringify(flex))
} catch (e) {
  check(false, 'smoke test ran', e.stack)
} finally {
  // remove all of it: the key, the customer, the person's rows in Pitch, the key's charge row
  if (keyId) await admin(`/virtual-keys/${keyId}`, { method: 'DELETE' })
  if (customerId) await admin(`/customers/${customerId}`, { method: 'DELETE' })
  if (userId) {
    await pitch.query(`DELETE FROM "CreditTransaction" WHERE "userId" = $1`, [userId])
    await pitch.query(`DELETE FROM "Subscription" WHERE "userId" = $1`, [userId])
    await pitch.query(`DELETE FROM "UserProfile" WHERE id = $1`, [userId])
  }
  const own = new pg.Pool({ connectionString: manulDb, max: 1 })
  if (keyId) await own.query('DELETE FROM manul_gateway_charges WHERE key_id = $1', [keyId])
  await own.end(); await pitch.end(); await wallet.close()
  console.log(failed ? `${failed} failed` : 'all passed')
  process.exit(failed ? 1 : 0)
}
