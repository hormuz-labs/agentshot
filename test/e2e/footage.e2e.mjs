// Footage, from the project's top bar: every file brought in, as pictures (a frame of each video, each photo itself,
// an icon for sound) with how long it runs; filtered by kind; attached to the next message for the agent from there,
// and a video put into the film at the playhead. And an import that fails says which file and why, in plain words, in
// a card in view (not a raw error, not only the jobs tray), and goes when dismissed. Run after npm run build.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-footage-'))
const shots = process.env.MANUL_E2E_SHOTS
const ff = args => execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', ...args])
ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=25:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'film.mp4')])
ff(['-f', 'lavfi', '-i', 'testsrc=size=320x240:r=30:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'second.mp4')])
ff(['-f', 'lavfi', '-i', 'testsrc2=size=800x600:d=1', '-frames:v', '1', join(tmp, 'still.jpg')])
ff(['-f', 'lavfi', '-i', 'sine=duration=3', join(tmp, 'song.mp3')])

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
  const dir = await win.evaluate(() => window.agentshot.tabs.get().then(t => t.active))
  const pickAnswers = async files => app.evaluate(({ ipcMain }, fs) => { ipcMain.removeHandler('project:pickFiles'); ipcMain.handle('project:pickFiles', () => fs) }, files)

  // Footage opens from the top bar, beside Show in Finder and the browser
  await win.getByRole('button', { name: 'Footage', exact: true }).click()
  const panel = win.locator('[data-footage-panel]')
  await panel.waitFor()
  await panel.locator('[data-footage="media/film.mp4"]').waitFor()

  // more brought in from the panel itself: another video, a photo, a song
  await pickAnswers([join(tmp, 'second.mp4'), join(tmp, 'still.jpg'), join(tmp, 'song.mp3')])
  await panel.getByRole('button', { name: 'Add files' }).click()
  for (const f of ['second.mp4', 'still.jpg', 'song.mp3']) await panel.locator(`[data-footage="media/${f}"]`).waitFor({ timeout: 60_000 })
  await panel.locator('text=4 files').waitFor()

  // each video shows a frame of itself, the photo itself (both really loaded), the song its icon; lengths on the clips
  const loaded = async rel => {
    const img = panel.locator(`[data-footage="${rel}"] img`)
    await img.waitFor({ timeout: 60_000 })
    await win.waitForFunction(el => el.complete && el.naturalWidth > 0, await img.elementHandle(), { timeout: 60_000 })
  }
  for (const rel of ['media/film.mp4', 'media/second.mp4', 'media/still.jpg']) await loaded(rel)
  assert.equal(await panel.locator('[data-footage="media/song.mp3"] img').count(), 0, 'sound has no picture, its icon instead')
  await panel.locator('[data-footage="media/film.mp4"] span:text-is("0:04")').waitFor()
  await panel.locator('[data-footage="media/song.mp3"] span:text-is("0:03")').waitFor()
  if (shots) await win.screenshot({ path: join(shots, 'footage.png') })

  // by kind
  const count = () => panel.locator('[data-footage]').count()
  await panel.getByRole('tab', { name: 'Videos' }).click()
  assert.equal(await count(), 2, 'videos')
  await panel.getByRole('tab', { name: 'Photos' }).click()
  assert.equal(await count(), 1, 'photos')
  await panel.getByRole('tab', { name: 'Sound' }).click()
  assert.equal(await count(), 1, 'sound')
  await panel.getByRole('tab', { name: 'All' }).click()
  assert.equal(await count(), 4, 'all')

  // for the agent: what just came in is attached to the next message (as anywhere in the app); off and on again
  // from its card, the message box following
  const second = panel.locator('[data-footage="media/second.mp4"]')
  const chip = win.locator('span:has(> span.truncate:text-is("second.mp4"))')
  await second.getByRole('button', { name: 'Attached' }).click()
  await second.getByRole('button', { name: 'Attach', exact: true }).waitFor()
  await chip.first().waitFor({ state: 'detached' })
  await second.getByRole('button', { name: 'Attach', exact: true }).click()
  await second.getByRole('button', { name: 'Attached' }).waitFor()
  await chip.first().waitFor()
  // photos and sound can be attached too, but only footage goes into the film from here
  assert.equal(await panel.locator('[data-footage="media/still.jpg"]').getByRole('button', { name: 'Film' }).count(), 0)

  // into the film at the playhead: the panel closes and the timeline has it
  const before = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')).timeline?.items?.length ?? 1
  await second.getByRole('button', { name: 'Film' }).click()
  await panel.waitFor({ state: 'detached' })
  await win.waitForFunction(([d, n]) => window.agentshot.project.open(d).then(p => (p.timeline?.items?.length ?? 0) > n), [dir, before], { timeout: 30_000 })

  // an import that fails: a card says which file and why, in words (no "Error invoking", no path), until dismissed
  await pickAnswers([join(tmp, 'gone.mp4')])
  await win.getByRole('button', { name: 'Footage', exact: true }).click()
  await panel.getByRole('button', { name: 'Add files' }).click()
  const card = win.locator('[data-import-problem="gone.mp4"]')
  await card.waitFor()
  await card.locator('text=Couldn’t add gone.mp4').waitFor()
  const why = await card.locator('p').innerText()
  assert.match(why, /isn’t on the computer any more/, `it says why (${why})`)
  assert.doesNotMatch(why, /Error invoking|ENOENT|\/tmp\/|\\\\/, 'and nothing of the machine')
  if (shots) await win.screenshot({ path: join(shots, 'import-problem.png') })
  await card.getByRole('button', { name: 'Dismiss' }).first().click()
  await card.waitFor({ state: 'detached' })
  console.log('footage e2e: ok')
} finally {
  await app.close()
}
