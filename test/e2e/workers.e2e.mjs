// Remote workers end to end, from the desktop: does AgentShot reach a worker someone spun up and hand it work?
// Starts real headless AgentShot workers (--worker) next to a desktop AgentShot, and a stand-in for the account
// service that uses its own pool and lease rules (account/src). Then, from the desktop:
//   1. a home worker: pair with its address and the code it prints, make a project there, see it listed, disconnect
//   2. a wrong pairing code is turned away
//   3. cloud workers (the pool): sign in, find them, lease one, make a project there (it lands in this person's space on
//      the shared disk, not on the desktop), give it back, lease again and see the project from the other worker
//   4. a computer shared as a cloud worker (Settings → Mobile → Share this computer): pool, but no shared disk
// Run after npm run build.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { bundledBinary } from './helpers.mjs'
import { memoryWallet, LEASE_LIMITS } from '../../account/src/wallet.ts'
import { leaseAfterBeat, signWorkerToken } from '../../account/src/index.ts'

const root = join(import.meta.dirname, '..', '..')
const electronBinary = createRequire(import.meta.url)('electron')
const until = async (what, f, ms = 60_000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise(r => setTimeout(r, 500)) } }
const results = []
const step = async (name, f) => {
  const t = Date.now()
  try { await f(); results.push(['ok', name, Date.now() - t]); console.log(`  ✓ ${name} (${Date.now() - t} ms)`) }
  catch (e) { results.push(['FAIL', name, Date.now() - t, e.message]); console.log(`  ✗ ${name}: ${e.message}`) }
}

const tmp = mkdtempSync(join(tmpdir(), 'agentshot-workers-')), ud = join(tmp, 'desktop'), projects = join(tmp, 'desktop-projects')
console.log(`workers e2e: ${tmp}`)
const video = n => {
  const file = join(tmp, `${n}.mp4`)
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=2:r=30', '-f', 'lavfi', '-i', 'sine=f=440:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
  return file
}
const titles = dir => existsSync(dir) ? readdirSync(dir).flatMap(d => { try { return [JSON.parse(readFileSync(join(dir, d, 'project.json'), 'utf8')).title] } catch { return [] } }) : []

// Stand-ins for Clerk and the account service: signing in, the person's computers, and the pool by its real rules
const accountKey = 'sk-e2e-account', poolSecret = 'e2e-pool-secret-0123456789abcdef', user = 'user_e2e'
const pool = memoryWallet()
const seen = { leases: [], releases: 0, heartbeats: {} }
const read = async req => { let raw = ''; for await (const c of req) raw += c; return raw }
const respond = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const clerk = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://clerk')
  if (url.pathname === '/oauth/authorize') {
    const back = new URL(url.searchParams.get('redirect_uri'))
    back.searchParams.set('code', 'e2e-code'); back.searchParams.set('state', url.searchParams.get('state'))
    res.writeHead(302, { location: back.toString() }); return res.end()
  }
  if (url.pathname === '/oauth/token' && req.method === 'POST')
    return new URLSearchParams(await read(req)).get('code') === 'e2e-code' ? respond(res, 200, { access_token: 'e2e-access' }) : respond(res, 400, { error: 'invalid_grant' })
  res.writeHead(404).end()
}).listen(0, '127.0.0.1')
const lent = w => {
  const expiresAt = Date.now() + 24 * 60 * 60_000
  return { id: w.id, name: w.name, pool: true, fingerprint: w.fingerprint, capabilities: w.capabilities, expiresAt, urls: w.urls, token: signWorkerToken(w.secret, user, true, expiresAt) }
}
const accounts = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://account'), auth = req.headers.authorization || ''
  if (url.pathname === '/v1/key' && req.method === 'POST')
    return auth === 'Bearer e2e-access' ? respond(res, 200, { key: accountKey, key_id: 'vk_e2e', email: 'e2e@example.com' }) : respond(res, 401, { error: 'Sign in again.' })
  if (url.pathname === '/v1/mesh/join') return respond(res, 503, { error: 'Mesh is not configured yet.' })
  if (url.pathname === '/v1/workers/heartbeat' && req.method === 'POST' && req.headers['x-manul-pool-secret'] === poolSecret) {
    const w = JSON.parse(await read(req))
    seen.heartbeats[w.id] = (seen.heartbeats[w.id] || 0) + 1
    const rec = await pool.upsertWorker({ id: w.id, pool: true, name: w.name, urls: w.urls, fingerprint: w.fingerprint, secret: w.secret, capabilities: w.capabilities || {} })
    if (!rec) return respond(res, 409, { error: 'This worker id belongs to another computer.' })
    return respond(res, 200, { id: rec.id, pool: true, ...(await leaseAfterBeat(pool, rec, w.activity, 15 * 60_000, LEASE_LIMITS)) })
  }
  if (auth !== `Bearer ${accountKey}`) return respond(res, 401, { error: 'Sign in first.' })
  if (url.pathname === '/v1/balance') return respond(res, 200, { credits: 1000, plan: null, tiers: [], plans: [] })
  if (url.pathname === '/v1/workers/heartbeat' && req.method === 'POST') { await read(req); return respond(res, 200, { ok: true, pool: false }) }
  if (url.pathname === '/v1/workers' && req.method === 'GET') {
    const { leased, poolAvailable } = await pool.workersFor(user)
    return respond(res, 200, { workers: leased.map(lent), poolAvailable })
  }
  if (url.pathname === '/v1/workers/lease' && req.method === 'POST') {
    const { workerId } = JSON.parse(await read(req) || '{}')
    const w = await pool.leaseWorker(user, { workerId, ttlMs: 15 * 60_000, limits: LEASE_LIMITS })
    if (!w) return respond(res, 404, { error: 'No cloud workers are free right now. Try again in a moment.' })
    seen.leases.push(w.id)
    return respond(res, 200, { worker: lent(w) })
  }
  if (url.pathname === '/v1/workers/release' && req.method === 'POST') {
    const { workerId } = JSON.parse(await read(req))
    const released = await pool.releaseWorker(user, workerId)
    if (released) seen.releases++
    return respond(res, 200, { released })
  }
  respond(res, 404, { error: 'Not found' })
}).listen(0, '127.0.0.1')
await Promise.all([clerk, accounts].map(s => new Promise(r => (s.listening ? r() : s.once('listening', r)))))
const at = s => `http://127.0.0.1:${s.address().port}`
const env = { ...process.env, MANUL_PROJECTS: projects, MANUL_AUTH_ISSUER: at(clerk), MANUL_AUTH_CLIENT_ID: 'e2e-client', MANUL_ACCOUNT: at(accounts) }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MANUL_KEY', 'MANUL_POOL_SECRET', 'MANUL_SHARED_ROOT']) delete env[k]

// A headless AgentShot worker, started again whenever it exits (as systemd does: a stateless cloud worker restarts to
// open or close a person's space). Its "ready" line carries its addresses and pairing code.
function startWorker({ id, name, port, extra = {} }) {
  const dir = join(tmp, id), log = join(dir, 'worker.log')
  mkdirSync(dir, { recursive: true })
  const w = { id, dir, log, ready: undefined, starts: 0, stopped: false, child: undefined }
  const start = () => {
    if (w.stopped) return
    w.starts++
    w.child = spawn(electronBinary, [root, '--worker', `--user-data-dir=${join(dir, 'profile')}`], {
      env: { ...env, MANUL_WORKER: '1', MANUL_WORKER_ID: id, MANUL_WORKER_NAME: name, MANUL_BRIDGE_PORT: String(port), MANUL_PROJECTS: join(dir, 'projects'), MANUL_HEARTBEAT_SECONDS: '3', ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    for (const s of [w.child.stdout, w.child.stderr]) s.on('data', d => {
      appendFileSync(log, d)
      for (const line of String(d).split('\n')) if (line.startsWith('{"worker":"ready"')) w.ready = JSON.parse(line)
    })
    w.child.on('exit', () => setTimeout(start, 500))
  }
  start()
  return Object.assign(w, { stop: () => { w.stopped = true; w.child?.kill() } })
}

const shared = join(tmp, 'shared')
const home = startWorker({ id: 'home-worker', name: 'E2E Home Workstation', port: 47911 })
const cloud = [1, 2].map(n => startWorker({ id: `pool-e2e-${n}`, name: `E2E Cloud ${n}`, port: 47920 + n,
  extra: { MANUL_POOL_SECRET: poolSecret, MANUL_SHARED_ROOT: shared, MANUL_WORKER_SLOT: join(tmp, `pool-e2e-${n}`, 'slot') } }))
// what Share this computer as a cloud worker starts: pooled, its own projects folder, no shared disk, never restarts
const lent3 = startWorker({ id: 'pool-shared-computer', name: 'E2E Shared Computer', port: 47930, extra: { MANUL_POOL_SECRET: poolSecret } })
// the desktop's lease: it waits by itself while a stateless worker restarts into this person's space
const lease = async workerId => {
  const t = Date.now()
  const st = await win.evaluate(id => window.agentshot.worker.lease({ workerId: id }), workerId)
  return { st, ms: Date.now() - t }
}
let win

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env })
const desktopLog = join(tmp, 'desktop.log')
for (const s of [app.process().stdout, app.process().stderr]) s?.on('data', d => appendFileSync(desktopLog, d))
try {
  win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)

  console.log('\nHome worker (paired by address and code)')
  await step('the worker starts and prints its addresses and a pairing code', async () => {
    const r = await until('the home worker to be ready', () => home.ready, 120_000)
    assert.ok(r.addresses?.length, 'addresses'); assert.match(r.code || '', /^\d{6}$/, 'a 6-digit code')
    console.log(`    ${r.addresses.join(', ')}`)
  })
  await step('a wrong pairing code is turned away', async () => {
    const err = await win.evaluate(({ url }) => window.agentshot.worker.pair({ url, code: '000000' }).then(() => null, e => e.message), { url: home.ready.addresses[0] })
    assert.ok(err, 'pairing with a wrong code should fail')
    console.log(`    "${err.replace(/^Error invoking remote method 'worker:pair': (Error: )?/, '')}"`)
  })
  let remoteDir
  await step('the desktop pairs with it', async () => {
    // a wrong try may have used up the code: the worker issues a new one on restart; take whatever it shows now
    const st = await win.evaluate(i => window.agentshot.worker.pair(i), { url: home.ready.addresses[0], code: home.ready.code })
    assert.equal(st.connected, true); assert.equal(st.active.fingerprint, home.ready.fingerprint)
  })
  await step('a project made on the desktop is made on the worker', async () => {
    const p = await win.evaluate(f => window.agentshot.project.create(f), video('Home worker project'))
    remoteDir = p.dir
    assert.ok(titles(join(home.dir, 'projects')).includes('Home worker project'), `on the worker (${titles(join(home.dir, 'projects'))})`)
    assert.ok(!titles(projects).includes('Home worker project'), 'and not on the desktop')
  })
  await step('the desktop lists the worker\'s project', async () => {
    const recent = await win.evaluate(() => window.agentshot.project.recent())
    assert.ok(recent.some(r => r.dir === remoteDir), 'listed')
  })
  await step('the desktop disconnects', async () => {
    const st = await win.evaluate(() => window.agentshot.worker.disconnect())
    assert.equal(st?.connected ?? (await win.evaluate(() => window.agentshot.worker.status())).connected, false)
  })

  console.log('\nCloud workers (the pool, through the account)')
  await step('both cloud workers report themselves to the account', async () => {
    await until('both pool workers to beat', () => cloud.every(w => seen.heartbeats[w.id]), 180_000)
  })
  await step('the desktop signs in', async () => {
    await app.evaluate(({ shell }) => { shell.openExternal = async url => { await fetch(url) } })
    const a = await win.evaluate(() => window.agentshot.account.signIn())
    assert.equal(a.email, 'e2e@example.com')
  })
  await step('the desktop sees free cloud workers', async () => {
    const found = await win.evaluate(() => window.agentshot.worker.discover())
    assert.ok(found.poolAvailable >= 2, `poolAvailable ${found.poolAvailable}`)
    console.log(`    ${found.poolAvailable} free`)
  })
  let leased
  await step('the desktop leases one and connects', async () => {
    const { st, ms } = await lease(cloud[0].id)
    assert.equal(st.connected, true); leased = st.active
    console.log(`    ${leased.name} at ${leased.activeUrl}, in after ${(ms / 1000).toFixed(1)} s`)
  })
  await step('the worker opens this person\'s space (restarts into it)', async () => {
    const w = cloud.find(c => c.id === leased.id)
    await until('the leased worker to restart into the space', () => w.starts > 1 && w.ready && existsSync(join(shared, 'users', user)), 90_000)
  })
  await step('a project made on the desktop lands in the person\'s cloud space', async () => {
    // the worker just restarted: the desktop has to find it again by itself
    await until('the worker to answer the desktop again', async () => (await win.evaluate(() => window.agentshot.project.recent().then(() => true, () => false))), 60_000)
    await win.evaluate(f => window.agentshot.project.create(f), video('Cloud project'))
    const space = join(shared, 'users', user, 'projects')
    assert.ok(titles(space).includes('Cloud project'), `in the space (${titles(space)})`)
    assert.ok(!titles(projects).includes('Cloud project'), 'and not on the desktop')
    for (const w of cloud) assert.ok(!titles(join(w.dir, 'slot', 'idle-projects')).length, `${w.id} keeps nothing idle`)
  })
  await step('the desktop gives the worker back', async () => {
    const st = await win.evaluate(id => window.agentshot.worker.release(id), leased.id)
    assert.equal(st.connected, false); assert.equal(seen.releases, 1)
  })
  await step('leasing the other worker shows the same project', async () => {
    const other = cloud.find(c => c.id !== leased.id)
    const { st } = await lease(other.id)
    assert.equal(st.active.id, other.id)
    const recent = await until('the project from the other worker', async () => {
      const r = await win.evaluate(() => window.agentshot.project.recent().catch(() => []))
      return r.find(p => p.title === 'Cloud project')
    }, 60_000)
    assert.ok(recent)
    await win.evaluate(id => window.agentshot.worker.release(id), other.id)
  })

  console.log('\nA computer shared as a cloud worker (pool, no shared disk)')
  await step('the desktop leases it and connects on its own', async () => {
    await until('it to report itself', () => seen.heartbeats[lent3.id], 120_000)
    const { st, ms } = await lease(lent3.id)
    assert.equal(st.active.id, lent3.id)
    console.log(`    in after ${(ms / 1000).toFixed(1)} s`)
  })
  await step('a project made on the desktop is made there', async () => {
    await win.evaluate(f => window.agentshot.project.create(f), video('Shared computer project'))
    assert.ok(titles(join(lent3.dir, 'projects')).includes('Shared computer project'), `there (${titles(join(lent3.dir, 'projects'))})`)
    const recent = await win.evaluate(() => window.agentshot.project.recent())
    assert.ok(!recent.some(r => r.title === 'Home worker project' || r.title === 'Cloud project'), 'and it shows no one else\'s projects')
    await win.evaluate(id => window.agentshot.worker.release(id), lent3.id)
  })
} finally {
  for (const w of [home, ...cloud, lent3]) w.stop()
  await app.close().catch(() => {})
  clerk.close(); accounts.close()
  const failed = results.filter(r => r[0] === 'FAIL')
  console.log(`\nworkers e2e: ${results.length - failed.length}/${results.length} passed${failed.length ? `; logs in ${tmp}` : ''}`)
  process.exitCode = failed.length ? 1 : 0
}
