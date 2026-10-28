// Moving pieces by hand: a piece's name drags it to another place in the film, and footage dragged from the sidebar's
// Files drops into the film where it lands. Both play at once (no render) and ⌘Z undoes them.
// The window opens on screen: keep your own mouse off it while this runs, or its moves mix into the drags.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-drag-'))
const ffmpeg = args => execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', ...args])
ffmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'film.mp4')])
ffmpeg(['-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'b.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const menu = label => app.evaluate(({ Menu }, l) => {
  const find = items => { for (const it of items) { if (it.label === l) return it; const s = it.submenu && find(it.submenu.items); if (s) return s } }
  find(Menu.getApplicationMenu().items).click()
}, label)
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1600, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain, BrowserWindow }, f) => {
    ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f])
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send('agent:ready'))
  }, join(tmp, 'film.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  assert.equal(await win.locator('[data-timeline-transport]').getByRole('button', { name: 'Split', exact: true }).count(), 1, 'Split is visible before selecting a clip')
  assert.equal(await win.locator('[data-timeline-transport]').getByRole('button', { name: 'Move clip', exact: true }).count(), 1, 'Move clip is visible before selecting a clip')
  const dir = await win.evaluate(() => window.agentshot.tabs.get().then(t => t.active))
  const items = () => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).timeline.items.map(i => [i.src.split('/').pop(), i.in, i.out])

  // two pieces of the film (0–1 s and 1–4 s)
  await win.evaluate(d => window.agentshot.timeline.edit(d, [{ op: 'split', at: 1 }]), dir)
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 2)
  assert.deepEqual(items(), [['film.mp4', 0, 1], ['film.mp4', 1, 4]])

  // 1. the second piece dragged by its name to the start
  const second = win.locator('[data-testid="timeline-scrubber"] [data-piece]').nth(1).locator('[data-grip]')
  const g = await second.boundingBox(), bar = await win.getByTestId('timeline-scrubber').boundingBox()
  await win.mouse.move(g.x + g.width / 2, g.y + g.height / 2); await win.mouse.down()
  await win.mouse.move(bar.x + 6, g.y + g.height / 2, { steps: 10 }); await win.mouse.up()
  await win.waitForFunction(() => document.querySelector('[data-edited]'))
  assert.deepEqual(items(), [['film.mp4', 1, 4], ['film.mp4', 0, 1]], 'it moved to the start')
  assert.equal(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).versions.length, 1, 'nothing rendered')

  // 2. footage from the sidebar's Files, dropped at the middle of the timeline (HTML drag events, as the row makes them)
  await win.evaluate(([d, f]) => window.agentshot.project.import(d, f), [dir, join(tmp, 'b.mp4')])
  const row = win.locator('[data-files-tree] button[draggable="true"]:has-text("b.mp4")')
  await row.waitFor()
  const carried = await row.evaluate(b => { const dt = new DataTransfer(); b.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); return [dt.getData('agentshot/file'), [...dt.types].sort()] })
  assert.deepEqual(carried, ['media/b.mp4', ['agentshot/file', 'agentshot/kind-video']])
  await win.getByTestId('timeline-scrubber').evaluate(el => {
    const r = el.getBoundingClientRect(), dt = new DataTransfer()
    dt.setData('agentshot/file', 'media/b.mp4'); dt.setData('agentshot/kind-video', '1')
    const o = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + r.width * 0.75, clientY: r.top + r.height / 2 }
    el.dispatchEvent(new DragEvent('dragover', o)); el.dispatchEvent(new DragEvent('drop', o))
  })
  // it lands inside the first piece, which splits around it
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 4)
  const now = items()
  assert.deepEqual(now.map(i => i[0]), ['film.mp4', 'b.mp4', 'film.mp4', 'film.mp4'], 'the footage went in where it was dropped')
  assert.deepEqual(now[1], ['b.mp4', 0, 2], 'all of it')
  assert.equal(now[0][2], now[2][1], 'the piece it landed in carries on after it')

  // ⌘Z (Edit → Undo, off any text field) takes the drop back out
  await win.locator('video').first().click({ position: { x: 4, y: 4 } }).catch(() => {})
  await menu('Undo')
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 2)
  assert.deepEqual(items(), [['film.mp4', 1, 4], ['film.mp4', 0, 1]], 'undo takes it out again')
  // Click the picture strip for Split and Move; removed trim controls stay absent.
  const timeline = win.getByTestId('timeline-scrubber')
  await timeline.click({ position: { x: 80, y: 25 } })
  assert.equal(await win.locator('[data-clip-actions]').count(), 0, 'selection shows tools in the transport, without opening a popup')
  const transport = win.locator('[data-timeline-transport]')
  const labels = await transport.locator('button').allTextContents()
  assert.ok(!labels.includes('Trim') && labels.indexOf('Split') < labels.indexOf('Move clip') && labels.indexOf('Move clip') < labels.indexOf('Note'))
  await timeline.click({ position: { x: 60, y: 25 } })
  await transport.getByRole('button', { name: 'Split', exact: true }).click()
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 3)
  await timeline.click({ button: 'right', position: { x: 10, y: 25 } })
  await win.getByRole('dialog', { name: 'Clip actions' }).waitFor()
  assert.equal(await win.getByRole('button', { name: /trim/i }).count(), 0)
  assert.equal(await timeline.locator('[data-trim-handle]').count(), 0)
  await win.getByRole('button', { name: 'Remove clip', exact: true }).click()
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 2)
  // Five separate clips: Move clip makes the entire picture strip draggable, not just its name.
  await win.evaluate(d => window.agentshot.timeline.edit(d, [{ op: 'split', at: .4 }, { op: 'split', at: .8 }, { op: 'split', at: 1.2 }]), dir)
  await win.waitForFunction(() => document.querySelectorAll('[data-testid="timeline-scrubber"] [data-piece]').length === 5)
  const beforeMove = items()
  assert.equal(await timeline.locator('[data-piece]').first().evaluate(el => getComputedStyle(el).borderRightWidth), '3px', 'a small visual gutter separates clips')
  const lastPiece = timeline.locator('[data-piece]').last()
  await lastPiece.click({ position: { x: 20, y: 25 } })
  const moveButton = transport.getByRole('button', { name: 'Move clip', exact: true })
  const hint = win.locator('#move-clip-hint')
  const colors = () => moveButton.evaluate(el => {
    const style = getComputedStyle(el)
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-amber)'
    probe.style.backgroundColor = 'var(--color-amber-soft)'
    el.append(probe)
    const theme = getComputedStyle(probe)
    const result = { border: style.borderTopColor, width: style.borderTopWidth, text: style.color, background: style.backgroundColor, amber: theme.color, soft: theme.backgroundColor }
    probe.remove()
    return result
  })
  assert.equal(await moveButton.getAttribute('aria-pressed'), 'false')
  assert.equal(await hint.count(), 0)
  const idleBounds = await moveButton.boundingBox()
  await moveButton.click()
  await win.waitForTimeout(200) // Let the theme's color transition finish.
  assert.equal(await moveButton.getAttribute('aria-pressed'), 'true')
  const active = await colors()
  assert.equal(active.width, '1px')
  assert.equal(active.border, active.amber, 'active border uses the workspace amber token')
  assert.equal(active.text, active.amber, 'active label uses the workspace amber token')
  assert.equal(active.background, active.soft, 'active background uses soft amber, including while hovered')
  assert.equal((await moveButton.boundingBox()).width, idleBounds.width, 'toggling does not shift the toolbar')
  assert.equal(await moveButton.getAttribute('aria-describedby'), 'move-clip-hint')
  assert.match(await hint.innerText(), /Click Move clip again to turn off/)
  await moveButton.click()
  await win.waitForTimeout(200)
  assert.equal(await moveButton.getAttribute('aria-pressed'), 'false', 'a second click disables move mode')
  assert.equal(await hint.count(), 0)
  assert.equal(await moveButton.getAttribute('aria-describedby'), null)
  assert.equal(await timeline.locator('[data-move-enabled]').count(), 0)
  assert.equal((await colors()).border, 'rgba(0, 0, 0, 0)', 'the active amber border clears')
  assert.deepEqual(items(), beforeMove, 'toggling alone never edits the film')
  await moveButton.click()
  assert.equal(await timeline.locator('[data-move-enabled]').count(), 5)
  const lastBounds = await lastPiece.boundingBox(), timelineBounds = await timeline.boundingBox()
  await win.mouse.move(lastBounds.x + lastBounds.width / 2, lastBounds.y + 25); await win.mouse.down()
  await win.mouse.move(timelineBounds.x + 4, lastBounds.y + 25, { steps: 12 })
  assert.equal(await win.locator('[data-move-insertion]').count(), 1)
  const lifted = win.locator('[data-lifted-clip]')
  assert.ok(await lifted.locator('img').count() > 0, 'the lifted clip carries its actual thumbnails')
  const floating = await lifted.boundingBox()
  assert.ok(floating.y < lastBounds.y, 'the clip floats above its original position')
  assert.ok(Math.abs(floating.width - lastBounds.width) < lastBounds.width * .1, 'the preview retains the clip size')
  await win.mouse.up()
  await win.waitForFunction(() => !document.querySelector('[data-move-insertion]'))
  assert.deepEqual(items(), [beforeMove[4], ...beforeMove.slice(0, 4)])
  assert.equal(await win.locator('textarea[aria-autocomplete="list"]').inputValue(), '', 'moving a clip does not append timestamps to chat')
  await win.keyboard.press('Escape')
  assert.equal(await timeline.locator('[data-move-enabled]').count(), 0)
  assert.equal(await moveButton.getAttribute('aria-pressed'), 'false', 'Escape resets the toggle')
  assert.equal(await hint.count(), 0, 'Escape removes the active-mode instructions')
  await menu('Undo')
  await win.waitForTimeout(250)
  assert.deepEqual(items(), beforeMove, 'undo restores all five clips in their previous order')
  await timeline.locator('[data-piece]').first().click({ position: { x: 10, y: 25 } })
  await transport.getByRole('button', { name: 'Move clip', exact: true }).click()
  const firstBounds = await timeline.locator('[data-piece]').first().boundingBox()
  await win.mouse.move(firstBounds.x + 10, firstBounds.y + 25); await win.mouse.down()
  await win.mouse.move(timelineBounds.x + timelineBounds.width - 10, firstBounds.y + 25, { steps: 8 })
  await win.keyboard.press('Escape'); await win.mouse.up()
  assert.deepEqual(items(), beforeMove, 'Escape cancels a lifted clip without changing the timeline')
  assert.equal(await win.locator('[data-move-insertion]').count(), 0)
  assert.equal(await win.locator('[data-lifted-clip]').count(), 0)
  console.log('drag e2e: ok')
} finally {
  await app.close()
}
