// Footage the player can't decode (ProRes) gets a preview copy and plays; the original stays the source.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-proxy-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=25:duration=3',
  '-c:v', 'prores_ks', '-profile:v', '1', join(tmp, 'master.mov')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'master.mov'))
  await win.click('[data-tour="import"]')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await win.waitForSelector('text=Making a preview copy for smooth playback…', { timeout: 10000 }).catch(() => {}) // may already be done
  await win.waitForFunction(() => document.querySelector('video')?.src.includes('/proxies/'), null, { timeout: 60000 })
  await win.waitForFunction(() => (document.querySelector('video')?.readyState ?? 0) >= 2, null, { timeout: 20000 })
  const p = await win.evaluate(() => window.agentshot.project.recent().then(r => window.agentshot.project.open(r[0].dir)))
  assert.match(p.proxies['media/master.mov'], /^proxies\/master-[a-f0-9]{12}\.mp4$/)
  assert.ok(existsSync(join(p.dir, p.proxies['media/master.mov'])))
  assert.equal(await win.locator('[data-preview-status]').count(), 0, 'a ready preview has no stuck status overlay')
  assert.equal(p.versions[0].path, 'media/master.mov', 'the original stays the source for renders and exports')
  // New high-resolution renders (not imported footage) must also schedule preview generation.
  const ff = bundledBinary('ffmpeg')
  execFileSync(ff, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=2560x1440:r=25:d=2', '-c:v', 'libx264', '-preset', 'ultrafast', join(p.dir, 'renders', 'big.mp4')])
  const dir = p.dir
    const project = JSON.parse(readFileSync(`${dir}/project.json`, 'utf8'))
    project.media['renders/big.mp4'] = { duration: 2, width: 2560, height: 1440, fps: 25, hasAudio: false, codec: 'h264', pixfmt: 'yuv420p' }
    project.versions.push({ id: 'new-render', path: 'renders/big.mp4', title: 'New render', createdAt: Date.now(), by: 'agent' })
    writeFileSync(`${dir}/project.json`, JSON.stringify(project))
    // Close makes openProject load the on-disk media list, as after a restart or restored project.
  await win.evaluate(async dir => { await window.agentshot.project.close(dir); await window.agentshot.project.open(dir); await window.agentshot.project.setCurrent(dir, 'new-render') }, dir)
  await win.waitForFunction(() => document.querySelector('video')?.src.includes('/proxies/big-'), null, { timeout: 60000 })
  await win.waitForFunction(() => !document.querySelector('[data-preview-status]'))
  // A failed prepare must show recovery, never an everlasting spinner or full-screen blocker.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('preview:prepare')
    ipcMain.handle('preview:prepare', (_e, _dir, _media, retry) => retry ? { status: 'ready', progress: 1 } : { status: 'failed', error: 'Test encoder failure' })
  })
  await win.evaluate(async dir => { const p = await window.agentshot.project.open(dir); await window.agentshot.project.setCurrent(dir, p.versions[0].id) }, dir)
  await win.getByRole('button', { name: 'Retry preview', exact: true }).waitFor()
  assert.equal(await win.getByText('Making a preview copy for smooth playback…', { exact: true }).count(), 0)
  await win.getByRole('button', { name: 'Retry preview', exact: true }).click()
  await win.waitForFunction(() => !document.querySelector('[data-preview-status]'))
  console.log('proxy e2e: ok')
} finally {
  await app.close()
}
