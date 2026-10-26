// The wallet: the credits a person has, shared with Pitch (trypitch.co). Pitch's billing (its Dodo Payments business,
// its plans, its webhook that grants a plan's credits every cycle) is the one ledger for both products, so a Pitch
// subscriber signs in to AgentShot with the same email and finds their plan and credits there, and what they spend in either
// app comes off the same balance.
//
// The ledger is Pitch's Postgres: "UserProfile" (one per person), "Subscription" (written by Pitch's Dodo webhook) and
// "CreditTransaction" (every grant and every spend, each with a unique idempotency key). AgentShot only adds rows: a new
// profile for someone Pitch hasn't seen, a starter grant, and its own spends (keys starting `manul:`).
//
// The gateway (Bifrost) meters what an AgentShot key spends in dollars of model cost. Every so often (sync below) the dollars
// spent since the last look become credits taken off the ledger, and the key's budget is set to what it has used plus
// what the ledger says is left, so the gateway stops it when the credits run out.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Plan } from './plans.ts'

export type Subscription = { plan: string; status: string; credits_per_cycle: number; period_end: string; cancelled: boolean }
export type Charged = { userId: string; credits: number }
export type Account = { userId: string; email: string; available: number; subscription?: Subscription }
export type WorkerCapabilities = { platform?: string; arch?: string; gpu?: string; diskFree?: number; priority?: number; projects?: string[] }
export type WorkerRecord = {
  id: string
  ownerId?: string
  pool: boolean
  name: string
  urls: string[]
  fingerprint: string
  secret: string
  capabilities: WorkerCapabilities
  leasedTo?: string
  leasedUntil?: number
  /** When this person's current run of leases on it began (kept while they re-lease it before it lapses). */
  leasedSince?: number
  updatedAt: number
}

/** How long one person may keep a cloud spot in a row, however busy (so nobody holds one forever), and how long they
 *  wait after that before taking one again. */
export type LeaseLimits = { maxMs: number; cooldownMs: number }
export const LEASE_LIMITS: LeaseLimits = { maxMs: 8 * 60 * 60_000, cooldownMs: 30 * 60_000 }

/** Refused: this person used a cloud spot for the longest run allowed, and may take one again at [until]. */
export class LeaseCapped extends Error {
  // spelled out: the service runs this file as Node strips it, which has no parameter properties
  readonly until: number
  constructor(until: number) { super('lease capped'); this.until = until }
}

/** A lease that ran its longest allowed run ended exactly at [leasedSince] + max (going idle ends it sooner). */
const cappedUntil = (w: WorkerRecord, userId: string, limits: LeaseLimits, now: number) =>
  w.leasedTo === userId && w.leasedSince !== undefined && w.leasedUntil !== undefined && w.leasedUntil <= now &&
  w.leasedUntil >= w.leasedSince + limits.maxMs && w.leasedUntil + limits.cooldownMs > now
    ? w.leasedUntil + limits.cooldownMs
    : undefined

export interface Wallet {
  /** The person with this email (the oldest profile, Pitch's if they have one), made if there is none. */
  link(email: string, agentshotUser: string): Promise<string>
  account(userId: string): Promise<Account | undefined>
  /** Adds a ledger row once per key (a negative delta is a spend). False when the key was already used. */
  post(userId: string, delta: number, type: 'promo' | 'usage', description: string, key: string): Promise<boolean>
  /** Whose each AgentShot key is, and the credits charged so far for its gateway spend, so each dollar is charged once. */
  charged(keyId: string): Promise<Charged | undefined>
  setCharged(keyId: string, userId: string, credits: number): Promise<void>
  /** Every key with spend to look at. */
  keys(): Promise<string[]>
  /** One at a time per person, across replicas. */
  lock<T>(userId: string, run: () => Promise<T>): Promise<T>
  close?(): Promise<void>
  /** Registers or refreshes a worker. Undefined when [w.id] is another's: a different owner (or pool) may take an id
   *  over only by showing the same worker secret, i.e. being that same machine. */
  upsertWorker(w: Omit<WorkerRecord, 'updatedAt' | 'leasedTo' | 'leasedUntil' | 'leasedSince'>): Promise<WorkerRecord | undefined>
  workersFor(userId: string, now?: number): Promise<{ owned: WorkerRecord[]; leased: WorkerRecord[]; poolAvailable: number }>
  /** Throws LeaseCapped while this person waits after their longest allowed run. */
  leaseWorker(userId: string, opts?: { projectId?: string; workerId?: string; ttlMs?: number; now?: number; limits?: LeaseLimits }): Promise<WorkerRecord | undefined>
  releaseWorker(userId: string, workerId: string): Promise<boolean>
  /** Moves a lease's end to [until] while it is still [userId]'s and hasn't lapsed (a lapsed lease is never brought
   *  back). It may move earlier: a lease nobody uses runs out. The record after, or undefined when nothing changed. */
  extendLease(workerId: string, userId: string, until: number, now?: number, limits?: LeaseLimits): Promise<WorkerRecord | undefined>
}

/** The Pitch database. */
export async function postgresWallet(connectionString: string, agentshotDatabase?: string, { createTables = false } = {}): Promise<Wallet> {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000 })
  pool.on('error', e => console.error('wallet database:', e.message))
  if (createTables) await pool.query(PITCH_TABLES)
  // What AgentShot has charged per key lives with AgentShot, not in Pitch's schema.
  const own = agentshotDatabase ? new pg.Pool({ connectionString: agentshotDatabase, max: 3, connectionTimeoutMillis: 10_000 }) : pool
  if (own !== pool) own.on('error', e => console.error('account database:', e.message))
  await own.query(`CREATE TABLE IF NOT EXISTS manul_gateway_charges (
    key_id text PRIMARY KEY,
    user_id text NOT NULL,
    credits bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  await own.query(`CREATE TABLE IF NOT EXISTS manul_workers (
    id text PRIMARY KEY,
    owner_id text,
    pool boolean NOT NULL DEFAULT false,
    name text NOT NULL,
    urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    fingerprint text NOT NULL,
    secret text NOT NULL,
    capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
    leased_to text,
    leased_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  await own.query(`ALTER TABLE manul_workers ADD COLUMN IF NOT EXISTS leased_since timestamptz`)
  type WorkerRow = { id: string; owner_id: string | null; pool: boolean; name: string; urls: unknown; fingerprint: string; secret: string; capabilities: unknown; leased_to: string | null; leased_until: string | Date | null; leased_since?: string | Date | null; updated_at: string | Date }
  const rowToWorker = (r: WorkerRow): WorkerRecord => ({
    id: r.id,
    ownerId: r.owner_id ?? undefined,
    pool: !!r.pool,
    name: r.name,
    urls: Array.isArray(r.urls) ? r.urls : [],
    fingerprint: r.fingerprint,
    secret: r.secret,
    capabilities: r.capabilities && typeof r.capabilities === 'object' ? (r.capabilities as WorkerCapabilities) : {},
    leasedTo: r.leased_to ?? undefined,
    leasedUntil: r.leased_until ? new Date(r.leased_until).getTime() : undefined,
    leasedSince: r.leased_since ? new Date(r.leased_since).getTime() : undefined,
    updatedAt: new Date(r.updated_at).getTime(),
  })
  const wallet: Wallet = {
    async link(email, agentshotUser) {
      const found = await pool.query(`SELECT id FROM "UserProfile" WHERE lower(email) = lower($1) ORDER BY "createdAt" LIMIT 1`, [email])
      if (found.rows[0]) return found.rows[0].id
      // Pitch's profile ids are its Clerk user ids; AgentShot's are prefixed so the two can't collide.
      const id = 'manul_' + agentshotUser
      await pool.query(`INSERT INTO "UserProfile" (id, email, "updatedAt") VALUES ($1, $2, now()) ON CONFLICT (id) DO NOTHING`, [id, email])
      return id
    },
    async account(userId) {
      const [profile, balance, held, sub] = await Promise.all([
        pool.query(`SELECT email FROM "UserProfile" WHERE id = $1`, [userId]),
        // the same sum Pitch shows: everything but its Discord bot's daily allowance
        pool.query(`SELECT coalesce(sum(delta), 0)::bigint AS n FROM "CreditTransaction" WHERE "userId" = $1 AND channel <> 'discord'`, [userId]),
        pool.query(`SELECT coalesce(sum(credits), 0)::bigint AS n FROM "CreditReservation" WHERE "userId" = $1 AND status = 'pending'`, [userId]),
        pool.query(`SELECT "planKey", status, "creditsPerCycle", "currentPeriodEnd", "cancelledAt" FROM "Subscription"
          WHERE "userId" = $1 AND (status = 'active' OR (status = 'cancelled' AND "currentPeriodEnd" > now()))
          ORDER BY (status = 'active') DESC, "createdAt" DESC LIMIT 1`, [userId]),
      ])
      if (!profile.rows[0]) return undefined
      const s = sub.rows[0]
      return {
        userId, email: profile.rows[0].email,
        available: Number(balance.rows[0].n) - Number(held.rows[0].n),
        subscription: s && { plan: s.planKey, status: s.status, credits_per_cycle: s.creditsPerCycle, period_end: new Date(s.currentPeriodEnd).toISOString(), cancelled: !!s.cancelledAt },
      }
    },
    async post(userId, delta, type, description, key) {
      const r = await pool.query(`INSERT INTO "CreditTransaction" (id, "userId", delta, type, description, "idempotencyKey", channel)
        VALUES ($1, $2, $3, $4, $5, $6, 'product') ON CONFLICT ("idempotencyKey") DO NOTHING`, ['manul_' + randomUUID(), userId, delta, type, description, key])
      return r.rowCount === 1
    },
    async charged(keyId) {
      const r = await own.query('SELECT user_id, credits FROM manul_gateway_charges WHERE key_id = $1', [keyId])
      return r.rows[0] ? { userId: r.rows[0].user_id, credits: Number(r.rows[0].credits) } : undefined
    },
    async setCharged(keyId, userId, credits) {
      await own.query(`INSERT INTO manul_gateway_charges (key_id, user_id, credits) VALUES ($1, $2, $3)
        ON CONFLICT (key_id) DO UPDATE SET user_id = excluded.user_id, credits = excluded.credits, updated_at = now()`, [keyId, userId, credits])
    },
    async keys() { return (await own.query('SELECT key_id FROM manul_gateway_charges')).rows.map(r => r.key_id) },
    async lock(userId, run) {
      const client = await pool.connect()
      let broken = false
      try {
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['manul-wallet:' + userId])
        try { return await run() } finally {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['manul-wallet:' + userId]) } catch { broken = true }
        }
      } finally { client.release(broken) }
    },
    async upsertWorker(w) {
      const r = await own.query(
        `INSERT INTO manul_workers (id, owner_id, pool, name, urls, fingerprint, secret, capabilities, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, now())
         ON CONFLICT (id) DO UPDATE SET
           owner_id = excluded.owner_id,
           pool = excluded.pool,
           name = excluded.name,
           urls = excluded.urls,
           fingerprint = excluded.fingerprint,
           secret = excluded.secret,
           capabilities = excluded.capabilities,
           updated_at = now()
         WHERE manul_workers.secret = excluded.secret
            OR (manul_workers.pool = excluded.pool AND manul_workers.owner_id IS NOT DISTINCT FROM excluded.owner_id)
         RETURNING *`,
        [w.id, w.ownerId ?? null, w.pool, w.name, JSON.stringify(w.urls), w.fingerprint, w.secret, JSON.stringify(w.capabilities || {})],
      )
      return r.rows[0] ? rowToWorker(r.rows[0]) : undefined
    },
    async workersFor(userId, now = Date.now()) {
      const cutoff = new Date(now - 2 * 60_000).toISOString()
      const nowIso = new Date(now).toISOString()
      const r = await own.query(`SELECT * FROM manul_workers WHERE updated_at > $1 ORDER BY updated_at DESC`, [cutoff])
      const active = r.rows.map(rowToWorker)
      const owned = active.filter(w => !w.pool && w.ownerId === userId)
      const leased = active.filter(w => w.pool && w.leasedTo === userId && (w.leasedUntil ?? 0) > now)
      const poolAvailable = active.filter(w => w.pool && (!w.leasedTo || (w.leasedUntil ?? 0) <= now || w.leasedTo === userId)).length
      void nowIso
      return { owned, leased, poolAvailable }
    },
    async leaseWorker(userId, opts = {}) {
      return wallet.lock('worker-pool', async () => {
        const now = opts.now ?? Date.now()
        const ttl = opts.ttlMs ?? 60 * 60_000
        const cutoff = new Date(now - 2 * 60_000).toISOString()
        const limits = opts.limits ?? LEASE_LIMITS
        const mine = (await own.query(`SELECT * FROM manul_workers WHERE pool = true AND leased_to = $1`, [userId])).rows.map(rowToWorker)
        const wait = Math.max(0, ...mine.map(w => cappedUntil(w, userId, limits, now) ?? 0))
        if (wait) throw new LeaseCapped(wait)
        const r = await own.query(`SELECT * FROM manul_workers WHERE pool = true AND updated_at > $1`, [cutoff])
        const candidates = r.rows.map(rowToWorker).filter(w => !w.leasedTo || (w.leasedUntil ?? 0) <= now || w.leasedTo === userId)
        if (!candidates.length) return undefined
        candidates.sort((a, b) => scoreWorker(b, userId, opts.projectId, opts.workerId) - scoreWorker(a, userId, opts.projectId, opts.workerId))
        const picked = candidates[0]
        // still theirs (taken again before it lapsed): the same run goes on, and the same longest run applies
        const since = picked.leasedTo === userId && (picked.leasedUntil ?? 0) > now && picked.leasedSince ? picked.leasedSince : now
        const end = Math.min(now + ttl, since + limits.maxMs)
        const up = await own.query(`UPDATE manul_workers SET leased_to = $2, leased_until = $3, leased_since = $4 WHERE id = $1 RETURNING *`,
          [picked.id, userId, new Date(end).toISOString(), new Date(since).toISOString()])
        return up.rows[0] ? rowToWorker(up.rows[0]) : undefined
      })
    },
    async releaseWorker(userId, workerId) {
      const r = await own.query(`UPDATE manul_workers SET leased_to = NULL, leased_until = NULL, leased_since = NULL WHERE id = $1 AND leased_to = $2`, [workerId, userId])
      return r.rowCount === 1
    },
    async extendLease(workerId, userId, until, now = Date.now(), limits = LEASE_LIMITS) {
      // never past the longest run allowed since this person's run began
      const r = await own.query(
        `UPDATE manul_workers SET leased_until = LEAST($3::timestamptz, COALESCE(leased_since, $4::timestamptz) + make_interval(secs => $5::double precision))
         WHERE id = $1 AND leased_to = $2 AND leased_until > $4 RETURNING *`,
        [workerId, userId, new Date(until).toISOString(), new Date(now).toISOString(), limits.maxMs / 1000],
      )
      return r.rows[0] ? rowToWorker(r.rows[0]) : undefined
    },
    async close() { await pool.end(); if (own !== pool) await own.end() },
  }
  return wallet
}

/** The part of Pitch's schema (packages/db/prisma/schema.prisma) AgentShot reads and writes, for local runs and tests. */
export const PITCH_TABLES = `
CREATE TABLE IF NOT EXISTS "UserProfile" (id text PRIMARY KEY, email text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamp(3) NOT NULL);
CREATE TABLE IF NOT EXISTS "Subscription" (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "UserProfile"(id), "dodoSubscriptionId" text NOT NULL UNIQUE,
  "planKey" text NOT NULL, status text NOT NULL DEFAULT 'active', "creditsPerCycle" integer NOT NULL, "currentPeriodStart" timestamp(3) NOT NULL,
  "currentPeriodEnd" timestamp(3) NOT NULL, "cancelledAt" timestamp(3), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS "CreditTransaction" (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "UserProfile"(id), delta integer NOT NULL, type text NOT NULL,
  description text NOT NULL, "idempotencyKey" text UNIQUE, channel text NOT NULL DEFAULT 'product', "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS "CreditReservation" (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "UserProfile"(id), credits integer NOT NULL, status text NOT NULL DEFAULT 'pending');
`

/** Only for tests. */
export function memoryWallet() {
  const profiles = new Map<string, { email: string }>()
  const ledger: { userId: string; delta: number; type: string; description: string; key: string }[] = []
  const subscriptions = new Map<string, Subscription>()
  const charges = new Map<string, Charged>()
  const locks = new Map<string, Promise<unknown>>()
  const workers = new Map<string, WorkerRecord>()
  const wallet: Wallet & { ledger: typeof ledger; subscriptions: typeof subscriptions; profiles: typeof profiles; workers: typeof workers } = {
    ledger, subscriptions, profiles, workers,
    async link(email, agentshotUser) {
      for (const [id, p] of profiles) if (p.email.toLowerCase() === email.toLowerCase()) return id
      const id = 'manul_' + agentshotUser
      profiles.set(id, { email })
      return id
    },
    async account(userId) {
      const p = profiles.get(userId)
      if (!p) return undefined
      return { userId, email: p.email, available: ledger.filter(r => r.userId === userId).reduce((a, r) => a + r.delta, 0), subscription: subscriptions.get(userId) }
    },
    async post(userId, delta, type, description, key) {
      if (ledger.some(r => r.key === key)) return false
      ledger.push({ userId, delta, type, description, key })
      return true
    },
    async charged(keyId) { return charges.get(keyId) },
    async setCharged(keyId, userId, credits) { charges.set(keyId, { userId, credits }) },
    async keys() { return [...charges.keys()] },
    async lock(userId, run) {
      const next = (locks.get(userId) || Promise.resolve()).catch(() => {}).then(run)
      locks.set(userId, next)
      try { return await next } finally { if (locks.get(userId) === next) locks.delete(userId) }
    },
    async upsertWorker(w) {
      const prev = workers.get(w.id)
      if (prev && prev.secret !== w.secret && (prev.pool !== w.pool || prev.ownerId !== w.ownerId)) return undefined
      const rec: WorkerRecord = { ...w, leasedTo: prev?.leasedTo, leasedUntil: prev?.leasedUntil, leasedSince: prev?.leasedSince, updatedAt: Date.now() }
      workers.set(w.id, rec)
      return rec
    },
    async workersFor(userId, now = Date.now()) {
      const active = [...workers.values()].filter(w => w.updatedAt > now - 2 * 60_000)
      const owned = active.filter(w => !w.pool && w.ownerId === userId)
      const leased = active.filter(w => w.pool && w.leasedTo === userId && (w.leasedUntil ?? 0) > now)
      const poolAvailable = active.filter(w => w.pool && (!w.leasedTo || (w.leasedUntil ?? 0) <= now || w.leasedTo === userId)).length
      return { owned, leased, poolAvailable }
    },
    async leaseWorker(userId, opts = {}) {
      return this.lock('worker-pool', async () => {
        const now = opts.now ?? Date.now()
        const ttl = opts.ttlMs ?? 60 * 60_000
        const limits = opts.limits ?? LEASE_LIMITS
        const wait = Math.max(0, ...[...workers.values()].filter(w => w.pool).map(w => cappedUntil(w, userId, limits, now) ?? 0))
        if (wait) throw new LeaseCapped(wait)
        const candidates = [...workers.values()].filter(w => w.pool && w.updatedAt > now - 2 * 60_000 && (!w.leasedTo || (w.leasedUntil ?? 0) <= now || w.leasedTo === userId))
        if (!candidates.length) return undefined
        candidates.sort((a, b) => scoreWorker(b, userId, opts.projectId, opts.workerId) - scoreWorker(a, userId, opts.projectId, opts.workerId))
        const picked = candidates[0]
        const since = picked.leasedTo === userId && (picked.leasedUntil ?? 0) > now && picked.leasedSince ? picked.leasedSince : now
        picked.leasedTo = userId
        picked.leasedSince = since
        picked.leasedUntil = Math.min(now + ttl, since + limits.maxMs)
        return { ...picked }
      })
    },
    async releaseWorker(userId, workerId) {
      const w = workers.get(workerId)
      if (!w || w.leasedTo !== userId) return false
      w.leasedTo = undefined
      w.leasedUntil = undefined
      w.leasedSince = undefined
      return true
    },
    async extendLease(workerId, userId, until, now = Date.now(), limits = LEASE_LIMITS) {
      const w = workers.get(workerId)
      if (!w || w.leasedTo !== userId || (w.leasedUntil ?? 0) <= now) return undefined
      w.leasedUntil = Math.min(until, (w.leasedSince ?? now) + limits.maxMs)
      return { ...w }
    },
  }
  return wallet
}

/** Whether a plan is on: an active subscription, or a cancelled one still inside the period it paid for. */
export const planOf = (a: Account | undefined, plans: Record<string, Plan>) => {
  const key = a?.subscription?.plan
  return key ? plans[key.replace(/_annual$/, '')] : undefined
}

function scoreWorker(w: WorkerRecord, userId: string, projectId?: string, workerId?: string): number {
  let s = (w.capabilities.priority ?? 0) * 10
  if (workerId && w.id === workerId) s += 1000
  if (w.leasedTo === userId) s += 500
  if (projectId && w.capabilities.projects?.includes(projectId)) s += 200
  if (w.capabilities.gpu) s += 20
  return s
}
