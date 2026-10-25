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
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..'), mobile = join(root, 'mobile')
const flutter = process.env.FLUTTER || 'flutter'
// pairing first (from a phone that never paired), settings last (it disconnects the phone); MOBILE_E2E_ONLY=a,b runs some
const all = ['pairing', 'projects', 'conversation', 'editing', 'create', 'responsive', 'settings']
const tests = process.env.MOBILE_E2E_ONLY ? process.env.MOBILE_E2E_ONLY.split(',') : all
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

const env = { ...process.env, MANUL_PROJECTS: projects, MANUL_PROVIDER_SCRIPTED_KEY: 'sk-scripted' }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MANUL_KEY']) delete env[k]
// Linux CI has no unlocked system keyring: keep the disposable profile's keys in plain text.
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
  // What the desktop's pairing QR carries (agentshot://pair?d=…), with the address this device can reach.
  const pairLink = ({ code, fingerprint }) =>
    `agentshot://pair?d=${Buffer.from(JSON.stringify({ v: 1, code, fingerprint, url: bridge, urls: [bridge] })).toString('base64url')}`
  for (const test of tests) {
    // Flutter reinstalls the app for each file, so each one pairs as a new phone. Before the last, forget them all
    // on the desktop: what is left after it disconnects shows whether Disconnect unpaired it there too.
    if (test === 'settings') {
      for (const d of (await win.evaluate(() => window.agentshot.mobile.status())).devices) await win.evaluate(id => window.agentshot.mobile.revoke(id), d.id)
    }
    status = await win.evaluate(() => window.agentshot.mobile.start()) // a fresh code: each one pairs once
    console.log(`mobile e2e: ${test}`)
    // Not spawnSync: the scripted model above answers the desktop from this same process while the phone test runs.
    const run = spawn(flutter, ['test', `integration_test/${test}_test.dart`, '-d', device, '--no-pub',
      `--dart-define=E2E_PAIR=${pairLink(status)}`, `--dart-define=E2E_TYPE=${process.env.MOBILE_E2E_TYPE === '1'}`,
      `--dart-define=E2E_PROJECT=${project}`, `--dart-define=E2E_REPLY=${reply}`], { cwd: mobile, stdio: ['ignore', 'pipe', 'inherit'], timeout: 15 * 60_000 })
    run.stdout.on('data', d => {
      process.stdout.write(d)
      // the test "scans" the QR: open the pairing link on the device, as the camera would
      for (const [, link] of String(d).matchAll(/PAIR_LINK (agentshot:\/\/pair\?d=[\w-]+)/g))
        spawnSync('adb', ['-s', device, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', `'${link}'`, 'si.agentshot.app'])
      if (!shots) return
      for (const [, name] of String(d).matchAll(/SHOT (\S+)/g)) {
        writeFileSync(join(shots, `${name}.png`), execFileSync('adb', ['-s', device, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20 }))
        console.log(`mobile e2e: saved ${name}.png`)
      }
    })
    run.status = await new Promise(r => run.on('close', r))
    const bridgeNow = run.status ? await win.evaluate(() => window.agentshot.mobile.status()).then(st => `bridge ${st.running ? 'up' : 'DOWN'} at ${st.addresses.join(' ')}`, e => `desktop gone: ${e.message}`) : ''
    assert.equal(run.status, 0, `mobile ${test} test failed (${bridgeNow}) (desktop log: ${desktopLog}; the model answered: ${turns.join(' | ') || 'nothing'})`)
  }

  // The desktop saw it all: the phone's notes reached the agent, its edit was kept, its idea became a motion project,
  // and the phone is no longer paired.
  if (tests.length === all.length) {
    for (const n of ['Mobile e2e: hello from the phone', 'Mobile e2e: tighten the opening', 'Mobile e2e motion'])
      assert.ok(notes.some(x => x.includes(n)), `"${n}" reached the desktop agent (it saw: ${notes.join(' | ')})`)
    assert.deepEqual(calls, ['edit_timeline', 'rerender_timeline', 'create_clip', 'insert_clip'], 'the agent edited and made a video')
    const edited = JSON.parse(readFileSync(join(created.dir, 'project.json'), 'utf8'))
    assert.equal(edited.proposal, undefined, 'the phone decided on the proposal')
    assert.equal(edited.versions.find(v => v.id === edited.current)?.title, 'Opening tightened', 'Keep on the phone made the cut current')
    const made = readdirSync(projects).map(d => join(projects, d)).filter(d => d !== created.dir)
    assert.equal(made.length, 1, 'the idea became one new project')
    const motion = JSON.parse(readFileSync(join(made[0], 'project.json'), 'utf8'))
    assert.ok(motion.versions.some(v => v.title === 'Opening title added'), 'the motion project has the rendered title card')
    status = await win.evaluate(() => window.agentshot.mobile.status())
    assert.deepEqual(status.devices, [], 'disconnecting removed the device on the desktop')
  }
  console.log('mobile e2e: ok')
} finally {
  await app.close()
  model.close()
  if (booted) { spawnSync('adb', ['-s', device, 'emu', 'kill']); booted.kill() }
}
