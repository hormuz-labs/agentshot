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

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-drag-'))
const ffmpeg = args => execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', ...args])
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
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'film.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  const items = () => JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).timeline.items.map(i => [i.src.split('/').pop(), i.in, i.out])

  // two pieces of the film (0–1 s and 1–4 s)
  await win.evaluate(d => window.manul.timeline.edit(d, [{ op: 'split', at: 1 }]), dir)
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
  await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, 'b.mp4')])
  const row = win.locator('[data-files-tree] button[draggable="true"]:has-text("b.mp4")')
  await row.waitFor()
  const carried = await row.evaluate(b => { const dt = new DataTransfer(); b.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); return [dt.getData('manul/file'), [...dt.types].sort()] })
  assert.deepEqual(carried, ['media/b.mp4', ['manul/file', 'manul/kind-video']])
  await win.getByTestId('timeline-scrubber').evaluate(el => {
    const r = el.getBoundingClientRect(), dt = new DataTransfer()
    dt.setData('manul/file', 'media/b.mp4'); dt.setData('manul/kind-video', '1')
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
  console.log('drag e2e: ok')
} finally {
  await app.close()
}
