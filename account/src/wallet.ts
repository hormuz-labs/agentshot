// The wallet: the credits a person has, shared with Pitch (trypitch.co). Pitch's billing (its Dodo Payments business,
// its plans, its webhook that grants a plan's credits every cycle) is the one ledger for both products, so a Pitch
// subscriber signs in to Manul with the same email and finds their plan and credits there, and what they spend in either
// app comes off the same balance.
//
// The ledger is Pitch's Postgres: "UserProfile" (one per person), "Subscription" (written by Pitch's Dodo webhook) and
// "CreditTransaction" (every grant and every spend, each with a unique idempotency key). Manul only adds rows: a new
// profile for someone Pitch hasn't seen, a starter grant, and its own spends (keys starting `manul:`).
//
// The gateway (Bifrost) meters what a Manul key spends in dollars of model cost. Every so often (sync below) the dollars
// spent since the last look become credits taken off the ledger, and the key's budget is set to what it has used plus
// what the ledger says is left, so the gateway stops it when the credits run out.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import type { Plan } from './plans.ts'

export type Subscription = { plan: string; status: string; credits_per_cycle: number; period_end: string; cancelled: boolean }
export type Charged = { userId: string; credits: number }
export type Account = { userId: string; email: string; available: number; subscription?: Subscription }

export interface Wallet {
  /** The person with this email (the oldest profile, Pitch's if they have one), made if there is none. */
  link(email: string, manulUser: string): Promise<string>
  account(userId: string): Promise<Account | undefined>
  /** Adds a ledger row once per key (a negative delta is a spend). False when the key was already used. */
  post(userId: string, delta: number, type: 'promo' | 'usage', description: string, key: string): Promise<boolean>
  /** Whose each Manul key is, and the credits charged so far for its gateway spend, so each dollar is charged once. */
  charged(keyId: string): Promise<Charged | undefined>
  setCharged(keyId: string, userId: string, credits: number): Promise<void>
  /** Every key with spend to look at. */
  keys(): Promise<string[]>
  /** One at a time per person, across replicas. */
  lock<T>(userId: string, run: () => Promise<T>): Promise<T>
  close?(): Promise<void>
}

/** The Pitch database. */
export async function postgresWallet(connectionString: string, manulDatabase?: string, { createTables = false } = {}): Promise<Wallet> {
  const pool = new pg.Pool({ connectionString, max: 5, connectionTimeoutMillis: 10_000 })
  pool.on('error', e => console.error('wallet database:', e.message))
  if (createTables) await pool.query(PITCH_TABLES)
  // What Manul has charged per key lives with Manul, not in Pitch's schema.
  const own = manulDatabase ? new pg.Pool({ connectionString: manulDatabase, max: 3, connectionTimeoutMillis: 10_000 }) : pool
  if (own !== pool) own.on('error', e => console.error('account database:', e.message))
  await own.query(`CREATE TABLE IF NOT EXISTS manul_gateway_charges (
    key_id text PRIMARY KEY,
    user_id text NOT NULL,
    credits bigint NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  )`)
  return {
    async link(email, manulUser) {
      const found = await pool.query(`SELECT id FROM "UserProfile" WHERE lower(email) = lower($1) ORDER BY "createdAt" LIMIT 1`, [email])
      if (found.rows[0]) return found.rows[0].id
      // Pitch's profile ids are its Clerk user ids; Manul's are prefixed so the two can't collide.
      const id = 'manul_' + manulUser
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
    async close() { await pool.end(); if (own !== pool) await own.end() },
  }
}

/** The part of Pitch's schema (packages/db/prisma/schema.prisma) Manul reads and writes, for local runs and tests. */
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
  const wallet: Wallet & { ledger: typeof ledger; subscriptions: typeof subscriptions; profiles: typeof profiles } = {
    ledger, subscriptions, profiles,
    async link(email, manulUser) {
      for (const [id, p] of profiles) if (p.email.toLowerCase() === email.toLowerCase()) return id
      const id = 'manul_' + manulUser
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
  }
  return wallet
}

/** Whether a plan is on: an active subscription, or a cancelled one still inside the period it paid for. */
export const planOf = (a: Account | undefined, plans: Record<string, Plan>) => {
  const key = a?.subscription?.plan
  return key ? plans[key.replace(/_annual$/, '')] : undefined
}
