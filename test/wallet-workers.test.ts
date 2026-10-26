// The worker pool in the wallet, the same for both kinds: in memory (tests, local runs) and Postgres (production),
// when ACCOUNT_TEST_DATABASE_URL points at a disposable database.
import { afterAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import { LeaseCapped, memoryWallet, postgresWallet, type LeaseLimits, type Wallet } from '../account/src/wallet'

const database = process.env.ACCOUNT_TEST_DATABASE_URL
const kinds: [string, () => Promise<Wallet & { close?: () => Promise<void> }>][] = [['in memory', async () => memoryWallet()]]
if (database) kinds.push(['in Postgres', async () => {
  const w = await postgresWallet(database, undefined, { createTables: true })
  // a clean pool for each test: nothing left over from the last one competes for the lease
  const db = new pg.Client({ connectionString: database })
  await db.connect(); await db.query('DELETE FROM manul_workers'); await db.end()
  return w
}])
const open: { close?: () => Promise<void> }[] = []
afterAll(async () => { for (const w of open) await w.close?.() })

const fp = 'a'.repeat(64)
let n = 0
const worker = (over: Partial<Parameters<Wallet['upsertWorker']>[0]> = {}) => ({
  id: `w-${process.pid}-${++n}`, pool: true, name: 'Cloud', urls: ['https://100.64.0.9:47821'], fingerprint: fp, secret: 's'.repeat(48), capabilities: {}, ...over,
})
const limits: LeaseLimits = { maxMs: 8 * 60 * 60_000, cooldownMs: 30 * 60_000 }

describe.each(kinds)('the worker pool, %s', (_, make) => {
  const wallet = async () => { const w = await make(); open.push(w); return w }

  it('keeps an id to the machine that has it: another owner, or a pool, takes it over only with its secret', async () => {
    const w = await wallet()
    const cloud = worker()
    expect(await w.upsertWorker(cloud)).toMatchObject({ id: cloud.id, pool: true })
    // a signed-in computer claiming the cloud worker's id, with its own secret: refused, the record untouched
    expect(await w.upsertWorker({ ...cloud, pool: false, ownerId: 'user_mallory', secret: 'm'.repeat(48), urls: ['https://evil:1'] })).toBeUndefined()
    const mine = worker({ pool: false, ownerId: 'user_maya' })
    await w.upsertWorker(mine)
    expect(await w.upsertWorker({ ...mine, ownerId: 'user_mallory', secret: 'm'.repeat(48) })).toBeUndefined()
    // the same machine, signed in to another account (it shows its own secret): fine
    expect(await w.upsertWorker({ ...mine, ownerId: 'user_sam' })).toMatchObject({ ownerId: 'user_sam' })
    // the same owner with a fresh secret (its state was reset): fine
    expect(await w.upsertWorker({ ...mine, ownerId: 'user_sam', secret: 'n'.repeat(48) })).toMatchObject({ secret: 'n'.repeat(48) })
    // and the cloud worker is still the pool's, with its own addresses
    const { leased } = await w.workersFor('user_any')
    expect(leased).toEqual([])
    const lent = await w.leaseWorker('user_any', { workerId: cloud.id, ttlMs: 15 * 60_000, limits })
    expect(lent?.urls).toEqual(cloud.urls)
  })

  // the pool only lends workers heard from in the last 2 minutes, so these runs are scaled down to fit in that window
  const S = 1000, short: LeaseLimits = { maxMs: 60 * S, cooldownMs: 30 * S }

  it('extends a lease only while it is still that person\'s, never past the longest run, and never revives it', async () => {
    const w = await wallet()
    const t = Date.now()
    const cloud = worker()
    await w.upsertWorker(cloud)
    const lent = await w.leaseWorker('user_maya', { workerId: cloud.id, ttlMs: 15 * S, now: t, limits: short })
    expect(lent!.leasedUntil).toBe(t + 15 * S)
    expect(await w.extendLease(cloud.id, 'user_sam', t + 30 * S, t, short)).toBeUndefined()
    expect((await w.extendLease(cloud.id, 'user_maya', t + 30 * S, t + S, short))!.leasedUntil).toBe(t + 30 * S)
    // busy all along: it stops at the longest run from when the run began
    expect((await w.extendLease(cloud.id, 'user_maya', t + 500 * S, t + 20 * S, short))!.leasedUntil).toBe(t + 60 * S)
    // lapsed: nothing brings it back
    expect(await w.extendLease(cloud.id, 'user_maya', t + 500 * S, t + 60 * S + 1, short)).toBeUndefined()
  })

  it('after the longest run, makes that person wait before taking a spot again; going idle or giving it back doesn\'t', async () => {
    const w = await wallet()
    const t = Date.now()
    const a = worker(), b = worker()
    await w.upsertWorker(a); await w.upsertWorker(b)
    await w.leaseWorker('user_maya', { workerId: a.id, ttlMs: 15 * S, now: t, limits: short })
    // taken again before it lapsed (the phone reconnecting): the same worker and the same run
    const again = await w.leaseWorker('user_maya', { ttlMs: 15 * S, now: t + 10 * S, limits: short })
    expect(again!.id).toBe(a.id)
    expect(again!.leasedSince).toBe(t)
    await w.extendLease(a.id, 'user_maya', t + 500 * S, t + 20 * S, short)
    // the longest run is over: refused on any worker until the wait is over
    await expect(w.leaseWorker('user_maya', { ttlMs: 15 * S, now: t + 61 * S, limits: short })).rejects.toBeInstanceOf(LeaseCapped)
    await expect(w.leaseWorker('user_maya', { ttlMs: 15 * S, now: t + 61 * S, limits: short })).rejects.toMatchObject({ until: t + 90 * S })
    // somebody else is welcome meanwhile
    expect(await w.leaseWorker('user_sam', { workerId: b.id, ttlMs: 15 * S, now: t + 62 * S, limits: short })).toBeTruthy()
    // after the wait, Maya again
    expect((await w.leaseWorker('user_maya', { ttlMs: 15 * S, now: t + 91 * S, limits: short }))!.id).toBe(a.id)
  })

  it('never makes anyone wait for a lease that went idle or was given back', async () => {
    const w = await wallet()
    const t = Date.now()
    const c = worker()
    await w.upsertWorker(c)
    await w.leaseWorker('user_lea', { workerId: c.id, ttlMs: 15 * S, now: t, limits: short })
    expect(await w.leaseWorker('user_lea', { workerId: c.id, ttlMs: 15 * S, now: t + 16 * S, limits: short })).toBeTruthy()
    expect(await w.releaseWorker('user_lea', c.id)).toBe(true)
    expect(await w.leaseWorker('user_lea', { workerId: c.id, ttlMs: 15 * S, now: t + 17 * S, limits: short })).toBeTruthy()
  })
})
