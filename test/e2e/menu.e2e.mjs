// The native menu and the ⌘K palette drive the same commands.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-menu-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'm.mp4')])
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
  const closeDialog = async () => {
    const dialog = win.getByRole('dialog')
    await dialog.locator('button:has(svg.lucide-x)').click()
    await dialog.waitFor({ state: 'detached' })
  }
  // menu → settings section
  await click('Keys…')
  await dismissSettingsOnboarding(win)
  await win.waitForSelector('[role="dialog"] h2:text-is("Keys")')
  await closeDialog()
  // open a project, then the palette from the menu, search, run
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'm.mp4'))
  await win.click('[data-tour="import"]')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await click('Command Palette…')
  const search = win.getByPlaceholder('Type a command, or ask AgentShot…')
  await search.fill('vertical')
  const first = await win.locator('[role="dialog"] button').first().textContent()
  assert.match(first, /Export/, `'vertical' finds Export by keyword (got ${first})`)
  await search.press('Enter')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await closeDialog()
  // menu → export directly
  await click('Export…')
  await win.waitForSelector('[role="dialog"] h2:text-is("Export")')
  await closeDialog()
  console.log('menu e2e: ok')
} finally {
  await app.close()
}
