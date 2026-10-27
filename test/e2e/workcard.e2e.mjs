// The agent's work in the desktop chat, as a non-editor reads it: each run of steps one card, in words (what it's
// doing now first, while it works), a failed step saying what it means, the commands only under Show details, and the
// AI's own failure in words. Fake AG-UI events (no paid AI calls); screenshots to SHOTS when given.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..'), tmp = mkdtempSync(join(tmpdir(), 'agentshot-workcard-e2e-'))
const shots = process.env.SHOTS || tmp
execFileSync(bundledBinary('ffmpeg'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=teal:s=640x360:r=25:d=4', '-c:v', 'libx264', join(tmp, 'clip.mp4')])
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$|ELECTRON_RUN_AS_NODE/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'], env: { ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1400, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [file]) }, join(tmp, 'clip.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  const project = await win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')
  const send = (type, rest = {}) => app.evaluate(({ BrowserWindow }, { project, type, rest }) => {
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agui', project, { type, timestamp: Date.now(), ...rest })
  }, { project, type, rest })
  const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } })
  const user = { id: 'u1', role: 'user', content: 'Tighten the opening and check the brief' }
  const steps = { id: 'a1', role: 'assistant', toolCalls: [
    call('c1', 'project_state', {}),
    call('c2', 'bash', { command: 'ls media renders' }),
    call('c3', 'read', { path: 'notes/brief.txt' }),
    call('c4', 'edit_timeline', { edits: [{ op: 'trim' }, { op: 'trim' }, { op: 'delete' }] }),
    call('c5', 'rerender_timeline', {}),
  ] }
  const done = (id, content, error) => ({ id: `t-${id}`, role: 'tool', toolCallId: id, content, ...(error ? { error } : {}) })
  const card = win.locator('[data-work-card]')

  // working: the now line first, the finished steps under it in words; the failed one says what it means
  await send('RUN_STARTED')
  await send('MESSAGES_SNAPSHOT', { messages: [user, steps, done('c1', '{}'), done('c2', 'media/clip.mp4\nrenders/'), done('c3', "ENOENT: no such file or directory, open 'notes/brief.txt'", 'tool error'), done('c4', 'ok')] })
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: ['c5'] } })
  await card.locator('[data-work-now]').waitFor()
  assert.match(await card.locator('[data-work-now]').innerText(), /Rendering|edit/i)
  for (const t of ['Looked at the project', 'Looked through the project’s files', 'Read brief.txt', 'Edited the cut: trimmed 2 pieces, removed a piece']) await card.getByText(t, { exact: true }).waitFor()
  await card.getByText('That file isn’t in the project.').waitFor()
  assert.equal(await card.getByText('ls media renders').count(), 0, 'no commands up front')
  await card.screenshot({ path: join(shots, 'work-live.png') })
  await win.screenshot({ path: join(shots, 'work-window.png') })

  // finished: in the order done, the reply under it; the AI's own failure in words, its message under details
  await send('MESSAGES_SNAPSHOT', { messages: [user, steps, done('c1', '{}'), done('c2', 'media/clip.mp4\nrenders/'), done('c3', "ENOENT: no such file or directory, open 'notes/brief.txt'", 'tool error'), done('c4', 'ok'), done('c5', 'renders/timeline-2.mp4'), { id: 'a2', role: 'assistant', content: 'Trimmed the opening. There was no brief in the project, so I went by the footage.' }] })
  await send('ACTIVITY_SNAPSHOT', { activityType: 'tools', content: { running: [] } })
  await send('RUN_ERROR', { message: 'An unknown error occurred' })
  await send('RUN_FINISHED')
  await card.locator('[data-work-now]').waitFor({ state: 'detached' })
  await card.getByText('Rendered the film', { exact: true }).waitFor()
  const problem = win.locator('[data-run-problem]')
  await problem.getByText('AgentShot stopped before it finished.', { exact: false }).waitFor()
  assert.equal(await problem.getByText('An unknown error occurred').count(), 0)
  await win.locator('[data-chat-message="a2"]').scrollIntoViewIfNeeded()
  const a = await card.boundingBox(), b = await problem.boundingBox()
  await win.screenshot({ path: join(shots, 'work-done.png'), clip: { x: a.x - 8, y: a.y - 8, width: a.width + 16, height: b.y + b.height - a.y + 16 } })

  // details: the command and its output, for whoever wants them
  await card.locator('[data-work-details]').click()
  await card.getByText('Looked through the project’s files').last().click()
  await card.getByText('$ ls media renders').waitFor()
  await card.screenshot({ path: join(shots, 'work-details.png') })
  await problem.getByText('Show details').click()
  await problem.getByText('An unknown error occurred').waitFor()
  console.log('workcard e2e ok')
} finally {
  await app.close().catch(() => {})
  rmSync(tmp, { recursive: true, force: true })
}
