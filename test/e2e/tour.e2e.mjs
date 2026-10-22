// First-run walkthrough in the real Electron renderer; local footage, no provider or AI calls.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { prepareElectron } from '../../scripts/run-electron.mjs'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-tour-'))
const out = process.argv[2] || join(tmp, 'screenshots')
mkdirSync(out, { recursive: true })
const video = join(tmp, 'First film.mp4')
execFileSync(bundledBinary('ffmpeg'),
  ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
const executablePath = await prepareElectron()
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') }
delete env.ELECTRON_RENDERER_URL
const launch = () => electron.launch({ cwd: root, executablePath, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env })
let app = await launch()
const errors = []
try {
  let win = await app.firstWindow()
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForSelector('text=What are we making?')
  // Set fresh onboarding state and make the release-only consent dialog available before reloading.
  await win.evaluate(() => localStorage.removeItem('manul.tour.v1'))
  await app.evaluate(({ ipcMain }) => {
    const available = { usage: true, crashes: true }
    let st = { asked: false, usage: false, crashes: false, available }
    ipcMain.removeHandler('telemetry:state'); ipcMain.handle('telemetry:state', () => st)
    ipcMain.removeHandler('telemetry:set'); ipcMain.handle('telemetry:set', (_e, choices) => st = { ...st, ...choices, asked: true })
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
  })
  await win.reload()
  await win.getByRole('dialog', { name: 'Help improve Manul?' }).waitFor()
  assert.equal(await win.locator('.manul-tour').count(), 0, 'tour waits for consent choices')
  await win.getByRole('button', { name: 'Continue', exact: true }).click()
  const title = text => win.locator('.manul-tour .driver-popover-title').filter({ hasText: text }).waitFor()
  const settled = () => win.waitForFunction(() => {
    const el = document.querySelector('.manul-tour')
    return el && getComputedStyle(el).opacity === '1' && document.getAnimations().every(a => a.playState !== 'running' || !a.effect?.target?.closest?.('.manul-tour'))
  })
  const screenshot = async name => { await settled(); await win.waitForTimeout(250); await win.screenshot({ path: join(out, name) }) }
  const next = async () => { await settled(); await win.locator('.driver-popover-next-btn').click() }
  const target = async name => {
    assert.equal(await win.locator(`.driver-active-element[data-tour="${name}"]:visible`).count(), 1, `spotlight finds ${name}`)
  }
  const fits = async () => {
    const r = await win.locator('.manul-tour').boundingBox()
    const viewport = await win.evaluate(() => ({ width: innerWidth, height: innerHeight }))
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= viewport.width + 1 && r.y + r.height <= viewport.height + 1, 'tour stays inside viewport')
  }
  await title('Direct your video.')
  assert.match(await win.locator('.manul-tour').textContent(), process.platform === 'darwin' ? /macOS/ : /Linux/)
  const fonts = await win.locator('.manul-tour').evaluate(el => ({
    body: getComputedStyle(el).fontFamily,
    title: getComputedStyle(el.querySelector('.driver-popover-title')).fontFamily,
    background: getComputedStyle(el).backgroundColor,
    panel: getComputedStyle(document.documentElement).getPropertyValue('--color-panel').trim(),
  }))
  assert.match(fonts.body, /Inter Variable/)
  assert.match(fonts.title, /Source Serif 4 Variable/)
  await screenshot('home-light.png')
  await next(); await title('Connect your editing assistant'); await target('settings')
  await win.getByRole('button', { name: 'Open Settings → Keys' }).click()
  await win.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await title('Your own key = bring your own key')
  await fits()
  assert.equal(await win.locator('.manul-tour[data-tour-phase="home"]').count(), 0, 'home tour pauses for the Settings tour')
  await target('own-key-tab')
  assert.equal(await win.getByRole('tab', { name: 'Your own keys' }).getAttribute('data-state'), 'active')
  assert.match(await win.locator('.manul-tour').textContent(), /billed by that provider/)
  await screenshot('settings-byok-light.png')
  await next(); await title('Manul key: one connection'); await target('manul-key-tab')
  assert.equal(await win.getByRole('tab', { name: 'Manul key', exact: true }).getAttribute('data-state'), 'active')
  assert.match(await win.locator('.manul-tour').textContent(), /Manul credit/)
  await screenshot('settings-manul-light.png')
  await next(); await title('Browser: where Manul uses the web'); await target('settings-browser-tab')
  await win.getByRole('radiogroup').waitFor()
  assert.match(await win.locator('.manul-tour').textContent(), /globe button/)
  await screenshot('settings-browser-light.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).setSize(900, 600))
  await fits()
  await win.evaluate(() => document.documentElement.classList.add('dark'))
  await screenshot('settings-browser-dark-small.png')
  assert.equal(await win.locator('.manul-tour').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 20, 18)')
  await win.evaluate(() => document.documentElement.classList.remove('dark'))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).setSize(1440, 900))
  await win.keyboard.press('ArrowLeft'); await title('Manul key: one connection')
  await next(); await title('Browser: where Manul uses the web')
  await next(); await win.locator('.manul-tour').waitFor({ state: 'detached' })
  const db = new DatabaseSync(join(tmp, 'ud', 'onboarding.sqlite'))
  let settingsRecord
  try { settingsRecord = db.prepare('SELECT * FROM settings_onboarding WHERE id = 1').get() }
  finally { db.close() }
  assert.equal(settingsRecord.tour_status, 'completed')
  assert.ok(settingsRecord.first_opened_at > 0, 'first Settings open is recorded in SQLite')
  await win.keyboard.press('Escape')
  await title('Connect your editing assistant'); await target('settings')
  await next(); await title('Start with your footage'); await target('import')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).setSize(900, 600))
  await fits()
  await screenshot('home-small.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).setSize(1440, 900))
  await win.keyboard.press('ArrowRight'); await title('Say what you want'); await target('start-prompt')
  await win.keyboard.press('ArrowLeft'); await title('Start with your footage')
  await next(); await next(); await title('Need a starting point?'); await target('ideas')
  await next(); await title('Open your first film'); await target('start')
  await next()
  await win.waitForSelector('.manul-tour', { state: 'detached' })
  assert.equal(await win.evaluate(() => JSON.parse(localStorage.getItem('manul.tour.v1')).home), 'completed')

  await app.evaluate(({ ipcMain }, video) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [video]) }, video)
  await win.locator('[data-tour="import"]').click()
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await title('Your film, with an editor beside it')
  await win.waitForSelector('video')
  const initialTime = await win.locator('video').evaluate(v => v.currentTime)
  await win.locator('.manul-tour').evaluate(el => { el.tabIndex = -1; el.focus() })
  await win.keyboard.press('Space')
  assert.equal(await win.locator('video').evaluate(v => v.paused), true, 'tour does not trigger playback')
  await next(); await title('Keep the conversation going'); await target('composer')
  await next(); await title('Watch your film'); await target('picture')
  await win.keyboard.press('ArrowRight'); await title('Point at a moment'); await target('timeline')
  assert.equal(await win.locator('video').evaluate(v => v.currentTime), initialTime, 'navigation does not seek the film')
  await win.keyboard.press('n')
  assert.equal(await win.locator('text=Note at 0:').count(), 0, 'note shortcuts do not affect the film')
  await next(); await title('Point at something'); await target('box')
  await screenshot('editor-box-light.png')
  await next(); await title('Bring in music'); await target('projects')
  await next(); await title('Compare, then decide'); await target('picture')
  await next(); await title('Every version'); await target('versions')
  await next(); await title('Export a finished MP4'); await target('export')
  await win.evaluate(() => document.documentElement.classList.add('dark'))
  await win.waitForFunction(() => getComputedStyle(document.querySelector('.driver-popover-next-btn')).backgroundColor === 'rgb(242, 165, 65)')
  assert.equal(await win.locator('.manul-tour').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(22, 20, 18)')
  assert.equal(await win.locator('.driver-popover-next-btn').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(242, 165, 65)')
  await screenshot('editor-dark.png')
  await fits()
  await next(); await title('You’re ready to direct')
  // Repeated tabbing never reaches the actual version picker, composer or editing buttons.
  for (let i = 0; i < 8; i++) {
    await win.keyboard.press('Tab')
    assert.equal(await win.evaluate(() => !!document.activeElement.closest('.manul-tour')), true)
  }
  const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl+'
  assert.ok((await win.locator('.manul-tour').textContent()).includes(`${mod}K`))
  await next(); await win.waitForSelector('.manul-tour', { state: 'detached' })
  assert.equal(await win.evaluate(() => JSON.parse(localStorage.getItem('manul.tour.v1')).editor), 'completed')

  // Replay must reveal a hidden film and sidebar, and reduced motion disables tour animation.
  await win.getByRole('button', { name: 'Film preview', exact: true }).click()
  await win.getByRole('button', { name: 'Toggle sidebar', exact: true }).click()
  await win.emulateMedia({ reducedMotion: 'reduce' })
  await app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().items.find(i => i.role === 'help').submenu.items.find(i => i.label === 'Product Tour')
    item.click()
  })
  await title('Your film, with an editor beside it')
  assert.equal(await win.locator('aside[aria-label="Sidebar"]:visible').count(), 1)
  assert.equal(await win.locator('[data-tour="picture"]:visible').count(), 1)
  assert.equal(await win.locator('body.driver-fade').count(), 0, 'reduced motion suppresses fade')
  await win.keyboard.press('Escape'); await win.waitForSelector('.manul-tour', { state: 'detached' })
  await win.getByRole('button', { name: 'Product tour', exact: true }).click()
  await title('Your film, with an editor beside it')
  await win.locator('.manul-tour-skip').click()

  // Relaunch preserves dismissal and the open project without automatically replaying.
  await app.close()
  app = await launch(); win = await app.firstWindow()
  win.on('pageerror', e => errors.push(e.message))
  await win.waitForSelector('video')
  await win.waitForTimeout(500)
  assert.equal(await win.locator('.manul-tour').count(), 0, 'dismissal persists after relaunch')
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await win.waitForTimeout(250)
  assert.equal(await win.locator('.manul-tour').count(), 0, 'completed Settings tour does not repeat after relaunch')
  const settingsState = await win.evaluate(() => window.manul.onboarding.settingsOpened())
  assert.equal(settingsState.firstOpen, false)
  assert.equal(settingsState.state.firstOpenedAt, settingsRecord.first_opened_at)
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await win.getByText('What are we making?', { exact: true }).waitFor()
  await win.getByRole('button', { name: 'Product tour', exact: true }).click()
  await title('Direct your video.')
  await win.locator('.manul-tour-skip').click()
  await win.waitForSelector('.manul-tour', { state: 'detached' })
  const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('manul.tour.v1')))
  assert.deepEqual(saved, { home: 'skipped', editor: 'skipped' })
  // A fresh database also persists explicit Settings dismissal independently of the main tour.
  const reset = new DatabaseSync(join(tmp, 'ud', 'onboarding.sqlite'))
  try { reset.exec('DELETE FROM settings_onboarding') } finally { reset.close() }
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await title('Your own key = bring your own key')
  await win.keyboard.press('Escape')
  await win.locator('.manul-tour').waitFor({ state: 'detached' })
  await win.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await win.keyboard.press('Escape')
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await win.waitForTimeout(250)
  assert.equal(await win.locator('.manul-tour').count(), 0, 'skipping the Settings tour prevents another automatic tour')
  assert.equal((await win.evaluate(() => window.manul.onboarding.settingsOpened())).state.tourStatus, 'skipped')
  assert.deepEqual(errors, [], 'no renderer exceptions')
  console.log('tour e2e: ok —', out)
} finally {
  await app.close()
  rmSync(join(tmp, 'ud'), { recursive: true, force: true })
  rmSync(join(tmp, 'projects'), { recursive: true, force: true })
}
