// The native menu and the ⌘K palette drive the same commands.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-menu-'))
execFileSync(join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'm.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const click = label => app.evaluate(({ Menu }, l) => {
  const find = items => { for (const it of items) { if (it.label === l) return it; const s = it.submenu && find(it.submenu.items); if (s) return s } }
  const it = find(Menu.getApplicationMenu().items)
  if (!it) throw new Error(`no menu item ${l}`)
  it.click()
}, label)
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  // menu → settings section
  await click('Keys…')
  await dismissSettingsOnboarding(win)
  await win.waitForSelector('[role="dialog"] h2:text-is("Keys")')
  await win.keyboard.press('Escape')
  // open a project, then the palette from the menu, search, run
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'm.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await click('Command Palette…')
  await win.waitForSelector('input[placeholder="Type a command, or ask Manul…"]')
  await win.keyboard.type('vertical')
  const first = await win.locator('[role="dialog"] button').first().textContent()
  assert.match(first, /Export/, `'vertical' finds Export by keyword (got ${first})`)
  await win.keyboard.press('Enter')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await win.keyboard.press('Escape')
  // menu → export directly
  await click('Export…')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await win.keyboard.press('Escape')
  console.log('menu e2e: ok')
} finally {
  await app.close()
}
