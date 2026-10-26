// The mobile app end to end, against the real desktop app: this starts desktop AgentShot (a disposable profile, a
// project made from a test video, a scripted model so the agent answers the same thing every time), turns on
// Settings → Mobile, and runs each Flutter integration test (mobile/integration_test) on an Android device or
// emulator with a fresh pairing code. Then it checks the desktop side: the phone's note reached the project's
// conversation, and disconnecting removed the device.
// Needs Flutter and a running Android device or emulator (or an AVD, which it boots without a window). Run after
// npm run build. MOBILE_E2E_DEVICE picks the device, MOBILE_E2E_AVD the AVD, FLUTTER the flutter binary.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHmac } from 'node:crypto'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'
import { createRequire } from 'node:module'

const root = join(import.meta.dirname, '..', '..'), mobile = join(root, 'mobile')
const electronBinary = createRequire(import.meta.url)('electron')
const flutter = process.env.FLUTTER || 'flutter'
// pairing first (from a phone that never paired), settings last (it disconnects the phone); MOBILE_E2E_ONLY=a,b runs some
const all = ['pairing', 'projects', 'conversation', 'film', 'editing', 'create', 'examples', 'uploads', 'timeline', 'export', 'responsive', 'connection', 'change_computer', 'setup_ai', 'signin', 'cloud', 'settings_panels', 'settings']
const only = process.env.MOBILE_E2E_ONLY
const tests = only && only !== 'all' ? only.split(',') : all
// MOBILE_E2E_SHOTS=<folder> (with MOBILE_E2E_ONLY=store_screenshots): store screenshots, saved as the test asks
const shots = process.env.MOBILE_E2E_SHOTS
const project = 'Harbour walk', reply = shots
  ? 'Done. I cut four fillers, 2.1 s in all, each in the quiet before the next word so nothing jumps, and the film now starts on her first line. Have a look at the before and after.'
  : 'Mobile e2e reply: the opening is tighter now.'
const until = async (what, f, ms = 30_000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v) return v; if (Date.now() > end) throw new Error(`timed out: ${what}`); await new Promise(r => setTimeout(r, 500)) } }

// An Android device: the one named, a running one, or an AVD booted headless (and shut down afterwards).
const devices = () => JSON.parse(execFileSync(flutter, ['devices', '--machine'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }))
  .filter(d => String(d.targetPlatform).startsWith('android'))
let device = process.env.MOBILE_E2E_DEVICE || devices()[0]?.id, booted
if (!device) {
  const avd = process.env.MOBILE_E2E_AVD || spawnSync('emulator', ['-list-avds'], { encoding: 'utf8' }).stdout?.split('\n').find(Boolean)
  if (!avd) { console.log('mobile e2e: skipped (no Android device, emulator or AVD)'); process.exit(0) }
  booted = spawn('emulator', ['-avd', avd, '-no-window', '-no-audio', '-no-snapshot-save', '-no-boot-anim'], { stdio: 'ignore' })
  device = await until('the emulator to boot', () => devices()[0]?.id, 300_000)
  await until('Android to finish booting', () => spawnSync('adb', ['-s', device, 'shell', 'getprop', 'sys.boot_completed'], { encoding: 'utf8' }).stdout?.trim() === '1', 300_000)
}

// Awake and unlocked: Android lets only the app in focus read the clipboard the tests paste from.
for (const args of [['shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'], ['shell', 'wm', 'dismiss-keyguard'], ['shell', 'input', 'keyevent', '82']])
  spawnSync('adb', ['-s', device, ...args])

if (shots) spawnSync('adb', ['-s', device, 'shell', 'settings', 'put', 'global', 'sysui_demo_allowed', '1'])
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-mobile-')), ud = join(tmp, 'ud'), projects = join(tmp, 'projects')
const video = join(tmp, `${project}.mp4`)
// a test card, or for store screenshots slow colour gradients that read as footage
const footage = (file, [c0, c1, c2] = ['0x1d3557', '0xe76f51', '0xf4a261']) => execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  shots ? `gradients=s=1280x720:c0=${c0}:c1=${c1}:c2=${c2}:n=3:speed=0.015:d=12:r=30` : 'testsrc2=s=640x360:d=3:r=30',
  '-f', 'lavfi', '-i', `sine=f=440:d=${shots ? 12 : 3}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', file])
footage(video)
const extras = shots ? [['Product launch teaser', ['0x0b132b', '0x3a506b', '0x5bc0be']], ['Interview with Maya', ['0x2b2d42', '0x8d99ae', '0xedf2f4']], ['Weekend in Lisbon', ['0x264653', '0x2a9d8f', '0xe9c46a']]] : []
for (const [title, colours] of extras) footage(join(tmp, `${title}.mp4`), colours)

// The agent's model, scripted by what the phone asked: an edit really cuts the film and proposes it, a video from an
// idea really makes and renders a motion clip, and anything else gets a reply. Every turn ends with the same text,
// so the phone can wait for it.
const scripts = [
  [/tighten the opening/, [
    ['edit_timeline', { edits: [{ op: 'cut', from: 0, to: 1 }] }],
    ['rerender_timeline', { title: 'Opening tightened' }],
  ]],
  [/Mobile e2e motion/, [
    ['create_clip', { id: 'title-card', title: 'Opening title', duration: 2, html:
      '<h1 data-manul-id="title">Harbour walk</h1><style>body{margin:0;display:grid;place-items:center;background:#161412}' +
      'h1{font:700 120px Inter,sans-serif;color:#f2a541}</style><script>gsap.from("h1",{opacity:0,y:40,duration:1})</script>' }],
    ['insert_clip', { id: 'title-card', at: 0, title: 'Opening title added' }],
  ]],
]
// a turn that takes its time, so the phone can stop it
const slow = /Mobile e2e slow/
const notes = [], calls = [], turns = []
const text = c => (typeof c === 'string' ? c : (c || []).map(p => p.text || '').join(' '))
const model = createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  if (!req.url.endsWith('/chat/completions')) { res.statusCode = 404; return res.end() }
  // a tool that returns an image (create_clip's frame) adds a user message carrying it: that isn't the person asking
  const messages = JSON.parse(raw).messages, at = messages.findLastIndex(m => m.role === 'user' && !/^Attached image/.test(text(m.content)))
  const asked = text(messages[at]?.content), done = messages.slice(at + 1).filter(m => m.role === 'tool').length
  if (!done) notes.push(asked)
  const next = scripts.find(([match]) => match.test(asked))?.[1][done]
  turns.push(`${asked.slice(0, 40)} → ${next?.[0] ?? 'reply'}`)
  const chunk = delta => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'scripted', choices: [{ index: 0, ...delta }] })}\n\n`
  res.setHeader('content-type', 'text/event-stream')
  if (!next && slow.test(asked)) await new Promise(r => setTimeout(r, 20_000))
  if (next) {
    calls.push(next[0])
    res.write(chunk({ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${messages.length}`, type: 'function', function: { name: next[0], arguments: JSON.stringify(next[1]) } }] }, finish_reason: null }))
    res.write(chunk({ delta: {}, finish_reason: 'tool_calls' }))
  } else {
    res.write(chunk({ delta: { role: 'assistant', content: reply }, finish_reason: null }))
    res.write(chunk({ delta: {}, finish_reason: 'stop' }))
  }
  res.end('data: [DONE]\n\n')
}).listen(0, '127.0.0.1')
await new Promise(r => model.once('listening', r))
mkdirSync(ud, { recursive: true })
writeFileSync(join(ud, 'providers.json'), JSON.stringify([{ id: 'scripted', name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: 'openai-completions', models: [{ id: 'scripted-agent' }] }]))

// Stand-ins for Clerk (signing in) and AgentShot's account service: just what signing in and finding the person's
// computers use. The desktop reports itself here once signed in (its worker heartbeat), as it does to the real one.
const computer = 'E2E Studio', accountKey = 'sk-e2e-account', email = 'maya@example.com'
const seen = { heartbeats: 0, exchanged: 0, callback: '' }
const machines = new Map()
// cloud workers (the pool): reported with the pool secret, lent to one person at a time
const pool = new Map(), poolSecret = 'e2e-pool-secret-0123456789abcdef'
seen.leases = 0; seen.releases = 0
let bridgeUrl = ''
// as signWorkerToken in account/src/index.ts: a day-long token the computer checks with the secret it reported
const workerToken = (secret, userId, expiresAt, pool = false) => {
  const payload = `${expiresAt}.${Buffer.from(`${pool ? 'pool' : 'owner'}:${userId}`).toString('base64url')}`
  return `lease.${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}
const read = async req => { let raw = ''; for await (const c of req) raw += c; return raw }
const respond = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
const clerk = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://clerk')
  if (url.pathname === '/oauth/authorize') { // signed in at once: straight back with a code
    const back = new URL(url.searchParams.get('redirect_uri'))
    back.searchParams.set('code', 'e2e-code'); back.searchParams.set('state', url.searchParams.get('state'))
    // where the phone's one-shot relay would send the browser on to (it signs in on the desktop's return address too)
    seen.callback = `agentshot://auth/callback?code=e2e-code&state=${encodeURIComponent(url.searchParams.get('state'))}`
    res.writeHead(302, { location: back.toString() }); return res.end()
  }
  if (url.pathname === '/oauth/token' && req.method === 'POST') {
    const ok = new URLSearchParams(await read(req)).get('code') === 'e2e-code'
    if (ok) seen.exchanged++
    return ok ? respond(res, 200, { access_token: 'e2e-access' }) : respond(res, 400, { error: 'invalid_grant' })
  }
  res.writeHead(404).end()
}).listen(0, '127.0.0.1')
const accounts = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://account'), auth = req.headers.authorization || ''
  // signing in on the phone: Clerk comes back to the account service, which sends the browser on into the app
  if (url.pathname === '/oauth/phone') {
    const back = new URL('agentshot://auth/callback')
    for (const k of ['code', 'state']) if (url.searchParams.get(k)) back.searchParams.set(k, url.searchParams.get(k))
    res.writeHead(302, { location: back.toString(), 'content-type': 'text/html' }); return res.end(`<a href="${back}">Back to AgentShot</a>`)
  }
  if (url.pathname === '/v1/key' && req.method === 'POST')
    return auth === 'Bearer e2e-access' ? respond(res, 200, { key: accountKey, key_id: 'vk_e2e', email }) : respond(res, 401, { error: 'Your sign-in has expired. Sign in again.' })
  // a cloud worker reports itself with the pool secret, and hears back who leases it
  if (url.pathname === '/v1/workers/heartbeat' && req.method === 'POST' && req.headers['x-manul-pool-secret'] === poolSecret) {
    const w = JSON.parse(await read(req)), was = pool.get(w.id)
    pool.set(w.id, { ...w, at: Date.now(), leasedTo: was?.leasedTo, leasedUntil: was?.leasedUntil })
    const now = pool.get(w.id)
    return respond(res, 200, { id: w.id, pool: true, leasedTo: now.leasedUntil > Date.now() ? now.leasedTo : null, leasedUntil: now.leasedUntil > Date.now() ? now.leasedUntil : null })
  }
  if (auth !== `Bearer ${accountKey}`) return respond(res, 401, { error: 'Sign in first.' })
  if (url.pathname === '/v1/workers/heartbeat' && req.method === 'POST') {
    const w = JSON.parse(await read(req)); seen.heartbeats++
    machines.set(w.id, { ...w, at: Date.now() }); return respond(res, 200, { ok: true, pool: false })
  }
  // the cloud worker as this person sees it: the address the emulator reaches it at, a pool token
  const lent = w => ({ id: w.id, name: w.name, pool: true, fingerprint: w.fingerprint, capabilities: w.capabilities, expiresAt: w.leasedUntil,
    urls: [`https://10.0.2.2:${new URL(w.urls[0]).port}`, ...w.urls], token: workerToken(w.secret, 'user_e2e', w.leasedUntil, true) })
  const free = () => [...pool.values()].filter(w => Date.now() - w.at < 2 * 60_000 && !(w.leasedUntil > Date.now()))
  if (url.pathname === '/v1/workers/lease' && req.method === 'POST') {
    const w = free()[0]
    if (!w) return respond(res, 404, { error: 'No cloud workers are free right now. Try again in a moment.' })
    Object.assign(w, { leasedTo: 'user_e2e', leasedUntil: Date.now() + 60 * 60_000 }); seen.leases++
    return respond(res, 200, { worker: lent(w) })
  }
  if (url.pathname === '/v1/workers/release' && req.method === 'POST') {
    const { workerId } = JSON.parse(await read(req)), w = pool.get(workerId)
    if (w?.leasedTo === 'user_e2e') { w.leasedTo = undefined; w.leasedUntil = undefined; seen.releases++ }
    return respond(res, 200, { released: !!w })
  }
  if (url.pathname === '/v1/workers' && req.method === 'GET') {
    const expiresAt = Date.now() + 24 * 60 * 60_000
    const workers = [...machines.values()].filter(w => Date.now() - w.at < 2 * 60_000).map(w => ({
      id: w.id, name: w.name, pool: false, fingerprint: w.fingerprint, capabilities: w.capabilities, expiresAt,
      urls: [bridgeUrl, ...w.urls], token: workerToken(w.secret, 'user_e2e', expiresAt), // first: how the emulator reaches it
    }))
    const leased = [...pool.values()].filter(w => w.leasedTo === 'user_e2e' && w.leasedUntil > Date.now()).map(lent)
    return respond(res, 200, { workers: [...workers, ...leased], poolAvailable: free().length })
  }
  if (url.pathname === '/v1/balance' && req.method === 'GET') return respond(res, 200, { credits: 1000, plan: null, tiers: [], plans: [] })
  if (url.pathname === '/v1/mesh/join') return respond(res, 503, { error: 'Mesh is not configured yet.' })
  respond(res, 404, { error: 'Not found' })
}).listen(0, '127.0.0.1')
await Promise.all([clerk, accounts].map(srv => new Promise(r => (srv.listening ? r() : srv.once('listening', r)))))
const at = (srv, host) => `http://${host}:${srv.address().port}`

// Media the phone "picks" in the uploads test (the system picker can't be scripted): real videos and photos, served
// to the device, which uploads them to the desktop like any it picked.
const media = join(tmp, 'media'); mkdirSync(media)
for (const [name, colour] of [['Surf session.mp4', 'blue'], ['Harbour drone.mp4', 'teal'], ['Sunset walk.mp4', 'orange']])
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=640x360:d=2:r=30,hue=s=0,drawbox=c=${colour}@0.5:t=fill`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(media, name)])
for (const n of [1, 2, 3])
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=800x600:d=1,hue=h=${n * 90}`, '-frames:v', '1', join(media, `Dunes ${n}.jpg`)])
// the timeline test's project: two clips with sound (one to transcribe), music for the mix, a recording, and a file
// that is neither video nor photo
for (const [name, colour] of [['Pier jump.mp4', 'purple'], ['Gull flyby.mp4', 'yellow'], ['Recorded clip.mp4', 'red']])
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=640x360:d=3:r=30,drawbox=c=${colour}@0.5:t=fill`, '-f', 'lavfi', '-i', 'sine=f=330:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(media, name)])
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=f=262:d=6', '-c:a', 'aac', join(media, 'Theme music.m4a')])
writeFileSync(join(media, 'Shot list.txt'), 'Opening: the pier. Then the gulls.\n')
// a page for the desktop's agent browser to open
writeFileSync(join(media, 'page.html'), '<!doctype html><title>E2E page</title><h1>E2E page</h1>')
const fixtures = createServer((req, res) => {
  // the examples' videos (the desktop's MANUL_GALLERY_URL): any of them is a test video here
  if (req.url.startsWith('/gallery/')) { res.writeHead(200, { 'content-type': 'video/mp4' }); return res.end(readFileSync(join(media, 'Surf session.mp4'))) }
  const name = decodeURIComponent(new URL(req.url, 'http://media').pathname.replace(/^\/fixtures\//, ''))
  if (!/^[\w .-]+$/.test(name) || !existsSync(join(media, name))) { res.writeHead(404); return res.end() }
  res.writeHead(200, name.endsWith('.html') ? { 'content-type': 'text/html' } : {}); res.end(readFileSync(join(media, name)))
}).listen(0, '127.0.0.1')
await new Promise(r => (fixtures.listening ? r() : fixtures.once('listening', r)))

const env = { ...process.env, MANUL_PROJECTS: projects, MANUL_GALLERY_URL: `${at(fixtures, '127.0.0.1')}/gallery`, MANUL_PROVIDER_SCRIPTED_KEY: 'sk-scripted',
  MANUL_GATEWAY: `http://127.0.0.1:${model.address().port}`, MANUL_AUTH_ISSUER: at(clerk, '127.0.0.1'), MANUL_AUTH_CLIENT_ID: 'e2e-client', MANUL_ACCOUNT: at(accounts, '127.0.0.1'), MANUL_WORKER_NAME: computer }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MANUL_KEY']) delete env[k]
// Linux CI has no unlocked system keyring: keep the disposable profile's keys in plain text.
// A cloud worker for the cloud test: AgentShot --worker with the pool secret, reporting itself to the stand-in account.
let cloud
async function startCloudWorker() {
  const dir = join(tmp, 'cloud-worker'), ud = join(dir, 'profile'), projects = join(dir, 'projects')
  mkdirSync(ud, { recursive: true })
  writeFileSync(join(ud, 'providers.json'), readFileSync(join(tmp, 'ud', 'providers.json')))
  const log = join(dir, 'worker.log')
  const child = spawn(electronBinary, [root, '--worker', `--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--password-store=basic'] : [])], {
    env: { ...env, MANUL_WORKER: '1', MANUL_POOL_SECRET: poolSecret, MANUL_WORKER_ID: 'pool-e2e', MANUL_WORKER_NAME: 'E2E Cloud', MANUL_PROJECTS: projects },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const s of [child.stdout, child.stderr]) s.on('data', d => appendFileSync(log, d))
  await until('the cloud worker to report itself', () => pool.has('pool-e2e'), 120_000)
  return { projects, stop: () => child.kill(), log }
}
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`, ...(process.platform === 'linux' ? ['--password-store=basic'] : [])], env })
const desktopLog = join(tmp, 'desktop.log') // the desktop's side of a failure
for (const s of [app.process().stdout, app.process().stderr]) s?.on('data', d => appendFileSync(desktopLog, d))
try {
  if (process.platform === 'linux') await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  // if the desktop goes away mid-run, say why (in desktop.log)
  await app.evaluate(({ app: electronApp, BrowserWindow }) => {
    electronApp.on('before-quit', () => console.log(`e2e: quitting\n${new Error().stack}`))
    electronApp.on('render-process-gone', (_e, _w, d) => console.log(`e2e: renderer gone: ${d.reason} ${d.exitCode}`))
    electronApp.on('child-process-gone', (_e, d) => console.log(`e2e: ${d.type} process gone: ${d.reason} ${d.exitCode}`))
    for (const w of BrowserWindow.getAllWindows()) w.on('closed', () => console.log(`e2e: window closed\n${new Error().stack}`))
    process.on('exit', code => console.log(`e2e: exit ${code}`))
  })
  // Install and Download buttons on the phone really ask the desktop to download; here those downloads fail at
  // once (nothing leaves this machine), so the tests can press them without fetching hundreds of megabytes.
  await app.evaluate(() => {
    const real = globalThis.fetch
    globalThis.fetch = (input, init) => {
      const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
      return ['127.0.0.1', 'localhost'].includes(url.hostname) ? real(input, init) : Promise.resolve(new Response('offline in e2e', { status: 503 }))
    }
  })
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  const created = await win.evaluate(f => window.agentshot.project.create(f), video)
  assert.equal(created.title, project)
  await win.evaluate(d => window.agentshot.project.close(d), created.dir)
  for (const [title] of extras) {
    const p = await win.evaluate(f => window.agentshot.project.create(f), join(tmp, `${title}.mp4`))
    await win.evaluate(d => window.agentshot.project.close(d), p.dir)
  }
  if (shots) { // a tidy status bar: 12:00, full battery and signal, no notifications
    mkdirSync(shots, { recursive: true })
    for (const c of [['enter'], ['clock', '-e', 'hhmm', '1200'], ['battery', '-e', 'level', '100', '-e', 'plugged', 'false'], ['network', '-e', 'wifi', 'show', '-e', 'level', '4', '-e', 'mobile', 'hide'], ['notifications', '-e', 'visible', 'false']])
      spawnSync('adb', ['-s', device, 'shell', 'am', 'broadcast', '-a', 'com.android.systemui.demo', '-e', 'command', ...c])
  }

  let status = await win.evaluate(() => window.agentshot.mobile.start())
  assert.ok(status.running, 'the mobile bridge is running')
  // The emulator reaches this computer at 10.0.2.2; a phone at one of its network addresses.
  const bridge = device.startsWith('emulator-') ? `https://10.0.2.2:${new URL(status.addresses[0]).port}` : status.addresses[0]
  bridgeUrl = bridge
  // What the desktop's pairing QR carries (agentshot://pair?d=…), with the address this device can reach.
  const pairLink = ({ code, fingerprint }) =>
    `agentshot://pair?d=${Buffer.from(JSON.stringify({ v: 1, code, fingerprint, url: bridge, urls: [bridge] })).toString('base64url')}`
  // The first build on a fresh machine (Gradle, the NDK, CMake) can take longer than a pairing code lives (5 minutes):
  // build once now, before any code is made, so each test file's own build is a quick incremental one
  {
    const started = Date.now()
    const warm = spawn(flutter, ['build', 'apk', '--debug', '--no-pub'], { cwd: mobile, stdio: ['ignore', 'inherit', 'inherit'] })
    const code = await new Promise(r => warm.on('close', r))
    console.log(`mobile e2e: app built in ${Math.round((Date.now() - started) / 1000)} s${code ? ` (exit ${code}; each test builds it anyway)` : ''}`)
  }
  for (const test of tests) {
    // Flutter reinstalls the app for each file, so each one pairs as a new phone. Before the last, forget them all
    // on the desktop: what is left after it disconnects shows whether Disconnect unpaired it there too.
    if (test === 'settings') {
      for (const d of (await win.evaluate(() => window.agentshot.mobile.status())).devices) await win.evaluate(id => window.agentshot.mobile.revoke(id), d.id)
    }
    // the cloud test: a second AgentShot, headless, as a cloud worker (its own profile and projects, the same model)
    if (test === 'cloud' && !cloud) cloud = await startCloudWorker()
    if (test === 'signin' || test === 'setup_ai' || test === 'cloud') {
      if (!device.startsWith('emulator-')) { console.log(`mobile e2e: ${test} skipped (the stand-ins are reached at 10.0.2.2, from the emulator)`); continue }
      // Chrome without its first-run screens, which would stand between the app and the sign-in page
      spawnSync('adb', ['-s', device, 'shell', 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'])
      spawnSync('adb', ['-s', device, 'shell', 'am', 'set-debug-app', '--persistent', 'com.android.chrome'])
    }
    // no AI on the computer: the phone should offer to set it up
    if (test === 'setup_ai') await win.evaluate(() => window.agentshot.keys.set('MANUL_PROVIDER_SCRIPTED_KEY', ''))
    if (test === 'signin') {
      // the desktop signs in through its own flow, its browser step answered here
      await app.evaluate(({ shell }) => { shell.openExternal = async url => { await fetch(url) } })
      assert.equal((await win.evaluate(() => window.agentshot.account.signIn())).email, email, 'the desktop signed in')
      await until('the signed-in desktop reports itself to the account', () => seen.heartbeats > 0, 60_000)
    }
    status = await win.evaluate(() => window.agentshot.mobile.start()) // a fresh code: each one pairs once
    console.log(`mobile e2e: ${test}`)
    // Not spawnSync: the scripted model above answers the desktop from this same process while the phone test runs.
    // --reporter expanded: the test's lines (PAIR_LINK, DESKTOP …, SIGNING_IN) are its requests to this runner and
    // must arrive as they're printed; on GitHub Actions flutter otherwise picks its github reporter, which holds a
    // test's output back until the test has ended
    const run = spawn(flutter, ['test', `integration_test/${test}_test.dart`, '-d', device, '--no-pub', '--reporter', 'expanded',
      `--dart-define=E2E_PAIR=${pairLink(status)}`, `--dart-define=E2E_TYPE=${process.env.MOBILE_E2E_TYPE === '1'}`,
      `--dart-define=E2E_PROJECT=${project}`, `--dart-define=E2E_REPLY=${reply}`, `--dart-define=E2E_COMPUTER=${computer}`,
      `--dart-define=E2E_FIXTURES=${at(fixtures, '10.0.2.2')}/fixtures`, `--dart-define=E2E_DESKTOP_PAGE=${at(fixtures, '127.0.0.1')}/fixtures/page.html`, `--dart-define=AUTH_ISSUER=${at(clerk, '10.0.2.2')}`, '--dart-define=AUTH_CLIENT_ID=e2e-client', `--dart-define=ACCOUNT_URL=${at(accounts, '10.0.2.2')}`], { cwd: mobile, stdio: ['ignore', 'pipe', 'inherit'], timeout: 15 * 60_000 })
    run.stdout.on('data', d => {
      process.stdout.write(d)
      // the test "scans" the QR: open the pairing link on the device, as the camera would
      for (const [, link] of String(d).matchAll(/PAIR_LINK (agentshot:\/\/pair\?d=[\w-]+)/g)) {
        const opened = spawnSync('adb', ['-s', device, 'shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${link}'`, 'si.agentshot.app'], { encoding: 'utf8' })
        // what Android made of it, for when the app never hears the link (a CI emulator)
        console.log(`e2e: opened the pairing link: ${(opened.stdout + opened.stderr).replace(/\s+/g, ' ').trim()}`)
        setTimeout(() => {
          const top = spawnSync('adb', ['-s', device, 'shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' }).stdout.match(/topResumedActivity.*|mResumedActivity.*/)?.[0]
          const log = spawnSync('adb', ['-s', device, 'shell', 'logcat', '-d', '-t', '400'], { encoding: 'utf8' }).stdout.split('\n')
            .filter(l => /ActivityTaskManager|NewIntent|BackgroundActivity|si.agentshot.app.*(Intent|Mesh|link)|flutter/i.test(l) && !/FrameTracker|Choreographer/.test(l)).slice(-12).join('\n  ')
          console.log(`e2e: after the link, in front: ${top}\n  ${log}`)
        }, 4000)
      }
      // signing in: if the browser hasn't come back by itself, bring its answer back the way it would
      if (String(d).includes('SIGNING_IN')) setTimeout((before => () => {
        if (seen.callback && seen.exchanged === before) console.log('e2e: the browser did not come back into the app by itself; bringing it back')
        if (seen.callback && seen.exchanged === before) spawnSync('adb', ['-s', device, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${seen.callback}'`])
      })(seen.exchanged), 8000)
      // the connection test's cues: losing the computer
      for (const [, what] of String(d).matchAll(/DESKTOP (stop|start|revoke|back|camera|signout|signin)/g)) {
        // a system screen (the share sheet) covers the app: Back, until the app is in front again
        // (it may take a while to come: a render first): Back once it shows, done when the app is in front again
        if (what === 'back') void (async () => {
          let covered = false
          for (let i = 0; i < 180; i++) {
            await new Promise(r => setTimeout(r, 1000))
            const top = spawnSync('adb', ['-s', device, 'shell', 'dumpsys', 'activity', 'activities'], { encoding: 'utf8' }).stdout.match(/mResumedActivity.*|topResumedActivity.*/)?.[0] || ''
            if (!top.includes('si.agentshot.app')) { covered = true; spawnSync('adb', ['-s', device, 'shell', 'input', 'keyevent', 'KEYCODE_BACK']) }
            else if (covered) return
          }
        })()
        if (what === 'camera') spawnSync('adb', ['-s', device, 'shell', 'pm', 'grant', 'si.agentshot.app', 'android.permission.CAMERA'])
        // the desktop signs out (it stops reporting itself, so the phone finds no computer) and back in
        if (what === 'signout') void win.evaluate(() => window.agentshot.account.signOut()).then(() => machines.clear())
        if (what === 'signin') void win.evaluate(() => window.agentshot.account.signIn())
        // out of reach: the phone goes offline (airplane mode), which keeps the desktop's address the same
        if (what === 'stop') spawnSync('adb', ['-s', device, 'shell', 'cmd', 'connectivity', 'airplane-mode', 'enable'])
        if (what === 'start') spawnSync('adb', ['-s', device, 'shell', 'cmd', 'connectivity', 'airplane-mode', 'disable'])
        if (what === 'revoke') void win.evaluate(async () => { for (const d of (await window.agentshot.mobile.status()).devices) await window.agentshot.mobile.revoke(d.id) })
      }
      if (!shots) return
      for (const [, name] of String(d).matchAll(/SHOT (\S+)/g)) {
        writeFileSync(join(shots, `${name}.png`), execFileSync('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }))
        console.log(`mobile e2e: saved ${name}.png`)
      }
    })
    run.status = await new Promise(r => run.on('close', r))
    const bridgeNow = run.status ? await win.evaluate(() => window.agentshot.mobile.status()).then(st => `bridge ${st.running ? 'up' : 'DOWN'} at ${st.addresses.join(' ')}`, e => `desktop gone: ${e.message}`) : ''
    if (test === 'uploads' && !run.status) {
      // on the desktop: one project per import, each with every file the phone picked
      const byTitle = Object.fromEntries(readdirSync(projects).map(d => JSON.parse(readFileSync(join(projects, d, 'project.json'), 'utf8'))).map(p => [p.title, Object.keys(p.files || {}).map(f => f.split('/').pop()).sort()]))
      assert.deepEqual(byTitle['Surf session'], ['Harbour drone.mp4', 'Surf session.mp4'], 'several videos, one project')
      assert.deepEqual(byTitle['From 3 photos'], ['Dunes 1.jpg', 'Dunes 2.jpg', 'Dunes 3.jpg', 'canvas.mp4'], 'photos only: a made-from-scratch project (its blank canvas) with the photos')
      assert.deepEqual(byTitle['Sunset walk'], ['Dunes 1.jpg', 'Dunes 2.jpg', 'Dunes 3.jpg', 'Sunset walk.mp4'], 'the mix, plus the photos attached to a note')
    }
    if (test === 'setup_ai') {
      // the phone handed its AgentShot account to the computer; back to the scripted model for the rest
      const who = await win.evaluate(() => window.agentshot.account.status())
      await win.evaluate(() => window.agentshot.account.signOut())
      await win.evaluate(() => window.agentshot.keys.set('MANUL_PROVIDER_SCRIPTED_KEY', 'sk-scripted'))
      if (!run.status) assert.equal(who.email, email, 'Use AgentShot credits signed the computer in')
    }
    if (test === 'cloud' && !run.status) {
      // the phone made its project on the cloud worker (not this computer), and gave the worker back
      const made = readdirSync(cloud.projects).map(d => JSON.parse(readFileSync(join(cloud.projects, d, 'project.json'), 'utf8')).title)
      assert.ok(made.includes('Mobile e2e in the cloud'), `the project is on the cloud worker (${made.join(', ')})`)
      assert.ok(!readdirSync(projects).some(d => JSON.parse(readFileSync(join(projects, d, 'project.json'), 'utf8')).title === 'Mobile e2e in the cloud'), 'and not on this computer')
      assert.ok(seen.leases >= 1 && seen.releases >= 1, `leased and released (${seen.leases}/${seen.releases})`)
    }
    if (test === 'signin' && !run.status) {
      // the desktop saw the phone that signed in; then it signs out, so the agent goes back to the scripted model
      const st = await win.evaluate(() => window.agentshot.mobile.status())
      assert.ok(st.signedIn.some(p => p.name === 'Android phone'), `the desktop lists the signed-in phone (${JSON.stringify(st.signedIn)})`)
      await win.evaluate(() => window.agentshot.account.signOut())
    }
    assert.equal(run.status, 0, `mobile ${test} test failed (${bridgeNow}) (desktop log: ${desktopLog}; the model answered: ${turns.join(' | ') || 'nothing'})`)
  }

  // The desktop saw it all: the phone's notes reached the agent, its edit was kept, its idea became a motion project,
  // and the phone is no longer paired.
  if (tests.length === all.length) {
    for (const n of ['Mobile e2e: hello from the phone', 'Mobile e2e: tighten the opening', 'Mobile e2e motion'])
      assert.ok(notes.some(x => x.includes(n)), `"${n}" reached the desktop agent (it saw: ${notes.join(' | ')})`)
    // a cut sent back, a cut kept, then a video from an idea
    assert.deepEqual(calls, ['edit_timeline', 'rerender_timeline', 'edit_timeline', 'rerender_timeline', 'create_clip', 'insert_clip'], 'the agent edited and made a video')
    const edited = JSON.parse(readFileSync(join(created.dir, 'project.json'), 'utf8'))
    assert.equal(edited.proposal, undefined, 'the phone decided on the proposal')
    assert.equal(edited.versions.find(v => v.id === edited.current)?.title, 'Opening tightened', 'Keep on the phone made the cut current')
    const made = readdirSync(projects).map(d => join(projects, d))
      .filter(d => JSON.parse(readFileSync(join(d, 'project.json'), 'utf8')).title === 'Mobile e2e motion title card')
    assert.equal(made.length, 1, 'the idea became one new project')
    const motion = JSON.parse(readFileSync(join(made[0], 'project.json'), 'utf8'))
    assert.ok(motion.versions.some(v => v.title === 'Opening title added'), 'the motion project has the rendered title card')
    status = await win.evaluate(() => window.agentshot.mobile.status())
    assert.deepEqual(status.devices, [], 'disconnecting removed the device on the desktop')
  }
  console.log('mobile e2e: ok')
} finally {
  cloud?.stop()
  await app.close()
  model.close(); clerk.close(); accounts.close(); fixtures.close()
  if (booted) { spawnSync('adb', ['-s', device, 'emu', 'kill']); booted.kill() }
}
