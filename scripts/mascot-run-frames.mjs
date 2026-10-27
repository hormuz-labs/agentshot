// The phone's running Manul: frames of the desktop's own 3D Manul running (two strides, so the loop meets itself),
// drawn on a fixed clock so each frame is evenly spaced, saved as transparent PNGs in mobile/assets/manul_run/.
// npm run build && node scripts/run-headless.mjs node scripts/mascot-run-frames.mjs
import { _electron as electron } from 'playwright-core'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { prepareElectron } from './run-electron.mjs'
import { dismissOnboarding } from '../test/e2e/onboarding.mjs'
import { bundledBinary } from '../test/e2e/helpers.mjs'

const FRAMES = 28
const STRIDE = (2 * Math.PI) / 11 // scene.ts: stride = t * 11
const root = join(import.meta.dirname, '..')
const out = join(root, 'mobile', 'assets', 'manul_run')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-mascot-frames-'))
mkdirSync(out, { recursive: true })
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ cwd: root, executablePath: await prepareElectron(), args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--force-device-scale-factor=4'], env })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready')
  })
  const video = join(tmp, 'film.mp4')
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=#ada48d:s=640x360:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  await app.evaluate(({ ipcMain }, video) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [video]) }, video)
  await win.click('[data-tour="import"]')
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('[data-mascot-renderer="webgl"]')
  const project = await win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')
  await app.evaluate(({ BrowserWindow }, project) => {
    const wc = BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents
    wc.send('agui', project, { type: 'MESSAGES_SNAPSHOT', timestamp: Date.now(), messages: [{ id: 'u', role: 'user', content: 'Run!' }] })
    wc.send('agui', project, { type: 'RUN_STARTED', timestamp: Date.now() })
  }, project)
  await win.waitForSelector('[data-mascot-state="thinking"]:visible')
  await win.waitForFunction(() => Number(document.querySelector('[data-mascot-renderer="webgl"]:not([hidden]) canvas, [data-mascot-renderer="webgl"] canvas').dataset.busyPose) > .999)
  // from here the page's clock is ours: each frame is drawn when we say, as far along as we say
  await win.evaluate(() => {
    const queue = []
    let now = performance.now()
    window.requestAnimationFrame = cb => { queue.push(cb); return queue.length }
    window.__step = dt => {
      now += dt * 1000
      const due = queue.splice(0)
      for (const cb of due) cb(now)
    }
  })
  // bigger on the page, so the frames are sharp on a phone (the scene sizes itself to its box)
  await win.evaluate(() => {
    const box = [...document.querySelectorAll('[data-mascot-state]')].find(e => e.offsetParent)
    box.style.width = box.style.height = '360px'
    box.style.minWidth = box.style.minHeight = '360px'
    box.style.position = 'fixed'; box.style.left = '0'; box.style.top = '0'; box.style.zIndex = '9999'
  })
  await win.waitForTimeout(500)
  for (let i = 0; i < 12; i++) await win.evaluate(() => window.__step(1 / 60)) // settled, nothing blank
  for (let i = 0; i < FRAMES; i++) {
    // read the frame straight off the canvas as it's drawn (its own transparency, at the screen's full density)
    const png = await win.evaluate(dt => {
      window.__step(dt)
      const canvas = [...document.querySelectorAll('[data-mascot-renderer="webgl"] canvas')].find(c => c.offsetParent)
      return canvas.toDataURL('image/png')
    }, (2 * STRIDE) / FRAMES)
    writeFileSync(join(out, `${String(i).padStart(2, '0')}.png`), Buffer.from(png.split(',')[1], 'base64'))
  }
  console.log(`${FRAMES} frames in ${out}`)
} finally {
  await app.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
