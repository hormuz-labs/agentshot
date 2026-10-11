// Persist the intended budget before touching Bifrost. An ambiguous HTTP failure is retried as
// an absolute PUT of that same target, never as a second increment. Session advisory locks
// serialize payments and media charges across account-service replicas.
import pg from 'pg'

export type Budget = { id: string; max_limit: number; current_usage?: number; reset_duration: string }
export type Operation = { id: string; keyId: string; delta: number; budget: Budget; applied: boolean }
export interface Journal {
  get(id: string): Promise<Operation | undefined>
  pending(): Promise<Operation[]>
  save(op: Operation): Promise<void>
  applied(id: string): Promise<void>
}
export interface CreditStore {
  lock<T>(keyId: string, run: (journal: Journal) => Promise<T>): Promise<T>
  close?(): Promise<void>
}

export async function reconcile(journal: Journal, put: (budget: Budget) => Promise<void>) {
  for (const op of await journal.pending()) {
    await put(op.budget)
    await journal.applied(op.id)
  }
}

export async function changeCredit(journal: Journal, id: string, keyId: string, delta: number, budget: Budget, put: (budget: Budget) => Promise<void>) {
  const old = await journal.get(id)
  if (old && (old.keyId !== keyId || old.delta !== delta)) throw new Error('Credit operation does not match its original payment.')
  if (old?.applied) return false
  const op = old || { id, keyId, delta, budget: { id: budget.id, reset_duration: budget.reset_duration, max_limit: Math.round((budget.max_limit + delta) * 10000) / 10000 }, applied: false }
  // This write must commit before the HTTP call: rolling it back on a timeout loses retry identity.
  if (!old) await journal.save(op)
  await put(op.budget)
  await journal.applied(id)
  return !old
}

/** Only for isolated tests. The server always supplies a persistent Postgres store. */
export function memoryCreditStore(): CreditStore {
  const operations = new Map<string, Operation>()
  const locks = new Map<string, Promise<unknown>>()
  return {
    async lock(keyId, run) {
      const previous = locks.get(keyId) || Promise.resolve()
      const next = previous.catch(() => {}).then(() => run({
        get: async id => operations.get(id),
        pending: async () => [...operations.values()].filter(o => o.keyId === keyId && !o.applied),
        save: async op => { if (operations.has(op.id)) throw new Error('Duplicate credit operation'); operations.set(op.id, structuredClone(op)) },
        applied: async id => { operations.get(id)!.applied = true },
      }))
      locks.set(keyId, next)
      try { return await next } finally { if (locks.get(keyId) === next) locks.delete(keyId) }
    },
  }
}

export async function postgresCreditStore(connectionString: string): Promise<CreditStore> {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000 })
  pool.on('error', e => console.error('credit database:', e.message))
  await pool.query(`CREATE TABLE IF NOT EXISTS manul_credit_operations (
    id text PRIMARY KEY,
    key_id text NOT NULL,
    delta numeric(20,4) NOT NULL,
    budget jsonb NOT NULL,
    applied boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`)
  await pool.query('CREATE INDEX IF NOT EXISTS manul_credit_pending ON manul_credit_operations (key_id) WHERE NOT applied')
  const decode = (r: any): Operation => ({ id: r.id, keyId: r.key_id, delta: Number(r.delta), budget: r.budget, applied: r.applied })
  return {
    async lock(keyId, run) {
      const client = await pool.connect()
      let locked = false, broken = false
      try {
        // Hold one connection for the session lock; journal writes remain committed across HTTP failures.
        await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', ['manul-credit:' + keyId])
        locked = true
        return await run({
          get: async id => { const r = await client.query('SELECT * FROM manul_credit_operations WHERE id = $1', [id]); return r.rows[0] && decode(r.rows[0]) },
          pending: async () => (await client.query('SELECT * FROM manul_credit_operations WHERE key_id = $1 AND NOT applied ORDER BY created_at, id', [keyId])).rows.map(decode),
          save: async op => { await client.query('INSERT INTO manul_credit_operations (id, key_id, delta, budget) VALUES ($1, $2, $3, $4)', [op.id, op.keyId, op.delta, JSON.stringify(op.budget)]) },
          applied: async id => { await client.query('UPDATE manul_credit_operations SET applied = true WHERE id = $1', [id]) },
        })
      } finally {
        if (locked) {
          try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', ['manul-credit:' + keyId]) } catch { broken = true }
        }
        client.release(broken) // Never return a connection with an uncertain lock state to the pool.
      }
    },
    close: () => pool.end(),
  }
}
