// Instructions from the selection itself: a box drawn on the picture, a range dragged on the timeline and a note (N)
// each open a message box right there, and what's typed goes to the agent with that selection, as from the chat, with
// the conversation shut. (The send is caught in the main process; no model is called.)
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
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-inline-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'clip.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
const sent = () => app.evaluate(() => globalThis.__sent || [])
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1600, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => {
    ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f])
    ipcMain.removeHandler('agent:send'); ipcMain.handle('agent:send', (_e, dir, msg) => { (globalThis.__sent ||= []).push(msg) })
  }, join(tmp, 'clip.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  await win.waitForFunction(() => document.querySelector('video')?.readyState >= 2)
  await win.click('[aria-label="Conversation"]') // shut the conversation: the film takes the window
  await win.waitForTimeout(300)

  // 1. a box on the picture: the message box opens under it, typed into at once
  await win.locator('button:has-text("Box")').click()
  const stage = await win.locator('video').first().boundingBox()
  const x = stage.x + stage.width * 0.3, y = stage.y + stage.height * 0.3
  await win.mouse.move(x, y); await win.mouse.down(); await win.mouse.move(x + 160, y + 90, { steps: 6 }); await win.mouse.up()
  const ask = win.locator('[data-inline-ask]')
  await ask.waitFor()
  assert.match(await ask.innerText(), /box/, 'it says what it points at')
  const box = await ask.boundingBox()
  assert.ok(box.y > y + 90 && box.x < x + 160 && box.x + box.width > x, 'it opens just under the box')
  await win.keyboard.type('blur this')
  await win.keyboard.press('Enter')
  await win.waitForFunction(() => !document.querySelector('[data-inline-ask]'))
  let s = await sent()
  assert.equal(s.length, 1)
  assert.equal(s[0].text, 'blur this')
  assert.ok(s[0].anchor?.box && s[0].still?.startsWith('data:image'), 'the box and a still of the frame go with it')

  // 2. a range dragged on the timeline: the message box opens above it
  const bar = await win.getByTestId('timeline-scrubber').boundingBox()
  await win.mouse.move(bar.x + bar.width * 0.2, bar.y + 30); await win.mouse.down()
  await win.mouse.move(bar.x + bar.width * 0.5, bar.y + 30, { steps: 8 }); await win.mouse.up()
  await ask.waitFor()
  const above = await ask.boundingBox()
  assert.ok(above.y + above.height <= bar.y, 'it opens above the timeline')
  await win.keyboard.type('cut this')
  await win.keyboard.press('Enter')
  await win.waitForFunction(() => !document.querySelector('[data-inline-ask]'))
  s = await sent()
  assert.equal(s[1].text, 'cut this')
  assert.ok(s[1].anchor.t1 > s[1].anchor.t0 + 1, `the range goes with it (${JSON.stringify(s[1].anchor)})`)

  // 3. N: a note at the playhead; Esc cancels it and sends nothing
  await win.locator('video').first().click({ position: { x: 5, y: 5 } }).catch(() => {}) // focus the window, off the box
  await win.locator('video').first().evaluate(v => v.pause())
  await win.keyboard.press('n')
  await ask.waitFor()
  await win.keyboard.press('Escape')
  await win.waitForFunction(() => !document.querySelector('[data-inline-ask]'))
  assert.equal((await sent()).length, 2, 'Esc sends nothing')

  // the conversation stayed shut throughout
  assert.equal(await win.locator('text=What should change?').count(), 0, 'no need to open the chat')
  console.log('inline e2e: ok')
} finally {
  await app.close()
}
