// Panes resize by their dividers: the sidebar, and the film beside the conversation. Widths come back after a relaunch,
// a double-click resets one, nothing is ever pushed off screen, and dragging well past a limit snaps a pane shut.
// The window opens on screen: keep your own mouse off it while this runs, or its moves mix into the drags.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'
const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-rz-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'clip.mp4')])
const launch = () => electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const width = (win, sel) => win.locator(sel).evaluate(e => Math.round(e.getBoundingClientRect().width))
// drag only once the page is laid out at the size asked for
const size = async (win, width) => { await win.setViewportSize({ width, height: 900 }); await win.waitForFunction(w => innerWidth === w, width); await win.waitForTimeout(200) }
const drag = async (win, label, dx) => {
  const b = await win.locator(`[role="separator"][aria-label="${label}"]`).boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + dx, y, { steps: 6 }); await win.mouse.up()
}
let app = await launch()
try {
  let win = await app.firstWindow()
  await size(win, 1800)
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'clip.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  await win.waitForTimeout(300) // the project's first layout
  const side = '[aria-label="Sidebar"]'
  const s0 = await width(win, side)
  await drag(win, 'Resize the sidebar', 80)
  assert.equal(await width(win, side), s0 + 80, 'sidebar widens')
  const pv = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.getBoundingClientRect().width))
  await drag(win, 'Resize the film preview', -100)
  const pv2 = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.getBoundingClientRect().width))
  assert.equal(pv2, pv + 100, 'dragging the film divider left widens the film')
  // left until the conversation is down to its 320 px (and a little further, short of snapping it shut): it stops there
  const row = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => e.parentElement.parentElement.getBoundingClientRect().width)
  await drag(win, 'Resize the film preview', -(row - 320 - pv2 + 30))
  const chatCol = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.previousElementSibling.getBoundingClientRect().width))
  assert.ok(chatCol >= 318 && chatCol <= 324, `the conversation narrows to its minimum (${chatCol})`)
  await win.locator('[aria-label="Resize the film preview"]').dblclick()

  // a narrow window: the panes give way, nothing goes off screen, the conversation keeps its 320 px
  await drag(win, 'Resize the film preview', -200)
  await size(win, 1100)
  const right = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => e.parentElement.getBoundingClientRect().right)
  assert.ok(right <= 1100 + 1, `the film stays on screen (right edge ${right})`)
  const conv = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.previousElementSibling.getBoundingClientRect().width))
  assert.ok(conv >= 318, `the conversation keeps its room (${conv})`)
  await size(win, 1800)
  const kept = await win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.getBoundingClientRect().width))
  await win.waitForTimeout(300) // the widths are saved
  await app.close()

  // relaunch: the widths come back; a double-click resets one
  app = await launch()
  win = await app.firstWindow()
  await size(win, 1800)
  await win.waitForSelector('[data-project-title]')
  assert.equal(await width(win, side), s0 + 80, 'the sidebar width comes back after a relaunch')
  const film = () => win.locator('[aria-label="Resize the film preview"]').evaluate(e => Math.round(e.parentElement.getBoundingClientRect().width))
  assert.equal(await film(), kept, 'the film width comes back')
  await win.locator('[aria-label="Resize the film preview"]').dblclick()
  assert.equal(await film(), 640, 'double-click resets')

  // past the minimum, a pane snaps shut, as in Claude's app; dragging back in the same way (or its toggle) opens it
  const has = sel => win.locator(sel).count()
  const far = async (label, dx) => { await drag(win, label, dx); await win.waitForTimeout(200) }
  await far('Resize the film preview', -2000)
  assert.equal(await has('text=What should change?'), 0, 'dragged far left, the conversation snaps shut and the film takes the window')
  await far('Resize the film preview', 200)
  assert.equal(await has('text=What should change?'), 1, 'dragged back, the conversation opens again')
  await far('Resize the film preview', 2000)
  assert.equal(await has('[aria-label="Resize the film preview"]'), 0, 'dragged far right, the film snaps shut')
  await win.click('[aria-label="Film preview"]')
  assert.equal(await has('[aria-label="Resize the film preview"]'), 1, 'its toggle brings it back')
  await far('Resize the sidebar', -400)
  assert.equal(await has('[aria-label="Sidebar"]'), 0, 'the sidebar snaps shut, all the way')
  assert.equal(await has('[aria-label="Toggle sidebar"]'), 1, 'its toggle waits in the title bar')
  await win.click('[aria-label="Toggle sidebar"]')
  assert.equal(await has('[aria-label="Sidebar"]'), 1, 'the toggle opens it again')
  console.log('resize e2e: ok')
} finally { await app.close() }
