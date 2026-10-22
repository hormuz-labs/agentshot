// A non-editor creates an actual auto-synced demo, adjusts the live face layer, undoes, saves and exports.
// Ordinary chat submission is captured (no paid model), then the backend composition is exercised separately.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..'), tmp = mkdtempSync(join(tmpdir(), 'manul-demo-e2e-'))
const ffmpeg = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const ff = (...args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args])
ff('-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=25:d=24', '-f', 'lavfi', '-i', "anoisesrc=seed=42:d=24:r=16000,volume='0.2+0.15*sin(1.3*t)+0.05*sin(3.7*t)':eval=frame", '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(tmp, 'screen.mp4'))
ff('-f', 'lavfi', '-i', 'color=c=red:s=320x240:r=30:d=18', '-ss', '2.13', '-t', '18', '-i', join(tmp, 'screen.mp4'), '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(tmp, 'camera.mp4'))
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/_API_KEY$|_TOKEN$|ELECTRON_RUN_AS_NODE/.test(k)))
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...env, ANTHROPIC_API_KEY: 'sk-ant-e2e-not-a-real-key', MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1500, height: 900 })
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, file) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [file]) }, join(tmp, 'screen.mp4'))
  await win.click('[data-tour="import"]'); await win.locator('button[aria-label="Start"]').click()
  await win.waitForSelector('[data-project-title]')
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  await win.evaluate(([dir, file]) => window.manul.project.import(dir, file), [dir, join(tmp, 'camera.mp4')])
  const noAutoDemo = async () => {
    assert.equal(await win.getByRole('button', { name: 'Auto Demo', exact: true }).count(), 0, 'multiple videos never add an Auto Demo button')
    assert.equal(await win.locator('[data-demo-toolbox]').count(), 0, 'no automatic demo setup in ordinary chat')
  }
  await noAutoDemo()
  await win.reload()
  await win.locator('[data-project-title]').waitFor()
  await noAutoDemo()
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => false)
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready')
  })
  await win.getByText('Add an API key', { exact: false }).first().waitFor()
  await noAutoDemo()
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready')
  })
  await app.evaluate(({ ipcMain }, dir) => {
    globalThis.__demoRequests = []
    ipcMain.removeHandler('agent:send')
    ipcMain.handle('agent:send', (e, d, request) => {
      globalThis.__demoRequests.push({ dir: d, ...request })
      e.sender.send('agui', d, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'demo-brief', role: 'user', content: `${request.text}\n\n[attached files]\n${request.files.map(f => `- ${f} — video`).join('\n')}` }] })
    })
  }, dir)
  const brief = 'Create a synced screen + face-camera demo using media/screen.mp4 and media/camera.mp4. Use a circle, top right, 128 × 128 px, cleanup: none.'
  await win.locator('[data-tour="composer"] textarea').fill(brief)
  await win.getByRole('button', { name: 'Send', exact: true }).click()
  const requests = await app.evaluate(() => globalThis.__demoRequests)
  assert.equal(requests.length, 1, 'the ordinary composer submits exactly one chat request')
  assert.match(requests[0].text, /circle, top right, 128 × 128 px/)
  assert.match(requests[0].text, /cleanup: none/)
  await win.getByText(brief, { exact: false }).first().waitFor()
  await noAutoDemo()
  let p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.equal(p.versions.length, 1, 'chat submits a brief instead of generating a video itself')
  // Separately verify the deterministic tool backend an agent invokes after receiving the brief.
  await win.evaluate(dir => window.manul.demo.create(dir, { screen: 'media/screen.mp4', camera: 'media/camera.mp4', corner: 'top-right', layout: { shape: 'circle', width: 128, height: 128 }, cleanup: 'none', audio: 'screen' }), dir)
  await win.getByRole('button', { name: 'Accept', exact: true }).waitFor({ timeout: 60000 })
  p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const version = p.versions.find(v => v.id === p.proposal)
  assert.ok(version.timeline.demo.sync.reliable)
  assert.ok(Math.abs(version.timeline.demo.sync.offset - 2.13) < 0.035, `Measured offset ${version.timeline.demo.sync.offset}`)
  assert.equal(version.timeline.demo.layout.shape, 'circle')
  await app.evaluate(({ BrowserWindow }, data) => {
    globalThis.__demoOutputMessages = [
      { id: 'demo-user', role: 'user', content: 'Make my demo.' },
      { id: 'demo-compose', role: 'assistant', toolCalls: [{ id: 'demo-call', type: 'function', function: { name: 'compose_demo', arguments: '{}' } }] },
      { id: 'demo-result', role: 'tool', toolCallId: 'demo-call', content: JSON.stringify({ version: data.version }) },
      { id: 'demo-output', role: 'assistant', content: 'Your synced demo is ready. Would you like to adjust your face layout?' },
    ]
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agui', data.dir, { type: 'MESSAGES_SNAPSHOT', messages: globalThis.__demoOutputMessages })
  }, { dir, version: version.id })
  await win.locator('[data-demo-followup]').waitFor()
  assert.equal(await win.locator('[data-chat-message="demo-output"] [data-demo-followup]').count(), 1, 'follow-up belongs directly to the output reply')
  await app.evaluate(({ BrowserWindow }, dir) => {
    globalThis.__demoOutputMessages.push({ id: 'next-message', role: 'user', content: 'Make the pacing tighter next.' })
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agui', dir, { type: 'MESSAGES_SNAPSHOT', messages: globalThis.__demoOutputMessages })
  }, dir)
  await win.locator('[data-chat-message="next-message"]').waitFor()
  assert.equal(await win.locator('[data-chat-message="demo-output"] [data-demo-followup]').count(), 1, 'new messages do not pull the follow-up to the chat bottom')
  assert.ok(await win.locator('[data-chat-message="demo-output"]').evaluate(el => !!(el.compareDocumentPosition(document.querySelector('[data-chat-message="next-message"]')) & Node.DOCUMENT_POSITION_FOLLOWING)))
    assert.equal(await win.locator('[data-camera-controls]').count(), 0, 'controls stay hidden until the post-output question is answered')
  await win.getByRole('button', { name: 'Yes, adjust layout', exact: true }).click()
  await win.locator('[data-camera-controls]').waitFor()
  assert.equal(await win.locator('[data-contextual-tools] [data-camera-controls]').count(), 0, 'adjustment controls are in the chat only')
  await win.waitForSelector('[data-demo-camera]', { state: 'attached' })
  // Seek through the real edit player via transport; the camera must follow source time.
  await win.locator('[data-edit-player="0"]').evaluate(v => { v.currentTime = 5 })
  await win.waitForFunction(() => { const cam = document.querySelector('[data-demo-camera]'); return cam && cam.currentTime > 2.7 && cam.currentTime < 3.1 })
  await win.getByLabel('Camera width').fill('100')
  await win.waitForFunction(() => document.querySelector('[data-camera-controls]').textContent.includes('100 × 100'))
  assert.equal(await win.locator('[data-demo-camera]').evaluate(v => v.parentElement.style.width).then(parseFloat) > 0, true)
  await win.evaluate(dir => window.manul.timeline.undo(dir), dir)
  await win.waitForFunction(() => document.querySelector('[data-camera-controls]').textContent.includes('128 × 128'))
  const camBox = await win.locator('[data-demo-camera]').evaluate(v => { const r = v.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  const oldX = await win.getByLabel('Camera x', { exact: true }).inputValue()
  await win.mouse.move(camBox.x + camBox.width / 2, camBox.y + camBox.height / 2); await win.mouse.down()
  await win.mouse.move(camBox.x + camBox.width / 2 - 50, camBox.y + camBox.height / 2 + 25, { steps: 5 }); await win.mouse.up()
  await win.waitForFunction(oldX => document.querySelector('[data-camera-controls] input[aria-label="Camera x"]').value !== oldX, oldX)
  await win.getByRole('button', { name: 'Adjust video inside', exact: true }).click()
  await win.locator('[data-full-source-video]').waitFor()
  const originalSource = await win.locator('[data-full-source-video]').evaluate(v => ({ src: v.src, width: v.videoWidth, height: v.videoHeight, clip: v.style.clipPath }))
  assert.ok(originalSource.src.includes('/media/camera.mp4'), 'framing uses the original recording, not a proxy')
  assert.equal(originalSource.width, 320)
  assert.equal(originalSource.height, 240)
  assert.equal(originalSource.clip, '', 'source preview is not cropped to the mask')
  const full = await win.locator('[data-source-framing] [aria-label="Reframe full original video"]').boundingBox()
  await win.mouse.move(full.x + full.width / 2, full.y + full.height / 2); await win.mouse.down()
  await win.mouse.move(full.x + full.width / 2 + 10, full.y + full.height / 2 - 5, { steps: 5 }); await win.mouse.up()
  const inside = await win.locator('[data-demo-camera]').evaluate(v => { const r = v.parentElement.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })
  const shapeY = await win.getByLabel('Camera y', { exact: true }).inputValue()
  await win.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2); await win.mouse.down()
  await win.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2 - 18, { steps: 5 }); await win.mouse.up()
  await win.waitForFunction(() => Number(document.querySelector('[aria-label="Camera source y"]').value) < 0)
  assert.equal(await win.getByLabel('Camera y', { exact: true }).inputValue(), shapeY, 'reframing moves source, not the shape')
  await win.getByLabel('Camera video zoom').fill('1.3')
  await win.getByRole('button', { name: 'Video placement', exact: true }).click()
  await win.getByLabel('Video scale', { exact: true }).fill('80')
  await win.getByLabel('Video offset x', { exact: true }).fill('10')
  await win.waitForFunction(() => document.querySelector('[data-video-viewport] video').style.width !== '')
  const picture = await win.locator('[data-video-viewport]').boundingBox()
  await win.mouse.move(picture.x + picture.width / 2, picture.y + picture.height / 2); await win.mouse.down()
  await win.mouse.move(picture.x + picture.width / 2 + 20, picture.y + picture.height / 2 + 10, { steps: 5 }); await win.mouse.up()
  await win.waitForFunction(() => Number(document.querySelector('[aria-label="Video offset x"]').value) > 10)
  const resize = await win.locator('[data-video-resize]').boundingBox()
  await win.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await win.mouse.down()
  await win.mouse.move(resize.x + resize.width / 2 + 15, resize.y + resize.height / 2, { steps: 5 }); await win.mouse.up()
  await win.waitForFunction(() => Number(document.querySelector('[aria-label="Video scale"]').value) > 80)
  await win.getByRole('button', { name: 'Render adjusted video in chat', exact: true }).click()
  const adjustmentRequests = await app.evaluate(() => globalThis.__demoRequests)
  assert.equal(adjustmentRequests.length, 2, 'adjustment rendering goes through chat')
  assert.match(adjustmentRequests[1].text, /rerender_timeline/)
  assert.deepEqual(adjustmentRequests[1].files, [])
  await win.locator('[data-camera-controls]').waitFor({ state: 'detached' })
  // Save and Export while the same adjusted timeline is still rendering: one version, never two writers.
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, join(tmp, 'concurrent.mp4'))
  const beforeRace = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const [saved, savedAgain, concurrentExport] = await win.evaluate(dir => Promise.all([
    window.manul.timeline.render(dir), window.manul.timeline.render(dir),
    window.manul.export.run(dir, { preset: 'original', captions: 'none' }),
  ]), dir)
  assert.equal(saved, savedAgain, 'simultaneous saves share the same render')
  assert.equal(concurrentExport.file, join(tmp, 'concurrent.mp4'))
  p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  assert.equal(p.versions.length, beforeRace.versions.length + 1, 'Save/Export adds just one completed version')
  assert.equal(new Set(p.versions.map(v => v.path)).size, p.versions.length, 'versions never share a writable render path')
  assert.deepEqual(p.timeline.demo.sync, beforeRace.timeline.demo.sync, 'layout/export retains measured sync exactly')
  assert.deepEqual(p.timeline.items, beforeRace.timeline.items, 'layout/export retains linked cuts and framing exactly')
  ff('-xerror', '-i', join(tmp, 'concurrent.mp4'), '-f', 'null', '-')
  assert.equal(p.timeline.demo.camera, 'media/camera.mp4')
  assert.equal(p.timeline.demo.sync.reliable, true)
  assert.ok(p.timeline.demo.layout.framing.y < 0)
  assert.equal(p.timeline.demo.layout.framing.zoom, 1.3)
  assert.ok(p.timeline.items[0].framing.zoom > 0.8)
  assert.ok(p.timeline.items[0].framing.x > 0.1)
  // Live video elements explicitly control their own visibility. Background project roots must use display:none,
  // otherwise those descendants can override visibility:hidden and leak behind New Project.
  await win.getByRole('button', { name: 'New project', exact: true }).click()
  await win.locator('[data-new-project]').waitFor()
  const leaked = await win.locator('video').evaluateAll(videos => videos.filter(v => v.checkVisibility({ visibilityProperty: true })).length)
  assert.equal(leaked, 0, 'previous project videos cannot appear behind the new-project dashboard')
  await win.locator('[data-project-row]').filter({ hasText: 'screen' }).first().click()
  await win.locator('[data-project-view]:visible').waitFor()
  await app.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }) }, join(tmp, 'final.mp4'))
  const exported = await win.evaluate(dir => window.manul.export.run(dir, { preset: 'original', captions: 'none' }), dir)
  assert.equal(exported.file, join(tmp, 'final.mp4'))
  const reopened = await win.evaluate(dir => window.manul.project.open(dir), dir)
  assert.equal(reopened.timeline.demo.sync.reliable, true, 'linked sources survive reopening')
  const blocked = await win.evaluate(dir => window.manul.project.removeFiles(dir, ['media/camera.mp4']), dir)
  assert.equal(blocked.blocked.length, 1, 'camera source stays protected while a linked version uses it')
  console.log('auto demo e2e: sync, compose, live layout, undo, source protection, render, export and reopen ok')
} finally { await app.close(); rmSync(tmp, { recursive: true, force: true }) }
