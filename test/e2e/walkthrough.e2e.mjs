// Product walkthrough, end to end in the real app with no paid model or voice: asking for one on the start screen
// (no switch: the request says it) makes the project; a scripted model (a local OpenAI-compatible server added as a custom provider) has the agent
// open a test product with bsk in Manul's own browser, film one take with walkthrough_record (a click, visible typing,
// a smooth scroll), stop it, and compose_walkthrough the film without narration. Checks the take's events, the
// proposed film and its frames.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync('/tmp/mw-') // short: the bsk daemon's socket path must stay under macOS's limit
const ud = join(tmp, 'ud'), projects = join(tmp, 'p'), out = process.argv.slice(2).find(a => !a.startsWith('--')) || tmp
mkdirSync(ud, { recursive: true })
// Two ways, both with the real bsk: Manul's own browser (CDP screencast), or with --chrome the way the user's own Chrome
// is filmed when its remote debugging is off: the agent on chrome-bsk, filmed through bsk's screenshots. Manul's browser
// stands in for that Chrome (MANUL_CHROME_BSK_HOME points chrome-bsk at Manul's bsk daemon).
const shots = process.argv.includes('--chrome')
const cli = shots ? 'chrome-bsk' : 'bsk'
const until = async (what, fn, ms = 60_000) => {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise(r => setTimeout(r, 300))
  }
}

// the product: a form with a field and a slow Save, and a long list below
const product = `<!doctype html><title>Acme Boards</title><style>body{font:18px system-ui;margin:40px}input{font:inherit;padding:8px;width:360px}
button{font:inherit;padding:8px 16px;background:#2266ff;color:#fff;border:0;border-radius:6px}li{padding:14px 0;border-bottom:1px solid #ddd}</style>
<h1>Acme Boards</h1><p><input id="name" placeholder="Board name"> <button id="save" onclick="setTimeout(()=>{document.getElementById('done').textContent='Saved '+document.getElementById('name').value},600)">Save</button></p>
<p id="done"></p><ul>${Array.from({ length: 60 }, (_, i) => `<li>Card ${i + 1}</li>`).join('')}</ul>`
const site = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(product) }).listen(0, '127.0.0.1')
await new Promise(r => site.once('listening', r))
const url = `http://127.0.0.1:${site.address().port}/`

// the scripted model: each request gets the next tool call, from what the earlier ones returned
const results = body => body.messages.filter(m => m.role === 'tool').map(m => typeof m.content === 'string' ? m.content : (m.content || []).map(c => c.text || '').join(''))
const script = [
  () => ['bash', { command: `${cli} session start --json` }],
  r => ['bash', { command: `${cli} navigate ${url} --session ${session(r)}` }],
  r => ['walkthrough_record', { action: 'start', session: session(r) }],
  () => ['walkthrough_record', { action: 'step', title: 'Name the board' }],
  r => ['bash', { command: `${cli} click "#name" --session ${session(r)}` }],
  () => ['walkthrough_record', { action: 'type', text: 'Roadmap', cps: 12 }],
  () => ['bash', { command: 'sleep 6' }], // the agent thinking: cut from the film
  () => ['walkthrough_record', { action: 'step', title: 'Save it' }],
  r => ['bash', { command: `${cli} click "#save" --session ${session(r)}` }],
  () => ['bash', { command: 'sleep 1.5' }],
  () => ['walkthrough_record', { action: 'pause' }], // e.g. a sign-in: never in the film
  () => ['bash', { command: 'sleep 2' }],
  () => ['walkthrough_record', { action: 'resume' }],
  () => ['walkthrough_record', { action: 'step', title: 'Browse the cards' }],
  () => ['walkthrough_record', { action: 'scroll', dy: 900 }], // smooth on film (bsk wheel jumps in one frame)
  r => ['bash', { command: `${cli} scroll-to "li:nth-child(55)" --session ${session(r)}` }],
  () => ['bash', { command: 'sleep 1' }],
  () => ['walkthrough_record', { action: 'stop' }],
  r => ['compose_walkthrough', { take: /Take (w[a-z0-9]+)/.exec(r.join('\n'))[1], narration: ['', '', ''], title: 'Walkthrough e2e' }],
]
const session = r => { for (const t of r) { const m = /"session_id"\s*:\s*"([^"]+)"/.exec(t); if (m) return m[1] } throw new Error(`no session in ${r[0]}`) }
const calls = []
const model = createServer(async (req, res) => {
  let raw = ''
  for await (const c of req) raw += c
  if (!req.url.endsWith('/chat/completions')) { res.statusCode = 404; return res.end() }
  const body = JSON.parse(raw), r = results(body), next = script[r.length]
  const chunk = delta => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'scripted', choices: [{ index: 0, ...delta }] })}\n\n`
  res.setHeader('content-type', 'text/event-stream')
  if (next) {
    const [name, args] = next(r)
    calls.push(name)
    res.write(chunk({ delta: { role: 'assistant', tool_calls: [{ index: 0, id: `call_${r.length}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }, finish_reason: null }))
    res.write(chunk({ delta: {}, finish_reason: 'tool_calls' }))
  } else {
    res.write(chunk({ delta: { role: 'assistant', content: 'The walkthrough is ready.' }, finish_reason: null }))
    res.write(chunk({ delta: {}, finish_reason: 'stop' }))
  }
  res.end('data: [DONE]\n\n')
}).listen(0, '127.0.0.1')
await new Promise(r => model.once('listening', r))
writeFileSync(join(ud, 'providers.json'), JSON.stringify([{ id: 'scripted', name: 'Scripted', baseUrl: `http://127.0.0.1:${model.address().port}/v1`, api: 'openai-completions', models: [{ id: 'scripted-agent' }] }]))

const env = { ...process.env, MANUL_PROJECTS: projects, MANUL_PROVIDER_SCRIPTED_KEY: 'sk-scripted', ...(shots ? { MANUL_CHROME_BSK_HOME: join(ud, 'bsk') } : {}) }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MANUL_KEY']) delete env[k]
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env })
const logs = []
for (const s of [app.process().stdout, app.process().stderr]) s?.on('data', d => logs.push(String(d)))
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.fill('[data-tour="start-prompt"]', `Show how to make a board in ${url}`)
  await win.waitForSelector('[data-walkthrough]') // what will happen, said under the box
  await win.screenshot({ path: join(out, 'walkthrough-start.png') })
  assert.equal(await win.locator('[role="radiogroup"][aria-label="Format"]').count(), 0, 'no format to choose for a walkthrough')
  await win.keyboard.press('Enter')

  const dir = await until('the project', () => existsSync(projects) && readdirSync(projects).map(d => join(projects, d)).find(d => existsSync(join(d, 'project.json'))))
  const project = () => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.ok(project().walkthrough?.canvas, 'a walkthrough project')
  if (!shots) { // the Browser panel says it is filming (the bsk path films the user's Chrome, not this panel)
    await win.waitForSelector('[data-recording]', { timeout: 60_000 })
    await win.screenshot({ path: join(out, 'walkthrough-recording.png') })
  }
  const p = await until('the proposed walkthrough', () => { const x = project(); return x.proposal && x.versions.find(v => v.id === x.proposal)?.title === 'Walkthrough e2e' ? x : null }, 180_000)
  await win.screenshot({ path: join(out, 'walkthrough-proposed.png') })
  assert.equal(await win.locator('[data-recording]').count(), 0, 'not recording any more')

  // the take: real events from the page, three steps, the thinking time inside it
  const takeId = readdirSync(join(dir, 'walkthroughs'))[0]
  const take = JSON.parse(readFileSync(join(dir, 'walkthroughs', takeId, 'take.json'), 'utf8'))
  assert.deepEqual(take.steps.map(s => s.title), ['Name the board', 'Save it', 'Browse the cards'])
  const kinds = new Set(take.events.map(e => e.k))

  // CDP screencast: 1280×720 at 2×. Through bsk: no emulation (it would flash the window), the window's own size and scale
  if (shots) assert.ok(take.width >= 640 && Math.abs(take.width / take.viewport.width - take.height / take.viewport.height) < 0.05, `frames ${take.width}×${take.height}`)
  else assert.deepEqual([take.width, take.height], [2560, 1440])
  // through bsk, typing goes in as text (input events, no key presses)
  for (const k of ['down', 'click', 'input', 'wheel', 'scroll', ...(shots ? [] : ['key'])]) assert.ok(kinds.has(k), `the take saw a ${k} (${[...kinds]})`)
  assert.equal(take.paused.length, 1, 'one paused stretch')
  assert.ok(take.paused[0].e - take.paused[0].s > 1.5, 'the pause lasted')
  const typed = take.events.filter(e => e.k === 'input')
  assert.ok(typed.length >= 7 && typed.at(-1).t - typed[0].t > 0.3, 'typed a key at a time')

  // bsk's overlay (its glow and "Agent controlling" pill) is never filmed, and comes back after the take
  const end = join(out, 'walkthrough-take-end.png')
  execFileSync(bundledBinary('ffmpeg'), ['-v', 'error', '-y', '-sseof', '-0.3', '-i', join(dir, take.video), '-frames:v', '1', '-vf', 'crop=iw:ih/8:0:ih*7/8,scale=64:8,format=rgb24', '-f', 'rawvideo', end])
  const px = readFileSync(end)
  let orange = 0
  for (let i = 0; i < px.length; i += 3) if (px[i] > 200 && px[i + 1] > 90 && px[i + 1] < 190 && px[i + 2] < 90) orange++
  assert.equal(orange, 0, 'no bsk pill or glow in the take')
  // it scrolled: the last frame no longer shows the form at the top
  const top = join(out, 'walkthrough-take-top.png')
  execFileSync(bundledBinary('ffmpeg'), ['-v', 'error', '-y', '-sseof', '-0.3', '-i', join(dir, take.video), '-frames:v', '1', '-vf', 'scale=960:-1', top])

  // the film: 1080p, shorter than the take (the sleeps are cut), and it shows the page
  const film = join(dir, p.versions.find(v => v.id === p.proposal).path)
  const info = JSON.parse(execFileSync(bundledBinary('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', film], { encoding: 'utf8' }))
  const v = info.streams.find(s => s.codec_type === 'video')
  // the take's shape, its long side at most 1920 (1080p for a 1280×720 page; the stand-in panel keeps its own shape)
  if (shots) assert.ok(Math.max(v.width, v.height) <= 1920 && Math.abs(v.width / v.height - take.width / take.height) < 0.02, `film ${v.width}×${v.height}`)
  else { assert.equal(v.width, 1920); assert.equal(v.height, 1080) }
  const seconds = Number(info.format.duration)
  assert.ok(seconds > 2 && seconds < take.duration - 2, `the film (${seconds} s) is shorter than the take (${take.duration} s)`)
  for (const f of [0.3, 0.5, 0.8]) execFileSync(bundledBinary('ffmpeg'), ['-v', 'error', '-y', '-ss', String(seconds * f), '-i', film, '-frames:v', '1', join(out, `walkthrough-${f}.png`)])
  const mean = execFileSync(bundledBinary('ffmpeg'), ['-v', 'error', '-i', film, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(!/YAVG=(0|1)\./.test(mean), 'no black frames')
  assert.deepEqual(calls.filter(c => c !== 'bash'), [...Array(9).fill('walkthrough_record'), 'compose_walkthrough'])
  console.log(`walkthrough e2e ok: take ${take.duration.toFixed(1)} s → film ${seconds.toFixed(1)} s, ${take.events.length} events; frames in ${out}`)
} finally {
  writeFileSync(join(out, 'main.log'), logs.join(''))
  await app.close().catch(() => {})
  site.close(); model.close()
}
