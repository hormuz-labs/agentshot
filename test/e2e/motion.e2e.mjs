// Motion videos from the start screen: the gallery of examples (posters, tag filter), the viewer (the whole video with
// sound, its maker, the prompt), using an example, and the project that makes: a blank canvas in the example's format,
// with the example's video as the reference. Needs the gallery's media (scripts/fetch-motion-gallery.mjs --media).
// Screenshots go to MANUL_E2E_SHOTS when set.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-motion-'))
const shots = process.env.MANUL_E2E_SHOTS
const ffmpeg = (...args) => execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', ...args])
ffmpeg('-f', 'lavfi', '-i', 'testsrc2=size=320x240:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'reference.mp4'))

const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$/.test(k)))
// screenshots at 2× (retina), like the README's other pictures
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, ...(shots ? ['--force-device-scale-factor=2'] : [])], env: {
  ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'p'),
} })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1200, height: 800 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ dialog, ipcMain }, tmp) => {
    globalThis.__picks = [[`${tmp}/reference.mp4`]]
    dialog.showOpenDialog = async () => { const filePaths = globalThis.__picks.shift() || []; return { canceled: !filePaths.length, filePaths } }
    globalThis.__sent = []
    ipcMain.removeHandler('agent:send')
    ipcMain.handle('agent:send', (_e, dir, msg) => { globalThis.__sent.push({ dir, ...msg }) })
  }, tmp)

  const gallery = win.locator('[data-gallery]')
  await gallery.locator('[data-example]').first().waitFor()
  assert.equal(await gallery.locator('[data-example]').count(), 12, 'the gallery opens on a first page of examples')
  await win.waitForFunction(() => [...document.querySelectorAll('[data-example] img')].slice(0, 4).every(i => i.complete && i.naturalWidth > 0))
  if (shots) { await gallery.scrollIntoViewIfNeeded(); await win.screenshot({ path: join(shots, 'gallery.png'), scale: 'device' }) }

  // A tag narrows the gallery to that tag's examples.
  await gallery.getByRole('tab', { name: /^Kinetic type/ }).click()
  assert.equal(await gallery.getByRole('tab', { name: /^Kinetic type/ }).getAttribute('aria-selected'), 'true')

  // The viewer: the whole video with sound and controls, who made it, and the prompt behind it.
  const first = gallery.locator('[data-example]').first()
  const id = await first.getAttribute('data-example')
  await first.click()
  const viewer = win.getByRole('dialog')
  await viewer.locator('video[controls]').waitFor()
  await win.waitForFunction(() => { const v = document.querySelector('[role=dialog] video'); return v && v.readyState >= 2 && v.duration > 1 })
  assert.equal(await viewer.locator('video').evaluate(v => v.muted), false, 'the viewer plays with sound')
  await viewer.getByText(/^by @/).waitFor()
  await viewer.getByText('View post').waitFor()
  if (shots) { await win.waitForTimeout(1200); await win.screenshot({ path: join(shots, 'viewer.png'), scale: 'device' }) }
  await viewer.getByRole('button', { name: 'Next example' }).click()
  await viewer.getByRole('button', { name: 'Previous example' }).click()
  await viewer.getByRole('button', { name: 'Use this example' }).click()
  await win.locator('[data-picked-example]').waitFor()
  assert.equal(await win.getByRole('dialog').count(), 0, 'using an example closes the viewer')
  assert.equal(await win.locator('[data-tour="start-prompt"]').getAttribute('placeholder'), 'What’s your video about?')
  await win.locator('[data-tour="start-prompt"]').fill('Launch video for AgentShot')
  if (shots) await win.screenshot({ path: join(shots, 'picked.png'), scale: 'device' })

  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('[data-project-title]')
  await win.waitForFunction(async () => (await window.agentshot.tabs.get()).active)
  const dir = await win.evaluate(() => window.agentshot.tabs.get().then(t => t.active))
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.equal(p.motion.example.id, id, 'the project remembers the example')
  assert.equal(p.motion.reference, `media/${id}.mp4`, 'the example video comes in as the reference')
  assert.ok(p.motion.example.handle, 'with its maker')
  assert.equal(p.title, 'Launch video for AgentShot')
  assert.equal(p.versions[0].path, 'media/canvas.mp4', 'the film starts on the blank canvas')
  assert.equal(p.timeline.fps, 60)
  await win.waitForFunction(() => !document.querySelector('[data-tour="start-prompt"]'))
  const sent = await app.evaluate(() => globalThis.__sent)
  assert.equal(sent.length, 1, 'the first request is sent once')
  assert.equal(sent[0].text, 'Launch video for AgentShot')
  assert.deepEqual(sent[0].files, [`media/${id}.mp4`], 'the reference comes with the request; the canvas does not')

  // Footage still means an edit: no gallery once a video is in the box.
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await gallery.waitFor()
  console.log('motion e2e: ok')
} finally {
  await app.close()
}
