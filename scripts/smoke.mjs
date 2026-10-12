// Smoke test: launch the built app, open a generated test video, take screenshots of each screen.
// Usage: npm run build && node scripts/smoke.mjs [out-dir] ["prompt for the agent"]
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from '../test/e2e/onboarding.mjs'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const FFMPEG = join(import.meta.dirname, '..', 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const out = process.argv[2] || join(tmpdir(), 'manul-smoke')
const prompt = process.argv[3]
mkdirSync(out, { recursive: true })
const userData = mkdtempSync(join(tmpdir(), 'manul-ud-'))
const video = join(out, 'test-clip.mp4')
// speech with fillers when macOS `say` exists (so the transcript and "cut the ums" can be exercised), else a tone
let audio = ['-f', 'lavfi', '-i', 'sine=frequency=330:duration=12']
try {
  execFileSync('say', ['-o', join(out, 'speech.aiff'), 'Um, hello there. Uh, today we are, um, testing the Manul video editor. Uh, it should cut these fillers.'])
  audio = ['-i', join(out, 'speech.aiff')]
} catch { /* not macOS */ }
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12',
  ...audio, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video])

const app = await electron.launch({ args: ['.', `--user-data-dir=${userData}`], env: { ...process.env, MANUL_PROJECTS: join(out, 'projects') } })
const win = await app.firstWindow()
win.on('console', m => { if (m.type() === 'error') console.log('console error:', m.text()) })
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
await win.waitForSelector('text=What are we making?')
await dismissOnboarding(win)
await win.screenshot({ path: join(out, '1-start.png') })

// pick the file through the app's own IPC (the native dialog can't be driven), then send the prompt
await win.evaluate(async ([file, prompt]) => {
  const ta = document.querySelector('textarea')
  if (prompt && ta) { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, prompt); ta.dispatchEvent(new Event('input', { bubbles: true })) }
  window.__smokeFile = file
}, [video, prompt || ''])
await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => file) }, video)
await win.click('text=Drop a video here')
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '2-start-file.png') })
await win.locator('button:has(svg.lucide-arrow-up)').click()
await win.waitForSelector('video', { timeout: 15000 }).catch(async e => { await win.screenshot({ path: join(out, 'fail.png') }); throw e })
await win.waitForTimeout(1500)
await win.screenshot({ path: join(out, '3-project.png') })
// the transcript appears when speech recognition is available (found on this machine or installed)
if (await win.getByText(/^\d+ fillers$/).waitFor({ timeout: 60000 }).then(() => true, () => false)) {
  await win.screenshot({ path: join(out, '3b-transcript.png') })
  console.log('transcript: ok')
}

// a box note at 4 s
await win.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 4 })
await win.waitForTimeout(400)
await win.keyboard.press('b')
const box = await win.locator('video').boundingBox()
await win.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3)
await win.mouse.down()
await win.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 })
await win.mouse.up()
await win.waitForTimeout(300)
await win.screenshot({ path: join(out, '4-box.png') })

if (prompt) {
  await win.keyboard.press('Escape')
  for (let i = 0; i < 90; i++) {
    await win.waitForTimeout(2000)
    if (await win.locator('text=Proposed:').count()) break
  }
  await win.screenshot({ path: join(out, '5-agent.png') })
}
await app.close()
console.log('screenshots in', out)
