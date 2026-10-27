// Saying a note in the chat box: the mic beside Send records (a stand-in microphone plays a recording), this computer
// hears it, and the words land in the box to look over before sending. Without speech recognition it asks first (as the
// phone's voice notes do); not now, and the box says the note didn't come through, ready to try again.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..'), tmp = mkdtempSync(join(tmpdir(), 'agentshot-voice-e2e-'))
const ff = (...args) => execFileSync(bundledBinary('ffmpeg'), ['-y', '-v', 'error', ...args])
ff('-f', 'lavfi', '-i', 'color=c=teal:s=640x360:r=25:d=4', '-c:v', 'libx264', join(tmp, 'clip.mp4'))
ff('-f', 'lavfi', '-i', 'sine=frequency=440:d=20:sample_rate=16000', join(tmp, 'said.wav'))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$|ELECTRON_RUN_AS_NODE/.test(k)))
const app = await electron.launch({
  cwd: root,
  args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${join(tmp, 'said.wav')}`],
  env: { ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'projects') },
})
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [file]) }, join(tmp, 'clip.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready')
  })
  const composer = win.locator('[data-tour="composer"]')
  const mic = composer.locator('[data-voice-mic]')
  let step = 0
  const seen = (l, o) => l.waitFor(o).catch(async e => { await win.screenshot({ path: join(process.env.VOICE_SHOTS || tmp, `voice-fail-${step}.png`) }); throw new Error(`step ${step}: ${e.message.split('\n')[0]}`) })
  const box = composer.locator('textarea')

  // an empty box offers the mic, not Send (the imported clip comes attached: take it off); typing brings Send back
  await composer.locator('button[aria-label^="Remove "]').first().click()
  step++; await seen(mic)
  assert.equal(await composer.getByRole('button', { name: 'Send', exact: true }).count(), 0)
  await box.fill('x')
  await composer.getByRole('button', { name: 'Send', exact: true }).waitFor()
  await box.fill('')
  step++; await seen(mic)

  await composer.screenshot({ path: join(process.env.VOICE_SHOTS || tmp, 'voice-mic.png') })
  // a click talks hands-free: the strip shows it listening; Esc throws the note away, nothing heard
  let heard = 0
  await mic.click()
  await composer.locator('[data-voice-recording]').waitFor()
  await win.waitForTimeout(800)
  await win.keyboard.press('Escape')
  await composer.locator('[data-voice-recording]').waitFor({ state: 'detached' })
  step++; await seen(mic)

  // held: talk, let go, and this computer hears it. A tone has no words: either speech recognition isn't here yet
  // and it asks to download it (not now), or it hears nothing. Both say so plainly, with Try again
  const at = await mic.boundingBox()
  await win.mouse.move(at.x + at.width / 2, at.y + at.height / 2)
  await win.mouse.down()
  await composer.locator('[data-voice-recording]').waitFor()
  await win.waitForTimeout(1500)
  await composer.screenshot({ path: join(process.env.VOICE_SHOTS || tmp, 'voice-recording.png') })
  await win.mouse.up()
  const problem = composer.locator('[data-voice-problem]')
  const notNow = win.getByRole('button', { name: 'Not now', exact: true }).first()
  await problem.or(notNow).first().waitFor({ timeout: 60000 }).catch(async e => { await win.screenshot({ path: join(process.env.VOICE_SHOTS || tmp, 'voice-fail.png') }); throw e })
  if (await notNow.isVisible()) await notNow.click()
  await problem.waitFor({ timeout: 30000 })
  assert.match(await problem.innerText(), /Couldn’t hear your voice note|Nothing was heard/)
  await problem.getByText('Try again').waitFor()

  // with speech recognition, the words land in the box (after what's typed), ready to send
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('voice:note')
    globalThis.__heard = []
    ipcMain.handle('voice:note', (_e, _dir, audio) => { globalThis.__heard.push(audio.length); return 'Tighten the opening' })
  })
  await problem.getByText('Try again').click()
  await problem.waitFor({ state: 'detached' })
  await win.waitForFunction(() => document.querySelector('[data-tour="composer"] textarea')?.value === 'Tighten the opening')
  heard = await app.evaluate(() => globalThis.__heard[0])
  assert.ok(heard > 1000, `the recording reached the computer (${heard} bytes)`)
  // the words are there to look over: Send takes the mic's place
  await composer.getByRole('button', { name: 'Send', exact: true }).waitFor()
  // hands-free again (cleared first): a click, then the tick
  await box.fill('')
  step++; await seen(mic)
  await mic.click()
  await composer.locator('[data-voice-recording]').waitFor()
  await win.waitForTimeout(1000)
  await composer.getByRole('button', { name: 'Done talking', exact: true }).click()
  await win.waitForFunction(() => document.querySelector('[data-tour="composer"] textarea')?.value === 'Tighten the opening')
  assert.equal(await app.evaluate(() => globalThis.__heard.length), 2)
  await win.screenshot({ path: join(process.env.VOICE_SHOTS || tmp, 'voice-done.png') })
  console.log('voice e2e ok')
} finally {
  await app.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
