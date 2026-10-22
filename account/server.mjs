// The account service as a plain Node server (Node 24 runs index.ts as it is), in Kubernetes next to the gateway;
// its settings come from the environment (gateway/k8s/manul.yaml).
import { createServer } from 'node:http'
import { handle, syncAll } from './src/index.ts'
import { postgresWallet } from './src/wallet.ts'

const database = process.env.ACCOUNT_DATABASE_URL || (process.env.PG_HOST
  ? `postgresql://${encodeURIComponent(process.env.PG_USER || '')}:${encodeURIComponent(process.env.PG_PASSWORD || '')}@${process.env.PG_HOST}:5432/bifrost?sslmode=require&uselibpqcompat=true`
  : '')
if (!database) throw new Error('Set ACCOUNT_DATABASE_URL for what each key was charged (see gateway/.env.example).')
if (!process.env.WALLET_DATABASE_URL) throw new Error('Set WALLET_DATABASE_URL to the wallet (Pitch’s database; see gateway/.env.example).')
const wallet = await postgresWallet(process.env.WALLET_DATABASE_URL, database, { createTables: process.env.WALLET_CREATE_TABLES === '1' })

// What keys spent in the gateway reaches the wallet, and what Pitch granted or spent reaches the keys' budgets.
const every = Number(process.env.SYNC_SECONDS || 30) * 1000
const loop = async () => { await syncAll(process.env, wallet).catch(e => console.error('sync:', e.message)); setTimeout(loop, every) }
setTimeout(loop, every)

createServer(async (req, res) => {
  if (req.url === '/healthz') return res.writeHead(200).end('ok')
  try {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v)
    const r = await handle(new Request(`http://localhost${req.url}`, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }), process.env, wallet)
    res.writeHead(r.status, Object.fromEntries(r.headers)).end(Buffer.from(await r.arrayBuffer()))
  } catch (e) {
    console.error(e)
    res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'Something went wrong. Try again in a moment.' }))
  }
}).listen(Number(process.env.PORT || 8080))
