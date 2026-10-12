// Footage the player can't decode (ProRes) gets a preview copy and plays; the original stays the source.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-proxy-'))
execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=3',
  '-c:v', 'prores_ks', '-profile:v', '1', join(tmp, 'master.mov')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'master.mov'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await win.waitForSelector('text=Making a preview copy for smooth playback…', { timeout: 10000 }).catch(() => {}) // may already be done
  await win.waitForFunction(() => document.querySelector('video')?.src.includes('/proxies/'), null, { timeout: 60000 })
  await win.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 20000 })
  const p = await win.evaluate(() => window.manul.project.recent().then(r => window.manul.project.open(r[0].dir)))
  assert.equal(p.proxies['media/master.mov'], 'proxies/master.mp4')
  assert.ok(existsSync(join(p.dir, 'proxies', 'master.mp4')))
  assert.equal(p.versions[0].path, 'media/master.mov', 'the original stays the source for renders and exports')
  console.log('proxy e2e: ok')
} finally {
  await app.close()
}
