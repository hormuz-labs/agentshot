// The phone companion app's server in the real app, with this script as the phone: turn on phone access, pair from the
// QR link, list projects, follow the conversation and send a message, which the window shows too, then send a clip
// into the project in sealed pieces (one tampered with, one at the wrong place), which lands in its files, its history
// and the agent's next message. Run after npm run build.
// The model key is fake, so the agent's run ends in a model error: what matters is that it reached the agent.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { aad, b64url, DEVICE_HEADER, readPairingUrl, routes, seal, SEAL_HEADER, sealBytes, unseal } from '../../src/shared/remote.ts'

const root = join(import.meta.dirname, '..', '..')
const out = mkdtempSync(join(tmpdir(), 'manul-phone-')), ud = mkdtempSync(join(tmpdir(), 'manul-ud-'))
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(out, 'ph.mp4')])
// what the phone films: a second of test pattern with a tone
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=1', '-f', 'lavfi', '-i', 'sine=d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(out, 'take.mov')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(out, 'projects') } })
const win = await app.firstWindow()
await win.waitForSelector('text=What are we making?')
await dismissOnboarding(win)
await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(out, 'ph.mp4'))
await win.click('[data-tour="import"]')
await win.locator('textarea').first().fill('Just look at it for now.')
await win.locator('button:has(svg.lucide-arrow-up)').click()
await win.waitForSelector('video')

// Settings → Phone: on, and a QR
await win.click('[aria-label="Settings"]') // the sidebar's gear
await dismissSettingsOnboarding(win)
await win.click('[data-tour="settings-phone-tab"]')
await win.click('[data-testid="phone-enable"]')
await win.waitForSelector('[data-testid="phone-qr"]')
// away from home: Tailscale, named whether or not this Mac is on it
const away = await win.locator('[data-testid="phone-away"]').innerText()
assert.match(away, /Tailscale/)
await win.screenshot({ path: join(out, 'settings-phone-qr.png') })
const { url } = await win.evaluate(() => window.manul.phone.pair())
const code = readPairingUrl(url)
assert.ok(code, 'the QR link reads as a pairing code')
assert.ok(code.hosts.length > 0)
const base = `http://127.0.0.1:${code.port}`

// pair
const paired = await fetch(base + routes.pair, { method: 'POST', body: seal(code.secret, aad.pair, { name: 'E2E phone' }) })
assert.equal(paired.status, 200)
const phone = unseal(code.secret, aad.paired, await paired.text()).value
await win.waitForSelector('text=E2E phone')

const call = async (method, path, body) => {
  const s = seal(phone.key, aad.request(method, path), body ?? null)
  const res = await fetch(base + path, { method, headers: { [DEVICE_HEADER]: phone.device, ...(method === 'GET' ? { [SEAL_HEADER]: s } : {}) }, body: method === 'POST' ? s : undefined })
  return { status: res.status, value: unseal(phone.key, aad.reply(s.split('.')[0]), await res.text()).value }
}
const projects = await call('GET', routes.projects)
assert.equal(projects.status, 200)
assert.equal(projects.value.length, 1)
assert.ok(!('dir' in projects.value[0]), 'folders stay on the Mac')
const project = projects.value[0].id

// follow the conversation, then talk to it
const path = routes.events(project)
const s = seal(phone.key, aad.request('GET', path), null)
const ctl = new AbortController()
const res = await fetch(base + path, { headers: { [DEVICE_HEADER]: phone.device, [SEAL_HEADER]: s }, signal: ctl.signal })
assert.equal(res.status, 200)
const events = []
;(async () => {
  const reader = res.body.getReader()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read().catch(() => ({ done: true }))
    if (done) return
    buf += new TextDecoder().decode(value)
    let i
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i); buf = buf.slice(i + 2)
      if (frame.startsWith('data: ')) events.push(unseal(phone.key, aad.event(s.split('.')[0], events.length), frame.slice(6)).value)
    }
  }
})()
const until = async (what, ok, ms = 30000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error(`timed out waiting for ${what}: ${events.map(e => e.type).join(', ')}`); await new Promise(r => setTimeout(r, 100)) } }
await until('the replay', () => events.some(e => e.type === 'MESSAGES_SNAPSHOT'))
// the start screen's message is still being answered (and fails: the key is fake): talk once it is done, since a message
// that arrives while a run is ending in an error may not make it into the conversation
// (a replay can start a run again without ending the one before, so: whatever was said last about runs)
const idle = () => events.filter(e => e.type === 'RUN_STARTED' || e.type === 'RUN_FINISHED').at(-1)?.type !== 'RUN_STARTED'
await until('the first run to end', idle, 60000)

assert.deepEqual(await call('POST', routes.messages(project), { text: 'Hello from the phone' }), { status: 200, value: { ok: true } })
await until('the message in the conversation', () => events.some(e => e.type === 'MESSAGES_SNAPSHOT' && e.messages.some(m => m.role === 'user' && m.content.includes('Hello from the phone'))))
await until('the run', () => events.some(e => e.type === 'RUN_STARTED'))
await win.keyboard.press('Escape')
await win.waitForSelector('text=Hello from the phone') // the window shows what the phone said
await until('the run to end', () => events.some(e => e.type === 'RUN_FINISHED'), 60000)

// a clip from the phone, in pieces of 8 KB. The agent may still be answering "Hello" (and failing: the key is fake), so
// the message that says so can arrive mid-run; it has to reach the agent all the same (agent.ts, rescue)
const take = readFileSync(join(out, 'take.mov'))
const name = 'Phone 17 Oct 14.32.mov'
const started = await call('POST', routes.uploads(project), { name, size: take.length })
assert.equal(started.status, 200)
const upload = started.value.upload
const piece = async (offset, length, tamper) => {
  const sealed = sealBytes(phone.key, aad.chunk(upload, offset), take.subarray(offset, offset + length))
  if (tamper) sealed[sealed.length - 30] ^= 1
  const res = await fetch(base + routes.chunk(upload, offset), { method: 'POST', headers: { [DEVICE_HEADER]: phone.device }, body: sealed })
  const text = await res.text()
  return { status: res.status, value: text ? unseal(phone.key, aad.reply(b64url(sealed.subarray(0, 24))), text).value : undefined }
}
const PIECE = 8192
assert.equal((await piece(0, PIECE)).value.received, PIECE)
assert.equal((await piece(PIECE, PIECE, true)).status, 401, 'a piece changed on the way is refused')
assert.deepEqual(await piece(2 * PIECE, PIECE).then(r => [r.status, r.value.received]), [409, PIECE], 'a piece in the wrong place hears where the Mac is')
// the phone drops off and comes back: it asks how much the Mac has and carries on from there
let at = (await call('GET', routes.upload(upload))).value.received
assert.equal(at, PIECE)
let landed
while (!landed) {
  const r = await piece(at, Math.min(PIECE, take.length - at))
  assert.equal(r.status, 200)
  at = r.value.received
  landed = r.value.files
}
assert.deepEqual(landed, [`media/${name}`])
const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
assert.equal(statSync(join(dir, landed[0])).size, take.length)
assert.equal(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).files[landed[0]].kind, 'video', 'in the project’s files')
const log = await win.evaluate(d => window.manul.history.log(d), dir)
assert.ok(log.some(e => e.message === `Added ${landed[0]} from E2E phone`), `in its history: ${log.map(e => e.message)}`)
await win.waitForSelector(`[data-files-tree] button[title*="${name}"], [data-files-tree] :text("${name}")`)
await win.screenshot({ path: join(out, 'phone-upload-files.png') })
// and attached to the next message, for the agent
assert.deepEqual(await call('POST', routes.messages(project), { text: 'Open with this', files: landed }), { status: 200, value: { ok: true } })
await until('the clip in the conversation', () => events.some(e => e.type === 'MESSAGES_SNAPSHOT' && e.messages.some(m => m.role === 'user' && m.content.includes('Open with this') && m.content.includes(landed[0]))))
await until('that run to end', idle, 60000)

// removing the phone ends its stream and its access
await win.click('[aria-label="Settings"]')
await win.click('[data-tour="settings-phone-tab"]')
await win.waitForSelector('text=E2E phone')
await win.screenshot({ path: join(out, 'settings-phone-paired.png') })
await win.evaluate(id => window.manul.phone.forget(id), phone.device)
await until('the stream to close', () => true)
const after = await fetch(base + routes.projects, { headers: { [DEVICE_HEADER]: phone.device, [SEAL_HEADER]: seal(phone.key, aad.request('GET', routes.projects), null) } })
assert.equal(after.status, 401)
ctl.abort()

// off: nothing listens
await win.click('[data-testid="phone-enable"]')
await assert.rejects(fetch(base + routes.projects))
console.log(`phone e2e: ok (${events.length} events, a ${take.length}-byte clip sent; screenshots in ${out})`)
await app.close()
