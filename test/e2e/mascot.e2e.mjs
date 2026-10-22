// Real renderer + real WebGL, fake AG-UI activity: no provider accounts or paid AI calls.
// npm run build && node test/e2e/mascot.e2e.mjs [screenshot folder]
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareElectron } from '../../scripts/run-electron.mjs'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-mascot-'))
const out = process.argv[2] || join(tmp, 'screenshots')
mkdirSync(out, { recursive: true })
const executablePath = await prepareElectron()
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ cwd: root, executablePath, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env })
try {
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.bringToFront()
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready'))
  const mascot = win.locator('[data-mascot-state]:visible')
  await win.waitForSelector('[data-mascot-renderer="webgl"]', { timeout: 30000 })
  const rig = () => win.locator('[data-mascot-renderer="webgl"]:visible canvas')
  const box = await mascot.boundingBox()
  await win.mouse.move(box.x - 200, box.y + box.height * .43)
  await win.evaluate(box => window.dispatchEvent(new PointerEvent('pointermove', { clientX: box.x - 200, clientY: box.y + box.height * .43 })), box)
  await win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.gazeX) < -.8)
  await mascot.screenshot({ path: join(out, 'gaze-left.png') })
  await win.mouse.move(box.x + box.width + 200, box.y + box.height * .43 + 180)
  await win.evaluate(box => window.dispatchEvent(new PointerEvent('pointermove', { clientX: box.x + box.width + 200, clientY: box.y + box.height * .43 + 180 })), box)
  await win.waitForFunction(() => {
    const canvas = document.querySelector('[data-mascot-renderer="webgl"] canvas')
    return canvas && Number(canvas.dataset.gazeX) > .8 && Number(canvas.dataset.gazeY) > .5
  })
  assert.ok(Number(await rig().getAttribute('data-gaze-y')) > .5, 'pupils follow the cursor outside the mascot')
  await mascot.screenshot({ path: join(out, 'gaze-right.png') })
  await win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.blink) > .7, { timeout: 10000 })
  await win.screenshot({ path: join(out, 'home.png') })
  await mascot.hover()
  await mascot.focus()
  await win.getByRole('button', { name: 'Raise Manul’s paw' }).click()
  await win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.paw) > .9)
  await win.waitForTimeout(120)
  await mascot.screenshot({ path: join(out, 'paw-wave-large.png') })
  const video = join(tmp, 'A little film.mp4')
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#ada48d:s=640x360:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  await app.evaluate(({ ipcMain }, video) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [video]) }, video)
  await win.click('[data-tour="import"]')
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('text=What should change?')
  await win.waitForSelector('[data-mascot-renderer="webgl"]')
  const project = await win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')
  const send = async (type, rest = {}) => app.evaluate(({ BrowserWindow }, { project, type, rest }) => {
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agui', project, { type, timestamp: Date.now(), ...rest })
  }, { project, type, rest })
  const state = async name => { await win.waitForSelector(`[data-mascot-state="${name}"]:visible`); await win.waitForSelector('[data-mascot-renderer="webgl"]:visible') }
  const running = () => win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.busyPose) > .99)
  await send('MESSAGES_SNAPSHOT', { messages: [{ id: 'u', role: 'user', content: 'Make this feel like a quiet Sunday morning.' }] })
  await send('RUN_STARTED')
  await state('thinking')
  await running()
  const gallop = await rig().evaluate(canvas => new Promise(resolve => {
    const started = performance.now()
    const frames = []
    const sample = () => {
      frames.push({ heading: Number(canvas.dataset.rotationY), legs: canvas.dataset.legAngles.split(',').map(Number), joints: canvas.dataset.jointAngles.split(',').map(Number), tail: canvas.dataset.tailWave.split(',').map(Number) })
      if (performance.now() - started < 1200) requestAnimationFrame(sample)
      else resolve(frames)
    }
    requestAnimationFrame(sample)
  }))
  assert.ok(gallop.every(frame => Math.abs(frame.heading - Math.PI / 2) < .03), 'running faces right without spinning')
  for (let leg = 0; leg < 4; leg++) {
    const angles = gallop.map(frame => frame.legs[leg])
    assert.ok(Math.max(...angles) - Math.min(...angles) > 1.5, `leg ${leg + 1} moves through a full running stride`)
    const bends = gallop.map(frame => frame.joints[leg])
    assert.ok(Math.max(...bends) - Math.min(...bends) > 1, `leg ${leg + 1} folds during recovery`)
  }
  for (const joint of [0, 6]) {
    const wave = gallop.map(frame => frame.tail[joint])
    assert.ok(Math.max(...wave) - Math.min(...wave) > .2, 'tail waves from base to tip')
  }
  await win.screenshot({ path: join(out, 'thinking.png') })
  await send('TEXT_MESSAGE_CONTENT', { messageId: 'reply', delta: 'I’ll soften the opening, let the shots breathe, and find a gentler rhythm.' })
  await state('speaking')
  await running()
  await send('TEXT_MESSAGE_END')
  const assistant = { id: 'a', role: 'assistant', content: 'I’ll soften the opening, let the shots breathe, and find a gentler rhythm.', toolCalls: [{ id: 'render', type: 'function', function: { name: 'ffmpeg', arguments: JSON.stringify({ args: ['-i', 'media/film.mp4', 'versions/sunday.mp4'] }) } }] }
  await send('MESSAGES_SNAPSHOT', { messages: [{ id: 'u', role: 'user', content: 'Make this feel like a quiet Sunday morning.' }, assistant] })
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: ['render'] } })
  await state('working')
  await running()
  await win.evaluate(() => {
    window.__catSounds = []
    const start = AudioBufferSourceNode.prototype.start
    AudioBufferSourceNode.prototype.start = function (...args) {
      const samples = this.buffer?.getChannelData(0)
      window.__catSounds.push({ duration: this.buffer?.duration, peak: samples ? Math.max(...samples.filter((_, i) => i % 20 === 0).map(Math.abs)) : 0 })
      return start.apply(this, args)
    }
  })
  assert.ok((await win.locator('[role="status"]').allTextContents()).some(s => s.includes('Rendering your edit')))
  const moving1 = await mascot.screenshot()
  await win.waitForTimeout(300)
  assert.ok(!moving1.equals(await mascot.screenshot()), 'working animates the real 3D rig')
  await win.screenshot({ path: join(out, 'working.png') })
  const question = { id: 'q', role: 'assistant', toolCalls: [{ id: 'question', type: 'function', function: { name: 'ask_user', arguments: JSON.stringify({ question: 'Which mood should the opening have?', options: [{ label: 'Gentle' }, { label: 'Bright' }] }) } }] }
  await send('MESSAGES_SNAPSHOT', { messages: [{ id: 'u', role: 'user', content: 'Make this feel like a quiet Sunday morning.' }, assistant, question] })
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: ['question'] } })
  await state('waiting')
  await win.waitForFunction(() => {
    const pose = document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset
    return Number(pose.busyPose) < .01 && Math.abs(Number(pose.rotationY)) < .25
  })
  await win.screenshot({ path: join(out, 'waiting.png') })
  await send('MESSAGES_SNAPSHOT', { messages: [{ id: 'u', role: 'user', content: 'Make this feel like a quiet Sunday morning.' }, assistant] })
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: ['render'] } })
  await state('working')
  // Real pointerdown responds before release; sample the first 180ms of the actual rig.
  const touch = await mascot.boundingBox()
  await win.mouse.move(touch.x + touch.width / 2, touch.y + touch.height / 2)
  await win.mouse.down()
  assert.equal(await mascot.getAttribute('data-mascot-reaction'), 'pet', 'pet starts on pointerdown')
  const lifts = await rig().evaluate(canvas => new Promise(resolve => {
    const started = performance.now(), samples = []
    const sample = () => {
      samples.push(Number(canvas.dataset.lift))
      if (performance.now() - started < 180) requestAnimationFrame(sample)
      else resolve(samples)
    }
    requestAnimationFrame(sample)
  }))
  assert.ok(Math.max(...lifts) > .1, 'responsive pet lifts the real cat in the first 180ms')
  await win.mouse.up()
  assert.ok((await win.evaluate(() => window.__catSounds)).some(s => s.duration > .5 && s.peak > .05), 'pet plays an actual local cat vocal buffer')
  await mascot.screenshot({ path: join(out, 'pet.png') })
  await mascot.hover()
  await win.getByRole('button', { name: 'Raise Manul’s paw' }).click()
  await win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"]:not([hidden]) canvas').dataset.paw) > .85)
  await win.waitForTimeout(150)
  await mascot.screenshot({ path: join(out, 'paw-wave.png') })
  await win.getByRole('button', { name: 'Hear Manul’s growl' }).click()
  await win.waitForFunction(() => document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.gesture === 'growl' && Number(document.querySelector('[data-mascot-renderer="webgl"] canvas').dataset.mouth) > .6)
  await mascot.screenshot({ path: join(out, 'growl.png') })
  await win.getByRole('button', { name: 'Mute mascot sounds' }).click()
  assert.equal(await win.evaluate(() => localStorage.getItem('manul.mascot.sound')), '0', 'mute preference persists')
  await win.getByRole('button', { name: 'Unmute mascot sounds' }).waitFor()
  const voiceCount = await win.evaluate(() => window.__catSounds.length)
  await win.getByRole('button', { name: 'Hear Manul’s growl' }).click()
  await win.waitForTimeout(100)
  assert.equal(await win.evaluate(() => window.__catSounds.length), voiceCount, 'muting stops new vocal playback')
  await win.mouse.move(5, 5)
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await win.waitForSelector('[data-reduced-motion="true"][data-mascot-renderer="webgl"]')
  await win.waitForTimeout(350)
  await win.waitForTimeout(600)
  const still1 = await mascot.screenshot()
  await win.waitForTimeout(450)
  const still2 = await mascot.screenshot()
  assert.ok(still1.equals(still2), 'reduced motion renders a still pose, without ongoing animation')
  assert.equal(Number(await rig().getAttribute('data-busy-pose')), 0, 'reduced motion stops the gallop')
  await win.emulateMedia({ reducedMotion: 'no-preference' })
  await state('working')
  await win.evaluate(() => document.documentElement.classList.add('dark'))
  await win.screenshot({ path: join(out, 'dark.png') })
  await win.evaluate(() => document.documentElement.classList.remove('dark'))
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: [] } })
  await send('RUN_FINISHED')
  await state('success')
  await win.screenshot({ path: join(out, 'finished.png') })
  await state('idle')
  const controls = win.locator('.manul-companion .manul-mascot-actions:visible')
  const status = win.locator('.manul-companion [role="status"]:visible')
  await controls.waitFor()
  const controlBox = await controls.boundingBox(), statusBox = await status.boundingBox()
  assert.ok(controlBox.y >= statusBox.y + statusBox.height, 'interaction controls sit below the status')
  assert.ok(Math.abs(controlBox.x - statusBox.x) < 2, 'interaction controls align with status text')
  assert.equal(await controls.getByRole('button').count(), 3, 'paw, growl and sound form one visible action row')
  assert.equal((await controls.textContent()).trim(), '', 'controls use SVG icons without visible labels')
  const copyBox = await win.locator('.manul-companion-copy:visible').boundingBox()
  const mascotBox = await mascot.boundingBox()
  assert.ok(copyBox.height <= mascotBox.height && copyBox.y >= mascotBox.y && copyBox.y + copyBox.height <= mascotBox.y + mascotBox.height, 'all three rows fit inside the mascot height')
  assert.ok(controlBox.height <= 24, 'interaction icons stay compact')
  await win.screenshot({ path: join(out, 'chat-controls-light.png') })
  await win.evaluate(() => document.documentElement.classList.add('dark'))
  await win.waitForTimeout(200)
  await win.screenshot({ path: join(out, 'chat-controls-dark.png') })
  await win.evaluate(() => document.documentElement.classList.remove('dark'))
  await win.mouse.move(5, 5)
  await win.bringToFront()
  await win.waitForSelector('[data-mascot-state="sleeping"]:visible', { timeout: 45000 })
  await mascot.click()
  await state('idle')
  await send('RUN_ERROR', { message: 'The provider is temporarily unavailable. Please try again.' })
  await state('error')
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await win.waitForSelector('text=What are we making?')
  assert.equal(await win.locator('[data-mascot-renderer="webgl"]').count(), 1, 'hidden project releases its WebGL context')
  await win.locator('[data-project-row]').first().click()
  await state('error')
  assert.equal(await win.locator('[data-mascot-renderer="webgl"]').count(), 1, 'returning to a project restores just its companion')
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await win.waitForSelector('[data-mascot-renderer="webgl"]:visible')
  await mascot.focus()
  await win.keyboard.press('Enter')
  assert.ok(await mascot.getAttribute('aria-label'), 'the pet interaction is keyboard accessible')
  await win.evaluate(() => {
    const canvas = document.querySelector('[data-mascot-renderer="webgl"] canvas')
    canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()
  })
  await win.waitForSelector('[data-mascot-renderer="fallback"]:visible')
  assert.equal(await mascot.locator('img.manul-mascot-fallback').count(), 1, 'the full-body brand portrait survives WebGL context loss')
  await win.mouse.move(1000, 500)
  assert.notEqual(await mascot.evaluate(el => el.style.getPropertyValue('--cat-gaze-x')), '0px', 'fallback portrait still reacts to the cursor')
  assert.deepEqual(errors, [], 'no renderer exceptions')
  console.log('mascot e2e: ok —', out)
} finally {
  await app.close()
  // Keep the screenshots for visual review; disposable app data never touches the real user profile.
  rmSync(join(tmp, 'ud'), { recursive: true, force: true })
  rmSync(join(tmp, 'projects'), { recursive: true, force: true })
}
