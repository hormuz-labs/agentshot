// Files besides the film, in the sidebar's project tree: Files → + brings in subtitles, a note and a folder; each says
// what it is; they ride on the next message as chips, and the sent message shows them. @ in the message box points at
// one; the bin moves one (or a folder) to the Trash, but never the film's own video.
// Deleting sends files to the Trash, never the ones the film uses. Run after npm run build. The agent gets a fake key, so
// the message fails at the model (no real call is ever paid for); what's checked is what the user sees.
// MANUL_E2E_SHOTS=<folder> saves screenshots there.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-files-'))
const shots = process.env.MANUL_E2E_SHOTS
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'film.mp4')])
writeFileSync(join(tmp, 'film.srt'), '1\n00:00:00,500 --> 00:00:02,000\nHello there\n\n2\n00:00:02,200 --> 00:00:03,500\nGoodbye\n')
writeFileSync(join(tmp, 'notes.md'), 'Colours: keep it warm.\n')
mkdirSync(join(tmp, 'Brand Kit'))
writeFileSync(join(tmp, 'Brand Kit', 'colours.txt'), 'Orange #F2A541\n')
copyFileSync(join(root, 'resources', 'fonts', 'Inter-Bold.ttf'), join(tmp, 'Brand Kit', 'Brand-Bold.ttf'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x240:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'b.mp4')])
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=3', join(tmp, 'song.mp3')])

// no real keys reach the app: a fake one makes the agent "ready" without ever reaching a paid model
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'film.mp4'))
  await win.click('[data-tour="import"]')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))

  // Files → + in the project tree (the dialog answered with three things: subtitles, a note, a folder)
  await app.evaluate(({ ipcMain }, fs) => { ipcMain.removeHandler('project:pickFiles'); ipcMain.handle('project:pickFiles', () => fs) },
    [join(tmp, 'film.srt'), join(tmp, 'notes.md'), join(tmp, 'Brand Kit')])
  await win.click('[data-project-tree] [aria-label="Add files"]')
  const composer = win.locator('textarea[placeholder="What should AgentShot do with these?"]')
  await composer.waitFor()
  for (const chip of ['film.srt', 'notes.md', 'Brand Kit/colours.txt', 'Brand Kit/Brand-Bold.ttf']) await win.locator(`span:has(> span.truncate:text-is("${chip}"))`).first().waitFor()

  // each file says what it is (on hover)
  await win.waitForSelector('[data-files-tree] button[title*="SRT subtitles: 2 cues, 0:01–0:04, 3 words; starts “Hello there”"]')
  await win.waitForSelector('[data-files-tree] button[title*="font “Inter” Bold (Inter Bold)"]')
  // The explorer folds each directory independently; closing media keeps the Brand Kit's own fold state.
  const kit = win.locator('[data-file-folder="media/Brand Kit"]')
  const font = win.locator('[data-project-file="media/Brand Kit/Brand-Bold.ttf"]')
  await kit.getByRole('button', { name: 'Collapse media/Brand Kit', exact: true }).click()
  await font.waitFor({ state: 'detached' })
  await win.locator('[data-project-file="media/film.srt"]').waitFor()
  await win.getByRole('button', { name: 'Collapse media', exact: true }).click()
  await kit.waitFor({ state: 'detached' })
  await win.getByRole('button', { name: 'Expand media', exact: true }).click()
  assert.equal(await font.count(), 0, 'child folder stays collapsed when its parent is reopened')
  await kit.getByRole('button', { name: 'Expand media/Brand Kit', exact: true }).focus()
  await win.keyboard.press('ArrowRight')
  await font.waitFor()
  const folds = await win.evaluate(d => JSON.parse(localStorage.getItem(`manul.tree.folders.${d}`)), dir)
  assert.deepEqual(folds, [], 'expanded state is persisted per project')
  const attachedBefore = await win.locator('[data-files-tree] button[aria-pressed="true"]').count()
  await kit.getByRole('button', { name: 'Collapse media/Brand Kit', exact: true }).focus()
  await win.keyboard.press('ArrowLeft')
  await font.waitFor({ state: 'detached' })
  assert.equal(await win.locator('[data-files-tree] button[aria-pressed="true"]').count(), attachedBefore - 2, 'folding changes visibility, not attachments')
  await win.reload()
  await kit.getByRole('button', { name: 'Expand media/Brand Kit', exact: true }).waitFor()
  assert.equal(await font.count(), 0, 'folder collapse survives renderer reload')
  await kit.getByRole('button', { name: 'Attach all files in media/Brand Kit', exact: true }).click()
  assert.equal(await font.count(), 0, 'folder paperclip attaches files without expanding the folder')
  await kit.getByRole('button', { name: 'Expand media/Brand Kit', exact: true }).click()
  await font.waitFor()
  assert.equal(await font.locator('button[aria-pressed]').getAttribute('aria-pressed'), 'true')
  // Restore the original imported attachment set for the message/deletion checks below.
  await win.locator('[data-project-file="media/film.srt"] button[aria-pressed="false"]').click()
  await win.locator('[data-project-file="media/notes.md"] button[aria-pressed="false"]').click()
  if (shots) await win.screenshot({ path: join(shots, 'files-list.png') })
  const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(Object.fromEntries(Object.entries(project.files).map(([k, f]) => [k, f.kind])), {
    'media/film.mp4': 'video', 'media/film.srt': 'subtitles', 'media/notes.md': 'text',
    'media/Brand Kit/colours.txt': 'text', 'media/Brand Kit/Brand-Bold.ttf': 'font',
  })
  await win.keyboard.press('Escape')

  // removing a chip leaves the file in the project; the message carries the rest
  await win.locator('button[aria-label="Remove notes.md"]').click()
  await composer.fill('Burn these subtitles in with my font')
  if (shots) await win.screenshot({ path: join(shots, 'files-composer.png') })
  await composer.press('Enter')
  const bubble = win.locator('div.ml-auto:has-text("Burn these subtitles in with my font")')
  await bubble.waitFor()
  for (const chip of ['film.srt', 'Brand Kit/colours.txt', 'Brand Kit/Brand-Bold.ttf']) await bubble.locator(`span.truncate:text-is("${chip}")`).waitFor()
  assert.equal(await bubble.locator('text=[attached files]').count(), 0, 'the raw list is not shown')
  assert.equal(await bubble.locator('span.truncate:text-is("notes.md")').count(), 0, 'a removed chip is not sent')
  assert.equal(await win.locator('textarea[placeholder="What should AgentShot do with these?"]').count(), 0, 'the input has no chips after sending')
  if (shots) await win.screenshot({ path: join(shots, 'files-sent.png') })

  // more in the project, for @ below
  for (const f of ['b.mp4', 'song.mp3']) await win.evaluate(([d, f]) => window.manul.project.import(d, f), [dir, join(tmp, f)])

  // @ in the message box: a list of what's in the project; Escape closes it, picking one puts its name in and attaches it
  const box = win.locator('textarea[aria-autocomplete="list"]')
  const list = win.locator('[data-mentions]')
  await box.fill('x @nothing')
  await list.locator('text=Nothing in the project called “nothing”').waitFor()
  await box.press('Escape')
  await list.waitFor({ state: 'detached' })
  await box.fill('')
  await box.pressSequentially('Lay @so')
  await list.locator('[role="option"][aria-selected="true"]:has-text("song.mp3")').waitFor()
  if (shots) await win.screenshot({ path: join(shots, 'files-mention-list.png') })
  await box.press('ArrowDown'); await box.press('ArrowUp')
  await box.press('Enter')
  await list.waitFor({ state: 'detached' })
  assert.equal(await box.inputValue(), 'Lay @song.mp3 ')
  await win.locator('span:has(> span.truncate:text-is("song.mp3")) button[aria-label="Remove song.mp3"]').waitFor()
  if (shots) await win.screenshot({ path: join(shots, 'files-mention.png') })
  // what goes to the agent: the words, and the file attached (the main process adds what it is: test/mentions.test.ts)
  await app.evaluate(({ ipcMain }) => { globalThis.__sent = []; ipcMain.removeHandler('agent:send'); ipcMain.handle('agent:send', (_e, _d, m) => { globalThis.__sent.push(m) }) })
  await box.pressSequentially('under the opening')
  await box.press('Enter')
  await win.waitForFunction(() => !document.querySelector('textarea[aria-autocomplete="list"]').value)
  const sent = await app.evaluate(() => globalThis.__sent)
  assert.deepEqual(sent.map(m => [m.text, m.files]), [['Lay @song.mp3 under the opening', ['media/song.mp3']]])

  // delete in the project tree (the Trash is stubbed: nothing of the test lands in yours)
  await app.evaluate(({ shell }, trash) => {
    globalThis.__trashed = []
    shell.trashItem = async p => {
      globalThis.__trashed.push(p)
      const fs = process.getBuiltinModule('fs/promises')
      const path = process.getBuiltinModule('path')
      await fs.mkdir(trash, { recursive: true })
      await fs.rename(p, path.join(trash, path.basename(p)))
    }
  }, join(tmp, 'trash'))
  const srtRow = win.locator('li:has(span.truncate:text-is("film.srt"))')
  await srtRow.hover()
  await srtRow.locator('button[aria-label="Delete film.srt"]').click()
  await srtRow.locator('button:text-is("Delete")').click()
  await srtRow.waitFor({ state: 'detached' })
  // the film's own video stays, saying why
  const filmRow = win.locator('li:has(span.truncate:text-is("film.mp4"))')
  await filmRow.hover()
  await filmRow.locator('button[aria-label="Delete film.mp4"]').click()
  await filmRow.locator('button:text-is("Delete")').click()
  await win.waitForSelector('[data-files-tree] button[title*="Can\'t delete: it is the version “Original”."]')
  if (shots) await win.screenshot({ path: join(shots, 'files-delete.png') })
  // a whole folder at once
  const kitRow = win.locator('li:has(span.truncate:text-is("Brand Kit"))')
  await kitRow.hover()
  await kitRow.locator('button[aria-label="Delete the folder Brand Kit"]').click()
  await kitRow.locator('button:text-is("Delete")').click()
  await kitRow.waitFor({ state: 'detached' })
  const trashed = await app.evaluate(() => globalThis.__trashed)
  assert.deepEqual(trashed.map(t => t.slice(dir.length + 1)), ['media/film.srt', 'media/Brand Kit'])
  const after = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.deepEqual(Object.keys(after.files).sort(), ['media/b.mp4', 'media/film.mp4', 'media/notes.md', 'media/song.mp3'])
  console.log('files e2e: ok')
} finally {
  await app.close()
}
