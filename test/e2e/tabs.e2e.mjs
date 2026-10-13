// Several projects open in the sidebar: each keeps its own playhead, they close, and they come back after a relaunch.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-tabs-'))
for (const [name, color] of [['alpha', 'red'], ['beta', 'blue'], ['gamma', 'green']])
  execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=320x240:d=6`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, `${name}.mp4`)])
const launch = () => electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const menu = (app, label) => app.evaluate(({ Menu }, l) => {
  const find = items => { for (const it of items) { if (it.label === l) return it; const s = it.submenu && find(it.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click()
}, label)

// open projects have a close button in the sidebar; the one on screen is aria-current
const openCount = () => win.locator('[data-project-row] button[title="Close project"]').count()
const shown = () => win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')

let win
let app = await launch()
try {
  win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  const openFile = async name => {
    await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, `${name}.mp4`))
    await win.click('[data-tour="import"]')
    await win.locator('button:has(svg.lucide-arrow-up)').click()
    await win.waitForSelector(`[data-project-title="${name}"]`)
  }
  await openFile('alpha')
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 2 })
  await menu(app, 'New Project')
  await win.waitForSelector('text=What are we making?')
  await openFile('beta')
  await win.evaluate(() => { const v = [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })); v.currentTime = 4 })
  await menu(app, 'New Project'); await openFile('gamma')
  assert.equal(await openCount(), 3, 'three projects open')

  // each tab keeps its own playhead
  await win.click('[data-project-row$="/alpha"]')
  await win.waitForTimeout(300)
  const t = await win.evaluate(() => [...document.querySelectorAll('video')].find(v => v.checkVisibility({ visibilityProperty: true })).currentTime)
  assert.ok(Math.abs(t - 2) < 0.2, `alpha's playhead stayed at 2 s (got ${t})`)
  await menu(app, 'Next Project')
  await win.waitForTimeout(300)
  assert.match(await shown(), /beta$/, 'Next Project goes to beta')

  // close beta (⌘W) → gamma (the right neighbour) is on screen
  await menu(app, 'Close Project')
  await win.waitForTimeout(300)
  assert.equal(await openCount(), 2)
  assert.match(await shown(), /gamma$/)
  // delete gamma → its project folder moves to the Trash and alpha is selected
  await win.click('[data-project-row$="/gamma"] button[title="Delete project (moves to the Trash)"]')
  await win.click('[data-project-row$="/gamma"] button:has-text("Delete")')
  await win.waitForSelector('[data-project-row$="/alpha"][aria-current="true"]')
  assert.equal(await openCount(), 1)
  assert.equal(existsSync(join(tmp, 'p', 'gamma')), false)
  await win.waitForTimeout(500) // the remaining open project is saved
  await app.close()

  // relaunch: only alpha comes back
  app = await launch()
  win = await app.firstWindow()
  await win.waitForSelector('[data-project-row$="/alpha"][aria-current="true"]')
  assert.equal(await openCount(), 1)
  console.log('tabs e2e: ok')
} finally {
  await app.close()
}
