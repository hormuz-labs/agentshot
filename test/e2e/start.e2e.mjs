// New-project batches: the native picker accepts multiple kinds, repeated picks and drops accumulate without
// duplicates, removals work, and every asset reaches the project and its first request before the editor opens.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-start-'))
const ffmpeg = (...args) => execFileSync(join(root, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', ...args])
for (const name of ['film', 'second']) ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x240:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, `${name}.mp4`))
ffmpeg('-f', 'lavfi', '-i', 'color=c=red:s=200x100', '-frames:v', '1', join(tmp, 'photo.png'))
ffmpeg('-f', 'lavfi', '-i', 'sine=duration=2', join(tmp, 'song.mp3'))
writeFileSync(join(tmp, 'notes.md'), 'Use warm colours.\n')

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
// Development React replays mount effects in StrictMode; cover that lifecycle as well as the packaged renderer.
let devServer
if (process.env.MANUL_E2E_DEV_RENDERER) {
  const [{ createServer }, { default: react }, { default: tailwindcss }] = await Promise.all([
    import('vite'), import('@vitejs/plugin-react'), import('@tailwindcss/vite'),
  ])
  devServer = await createServer({
    configFile: false, root: join(root, 'src/renderer'),
    resolve: { alias: { '@': join(root, 'src/renderer/src') } }, plugins: [react(), tailwindcss()],
    server: { host: '127.0.0.1', port: 0 },
  })
  await devServer.listen()
}
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: {
  ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'p'),
  ...(devServer ? { ELECTRON_RENDERER_URL: devServer.resolvedUrls.local[0] } : {}),
} })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 860 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ dialog, ipcMain }, tmp) => {
    globalThis.__picks = [
      ['photo.png', 'song.mp3', 'notes.md'],
      ['film.mp4', 'second.mp4', 'photo.png'],
      [],
    ].map(names => names.map(n => `${tmp}/${n}`))
    globalThis.__dialogs = []
    dialog.showOpenDialog = async (_win, options) => {
      globalThis.__dialogs.push(options)
      const filePaths = globalThis.__picks.shift()
      return { canceled: !filePaths.length, filePaths }
    }
    globalThis.__sent = []
    ipcMain.removeHandler('agent:send')
    ipcMain.handle('agent:send', (_e, dir, msg) => { globalThis.__sent.push({ dir, ...msg }) })
  }, tmp)

  await win.click('[data-tour="import"]')
  await win.getByText('3 items selected', { exact: true }).waitFor()
  assert.equal(await win.locator('[data-selected-file]').count(), 3, 'photos and audio can be selected before footage')
  await win.getByRole('button', { name: 'Add more files' }).click()
  await win.getByText('5 items selected', { exact: true }).waitFor()
  await win.getByRole('button', { name: 'Choose files', exact: true }).click()
  assert.equal(await win.locator('[data-selected-file]').count(), 5, 'canceling leaves the selection intact')
  await win.getByRole('button', { name: 'Remove notes.md', exact: true }).click()
  await win.getByText('4 items selected', { exact: true }).waitFor()

  // Real disk-backed File objects exercise pathForFile and the start screen's multi-file drop handler.
  await win.evaluate(() => {
    const input = document.createElement('input')
    input.type = 'file'; input.multiple = true; input.id = 'drop-fixture'; input.hidden = true
    document.body.append(input)
  })
  await win.locator('#drop-fixture').setInputFiles([join(tmp, 'notes.md'), join(tmp, 'film.mp4')])
  await win.locator('[data-tour="import"]').evaluate(el => {
    const input = document.querySelector('#drop-fixture'), dt = new DataTransfer()
    for (const file of input.files) dt.items.add(file)
    el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }))
    input.remove()
  })
  await win.getByText('5 items selected', { exact: true }).waitFor()

  const dialogs = await app.evaluate(() => globalThis.__dialogs)
  assert.equal(dialogs.length, 3)
  for (const options of dialogs) {
    assert.ok(options.properties.includes('multiSelections'), 'native picker allows multiple selections')
    assert.equal(options.filters, undefined, 'native picker accepts every file kind')
  }
  await win.locator('[data-tour="start-prompt"]').fill('Combine these files into a film')
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('[data-project-title]')
  await win.waitForFunction(async () => (await window.manul.tabs.get()).active)
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const expected = ['media/photo.png', 'media/song.mp3', 'media/film.mp4', 'media/second.mp4', 'media/notes.md']
  assert.deepEqual(Object.keys(p.files), expected, 'the complete batch is persisted')
  assert.equal(p.versions[0].path, 'media/film.mp4', 'the first playable video initializes the film')
  for (const name of ['photo.png', 'song.mp3', 'film.mp4', 'second.mp4', 'notes.md']) {
    await win.locator(`[data-files-tree] button:has-text("${name}")`).waitFor()
  }
  await win.waitForFunction(() => !document.querySelector('[data-tour="start-prompt"]'))
  const sent = await app.evaluate(() => globalThis.__sent)
  assert.equal(sent.length, 1, 'the first request is sent once')
  assert.equal(sent[0].text, 'Combine these files into a film')
  assert.deepEqual(sent[0].files, expected, 'the first request carries every imported file')
  const composer = win.locator('[data-tour="composer"]')
  await composer.locator('textarea[placeholder="Ask for an edit, or @ a file, version or clip…"]').waitFor({ timeout: 5000 })
  assert.equal(await composer.locator('button[aria-label^="Remove "]').count(), 0, 'submitted startup files do not reappear as draft attachments')
  await composer.locator('textarea').fill('Make the opening shorter')
  await composer.getByRole('button', { name: 'Send', exact: true }).click()
  await composer.locator('textarea').waitFor()
  const followup = await app.evaluate(() => globalThis.__sent)
  assert.equal(followup.length, 2)
  assert.deepEqual(followup[1].files, [], 'a follow-up request does not resend the initial attachments')
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).files), expected, 'the imported files stay in the project')

  // Starting without instructions leaves the files available for the first draft, with immediate removal.
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await win.locator('[data-tour="start-prompt"]').waitFor()
  await app.evaluate(({ ipcMain }, files) => {
    ipcMain.removeHandler('project:pick')
    ipcMain.handle('project:pick', () => files)
  }, [join(tmp, 'film.mp4'), join(tmp, 'second.mp4')])
  await win.click('[data-tour="import"]')
  await win.getByText('2 items selected', { exact: true }).waitFor()
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  const draft = win.locator('[data-tour="composer"]:visible')
  await draft.getByRole('button', { name: 'Remove film.mp4', exact: true }).waitFor()
  await draft.getByRole('button', { name: 'Remove film.mp4', exact: true }).click()
  await draft.getByRole('button', { name: 'Remove film.mp4', exact: true }).waitFor({ state: 'detached' })
  await draft.getByRole('button', { name: 'Remove second.mp4', exact: true }).click()
  await draft.locator('textarea[placeholder="Ask for an edit, or @ a file, version or clip…"]').waitFor()
  assert.equal((await app.evaluate(() => globalThis.__sent)).length, 2, 'starting without a prompt does not send a request')
  console.log('start e2e: ok')
} finally {
  await app.close()
  await devServer?.close()
}
