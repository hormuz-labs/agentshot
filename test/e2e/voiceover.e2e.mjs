// Real microphone capture, main-process authorization, durable takes, editable preview and rendered audio.
import { _electron as electron } from 'playwright-core'
import { createServer } from 'node:http'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { dismissOnboarding } from './onboarding.mjs'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '../..'), tmp = mkdtempSync(join(tmpdir(), 'agentshot-voiceover-e2e-'))
const ffmpeg = bundledBinary('ffmpeg')
const ff = (...args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args])
ff('-f', 'lavfi', '-i', 'color=c=teal:s=640x360:r=25:d=8', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=8', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(tmp, 'clip.mp4'))
ff('-f', 'lavfi', '-i', 'sine=frequency=1000:d=20:sample_rate=48000', join(tmp, 'said.wav'))
let paid = false
const server = createServer((req, res) => {
  assert.equal(req.headers.authorization, 'Bearer test-voiceover-key')
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ credits: 0, plan: paid ? { key: 'pro', name: 'Pro', until: '2099-01-01', renews: true } : null, tiers: [], plans: [], topups: [] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const ud = join(tmp, 'ud'); mkdirSync(ud)
writeFileSync(join(ud, 'config.json'), JSON.stringify({ account: { email: 'test@example.com', keyId: 'test-key' }, accountPhones: false }))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$|ELECTRON_RUN_AS_NODE|MANUL_KEY|MANUL_LOCAL_PRO/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(tmp, 'said.wav')}`], env: { ...env, MANUL_KEY: 'test-voiceover-key', MANUL_ACCOUNT: `http://127.0.0.1:${server.address().port}`, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1500, height: 1000 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [file]) }, join(tmp, 'clip.mp4'))
  await win.click('[data-tour="import"]'); await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('[data-project-title]')
  const dir = await win.locator('[data-project-title]').getAttribute('title')
  await win.getByRole('button', { name: 'Voiceover PRO', exact: true }).click()
  await win.getByRole('dialog', { name: 'Voiceover is a premium feature' }).waitFor()
  assert.equal(await win.getByRole('button', { name: 'Check access', exact: true }).count(), 0)
  assert.equal(await win.getByRole('button', { name: 'Sign in', exact: true }).count(), 0, 'signed-in people are not asked to sign in again')
  const denied = await win.evaluate(async dir => { try { await window.agentshot.voiceover.begin(dir, 0); return false } catch { return true } }, dir)
  assert.equal(denied, true, 'premium is enforced by main process')
  paid = true
  await win.evaluate(() => window.dispatchEvent(new Event('focus')))
  // Electron's file-backed fake microphone is silent on some macOS builds. Supply a deterministic
  // Web Audio microphone instead; MediaRecorder, IPC, conversion and rendering remain real.
  await win.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(), oscillator = ctx.createOscillator(), output = ctx.createMediaStreamDestination()
      oscillator.frequency.value = 1000; oscillator.connect(output); oscillator.start(); await ctx.resume()
      const track = output.stream.getAudioTracks()[0], stop = track.stop.bind(track)
      track.stop = () => { stop(); oscillator.stop(); void ctx.close() }
      globalThis.__voiceoverStream = output.stream
      return output.stream
    }
  })
  await win.getByRole('button', { name: 'Record voiceover', exact: true }).click()
  await win.getByRole('button', { name: 'Stop & add to video', exact: true }).waitFor()
  await win.waitForFunction(() => (document.querySelector('[data-tour="timeline"] [data-live-audio-lane] [data-waveform-envelope]')?.getAttribute('d').match(/Q/g)?.length || 0) >= 80)
  await win.getByRole('button', { name: 'Pause voiceover', exact: true }).click()
  await win.getByRole('button', { name: 'Resume voiceover', exact: true }).waitFor()
  const pausedState = () => win.evaluate(() => ({
    seconds: Number(document.querySelector('[data-recording-seconds]').getAttribute('data-recording-seconds')),
    waveform: document.querySelector('[data-live-audio-lane] [data-waveform-envelope]').getAttribute('d'),
    playhead: document.querySelector('[data-timeline-playhead]').style.left,
  }))
  const paused = await pausedState()
  assert.equal(await win.evaluate(() => globalThis.__voiceoverStream.getAudioTracks().every(t => !t.enabled)), true)
  // Observe a real pause interval: neither picture, elapsed time nor waveform should advance.
  await win.waitForTimeout(1200)
  assert.deepEqual(await pausedState(), paused)
  await win.getByRole('button', { name: 'Resume voiceover', exact: true }).click()
  await win.waitForFunction(before => Number(document.querySelector('[data-recording-seconds]')?.getAttribute('data-recording-seconds')) > before + .5, paused.seconds)
  assert.equal(await win.evaluate(() => globalThis.__voiceoverStream.getAudioTracks().every(t => t.enabled)), true)
  assert.notEqual((await pausedState()).playhead, paused.playhead)
  // Stop also saves correctly while paused, excluding the paused interval from the take.
  await win.getByRole('button', { name: 'Pause voiceover', exact: true }).click()
  const recordedSeconds = (await pausedState()).seconds
  await win.getByRole('button', { name: 'Stop & add to video', exact: true }).click()
  await win.locator('[data-voiceover-tracks]').waitFor({ timeout: 30000 })
  await win.getByRole('status').filter({ hasText: 'Voiceover added' }).waitFor()
  let p = await win.evaluate(dir => window.agentshot.project.open(dir), dir)
  assert.equal(p.voiceovers.length, 1)
  const asset = p.voiceovers[0], conversation = p.conversation
  assert.equal(asset.conversation, conversation)
  assert.ok(asset.duration > 1)
  assert.ok(Math.abs(asset.duration - recordedSeconds) < .4, `saved duration ${asset.duration} excludes pause; active duration ${recordedSeconds}`)
  assert.equal(await win.evaluate(() => globalThis.__voiceoverStream.getTracks().every(t => t.readyState === 'ended')), true)
  assert.equal(p.files[asset.src].kind, 'audio')
  assert.ok(asset.peaks.some(v => v > .01), `waveform records real input: ${JSON.stringify(asset.peaks)}`)
  assert.equal(p.timeline.mix.voiceovers.length, 1)
  // Voice is an audio lane directly under the video, in the same scrolling/zooming timeline.
  const timeline = win.locator('[data-tour="timeline"]')
  const videoLane = timeline.getByTestId('timeline-scrubber'), audioLane = timeline.locator('[data-audio-lane]').first()
  const assertLanes = async () => {
    const video = await videoLane.boundingBox(), audio = await audioLane.boundingBox(), head = await timeline.locator('[data-timeline-playhead]').boundingBox()
    assert.ok(Math.abs(video.x - audio.x) < 2 && Math.abs(video.width - audio.width) < 2, 'audio/video share a time scale')
    assert.ok(audio.y >= video.y + video.height && audio.y - video.y - video.height <= 8, 'audio is immediately below video')
    assert.ok(head.y <= video.y && head.y + head.height >= audio.y + audio.height, 'one playhead crosses both lanes')
  }
  await assertLanes()
  assert.equal(await timeline.locator('[data-voiceover-controls]').count(), 0, 'audio controls stay hidden until a clip is selected')
  await videoLane.hover()
  await win.keyboard.down('Control'); await win.mouse.wheel(0, -100); await win.keyboard.up('Control')
  await win.waitForFunction(() => document.querySelector('[data-testid="timeline-scale"]')?.textContent.includes('visible'))
  await assertLanes()
  await timeline.getByRole('button', { name: 'Fit timeline', exact: true }).click()
  // Drag the waveform itself to move it; one undo restores the take.
  const audioClip = timeline.locator('[data-voiceover-clip]').first()
  // Select first so the inspector opening cannot shift the scroll viewport during the drag.
  await audioClip.click()
  await timeline.locator('[data-voiceover-controls]').waitFor()
  await audioClip.scrollIntoViewIfNeeded()
  const clipBox = await audioClip.boundingBox(), laneBox = await audioLane.boundingBox()
  await win.mouse.move(clipBox.x + 20, clipBox.y + 30); await win.mouse.down()
  await win.mouse.move(clipBox.x + 20 + laneBox.width / 8, clipBox.y + 30, { steps: 8 }); await win.mouse.up()
  await win.waitForFunction(() => Number(document.querySelector('[aria-label="Voiceover start seconds"]')?.value) > .8)
  await win.evaluate(dir => window.agentshot.timeline.undo(dir), dir)
  await win.locator('[data-conversation-voiceovers]').waitFor()
  const composer = win.locator('[data-tour="composer"]'), box = composer.locator('textarea')
  assert.ok(await composer.innerText().then(t => t.includes('Voiceover 01')), 'recording attached with a readable take name')
  // Mention action focuses the composer, inserts the readable reference and attaches the exact source once.
  await composer.getByRole('button', { name: 'Remove Voiceover 01', exact: true }).click()
  await timeline.getByRole('button', { name: 'Mention voiceover in chat', exact: true }).click()
  assert.equal(await box.inputValue(), '@Voiceover 01 ')
  await win.waitForFunction(() => document.activeElement === document.querySelector('[data-tour="composer"] textarea'))
  assert.equal(await composer.getByRole('button', { name: 'Remove Voiceover 01', exact: true }).count(), 1)
  await timeline.getByRole('button', { name: 'Mention voiceover in chat', exact: true }).click()
  assert.equal(await box.inputValue(), '@Voiceover 01 ')
  // The @ picker finds the same take and preserves its real file identity through Send.
  await composer.getByRole('button', { name: 'Remove Voiceover 01', exact: true }).click()
  await box.fill('@voiceover')
  await win.locator('[data-mentions] [role="option"]').filter({ hasText: 'Voiceover 01' }).click()
  assert.equal(await box.inputValue(), '@Voiceover 01 ')
  await box.fill('@Voiceover 01 make this quieter')
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('agent:send')
    ipcMain.handle('agent:send', (_e, dir, msg) => { globalThis.__voiceMention = { dir, msg } })
  })
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
  const sent = await app.evaluate(() => globalThis.__voiceMention)
  assert.equal(sent.dir, dir)
  assert.equal(sent.msg.text, '@Voiceover 01 make this quieter')
  assert.equal(sent.msg.files.filter(src => src === asset.src).length, 1)
  assert.equal(await audioClip.locator('svg[aria-label="Recorded audio waveform"] rect').count(), 0, 'waveform is continuous rather than blocks')
  await audioClip.locator('[data-waveform-envelope]').waitFor()
  if (process.env.VOICEOVER_SHOT) await timeline.screenshot({ path: process.env.VOICEOVER_SHOT })
  // Move, undo, redo and render through the actual main-process path.
  p = await win.evaluate(async ({ dir, asset }) => window.agentshot.timeline.edit(dir, [{ op: 'voiceover', id: asset.id, track: { id: asset.id, src: asset.src, start: 2, in: 0, out: 1, db: 0 } }]), { dir, asset })
  assert.equal(p.timeline.mix.voiceovers[0].start, 2)
  p = await win.evaluate(dir => window.agentshot.timeline.undo(dir), dir)
  assert.equal(p.timeline.mix.voiceovers[0].start, 0)
  await win.evaluate(dir => window.agentshot.timeline.undo(dir, true), dir)
  const version = await win.evaluate(dir => window.agentshot.timeline.render(dir), dir)
  p = await win.evaluate(dir => window.agentshot.project.open(dir), dir)
  const output = join(dir, p.versions.find(v => v.id === version).path)
  const db = at => {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-ss', String(at), '-t', '0.4', '-i', output, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
    return Number(/mean_volume: (-?[\d.]+) dB/.exec(r.stderr)[1])
  }
  assert.ok(db(2.3) - db(.5) > 15, 'recorded voice is audible at its edited start')
  assert.ok(db(2.3) - db(4) > 15, 'recorded voice stops after its trim')
  await win.evaluate(dir => window.agentshot.agent.newConversation(dir), dir)
  await win.locator('[data-conversation-voiceovers]').waitFor({ state: 'detached' })
  await win.evaluate(({ dir, conversation }) => window.agentshot.agent.switchConversation(dir, conversation), { dir, conversation })
  await win.locator('[data-conversation-voiceovers]').waitFor()
  await win.reload()
  await win.locator('[data-conversation-voiceovers]').waitFor()
  await win.locator('[data-voiceover-tracks]').waitFor()
  // Cancelling releases the microphone and does not add another take.
  await win.evaluate(() => {
    globalThis.__voiceoverStream = null
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(), output = ctx.createMediaStreamDestination(), oscillator = ctx.createOscillator()
      oscillator.connect(output); oscillator.start(); await ctx.resume()
      globalThis.__voiceoverStream = output.stream
      return output.stream
    }
  })
  await win.getByRole('button', { name: 'Voiceover PRO', exact: true }).click()
  await win.getByRole('button', { name: 'Record voiceover', exact: true }).click()
  await win.getByRole('button', { name: 'Pause voiceover', exact: true }).click()
  await win.getByRole('button', { name: 'Discard', exact: true }).click()
  await win.waitForFunction(() => globalThis.__voiceoverStream?.getTracks().every(t => t.readyState === 'ended'))
  await win.getByRole('button', { name: 'Close voiceover', exact: true }).click()
  p = await win.evaluate(dir => window.agentshot.project.open(dir), dir)
  assert.equal(p.voiceovers.length, 1)
  // Exercise the modal's sign-in and browser checkout handoffs without opening an external account.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__signedIn = false; globalThis.__paid = false; globalThis.__signIns = 0; globalThis.__checkouts = 0
    for (const channel of ['account:status', 'account:signIn', 'account:checkout', 'voiceover:access']) ipcMain.removeHandler(channel)
    ipcMain.handle('account:status', () => ({ available: true, email: globalThis.__signedIn ? 'test@example.com' : undefined }))
    ipcMain.handle('voiceover:access', () => globalThis.__paid)
    ipcMain.handle('account:signIn', async () => { globalThis.__signIns++; await new Promise(resolve => setTimeout(resolve, 500)); globalThis.__signedIn = true; return { available: true, email: 'test@example.com' } })
    ipcMain.handle('account:checkout', () => { globalThis.__checkouts++; setTimeout(() => { globalThis.__paid = true }, 500) })
  })
  await win.getByRole('button', { name: 'Voiceover PRO', exact: true }).click()
  const modal = win.getByRole('dialog', { name: 'Voiceover is a premium feature' })
  await modal.waitFor()
  await modal.getByRole('button', { name: 'Sign in', exact: true }).click()
  await modal.getByRole('status').filter({ hasText: 'Finish signing in' }).waitFor()
  assert.equal(await modal.getByRole('button', { name: 'Sign in', exact: true }).isDisabled(), true)
  await modal.getByRole('button', { name: 'Sign in', exact: true }).waitFor({ state: 'detached' })
  await modal.getByRole('button', { name: 'Upgrade to Pro', exact: true }).click()
  await win.getByRole('button', { name: 'Record voiceover', exact: true }).waitFor({ timeout: 10000 })
  assert.deepEqual(await app.evaluate(() => [globalThis.__signIns, globalThis.__checkouts]), [1, 1])
  assert.equal(await win.getByRole('button', { name: 'Check access', exact: true }).count(), 0)
  await win.getByRole('button', { name: 'Close voiceover', exact: true }).click()
  // An existing subscriber signing in unlocks automatically, without being sent to checkout.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__signedIn = false; globalThis.__paid = false
    ipcMain.removeHandler('account:signIn')
    ipcMain.handle('account:signIn', () => { globalThis.__signedIn = true; globalThis.__paid = true; return { available: true, email: 'test@example.com' } })
  })
  await win.getByRole('button', { name: 'Voiceover PRO', exact: true }).click()
  await modal.getByRole('button', { name: 'Sign in', exact: true }).click()
  await win.getByRole('button', { name: 'Record voiceover', exact: true }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.__checkouts), 1)
  console.log('voiceover e2e ok: premium gate, recording, pause/resume/stop, waveform, mentions, files, undo, render, conversation and reload')
} finally {
  await app.close()
  await new Promise(resolve => server.close(resolve))
  rmSync(tmp, { recursive: true, force: true })
}
