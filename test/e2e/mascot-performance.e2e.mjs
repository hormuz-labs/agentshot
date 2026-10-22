// Compare real AG-UI IPC delivery and text display with the WebGL gallop on/off.
// Build first. Optional --throttle emulates a slower renderer CPU; no paid API calls.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareElectron } from '../../scripts/run-electron.mjs'
import { dismissOnboarding } from './onboarding.mjs'

const root = join(import.meta.dirname, '../..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-mascot-perf-'))
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') }
delete env.ELECTRON_RENDERER_URL
const app = await electron.launch({ cwd: root, executablePath: await prepareElectron(), args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.bringToFront()
  await app.evaluate(({ ipcMain, BrowserWindow }) => {
    ipcMain.removeHandler('agent:ready'); ipcMain.handle('agent:ready', () => true)
    BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents.send('agent:ready')
  })
  const video = join(tmp, 'Performance.mp4')
  execFileSync(join(root, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=640x360:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  await app.evaluate(({ ipcMain }, video) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [video]) }, video)
  await win.click('[data-tour="import"]')
  await win.getByRole('button', { name: 'Start', exact: true }).click()
  await win.waitForSelector('text=What should change?')
  await win.waitForSelector('[data-mascot-renderer="webgl"]')
  const project = await win.locator('[data-project-row][aria-current="true"]').getAttribute('data-project-row')
  const cdp = await win.context().newCDPSession(win)
  await cdp.send('Performance.enable')
  if (process.argv.includes('--throttle')) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
  const results = []
  // Reverse the order on the second pair to reduce warm-up/order bias.
  for (const animated of [false, true, true, false]) {
    await win.emulateMedia({ reducedMotion: animated ? 'no-preference' : 'reduce' })
    await app.evaluate(({ BrowserWindow }, project) => {
      const wc = BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents
      for (const event of [{ type: 'TEXT_MESSAGE_END' }, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'u', role: 'user', content: 'Performance check' }] }, { type: 'RUN_STARTED' }]) wc.send('agui', project, event)
    }, project)
    await win.waitForTimeout(600)
    await win.evaluate(project => {
      window.__perf = { received: [], displayed: [], longTasks: [] }
      const pending = []
      window.__perfOff = window.manul.agent.onEvent((dir, e) => {
        if (dir !== project || e.type !== 'TEXT_MESSAGE_CONTENT') return
        window.__perf.received.push(Date.now() - e.timestamp)
        pending.push({ text: e.delta.trim(), sent: e.timestamp })
      })
      const observer = new MutationObserver(() => {
        const text = document.body.textContent
        for (let i = pending.length - 1; i >= 0; i--) if (text.includes(pending[i].text)) {
          window.__perf.displayed.push(Date.now() - pending[i].sent); pending.splice(i, 1)
        }
      })
      observer.observe(document.body, { childList: true, subtree: true, characterData: true })
      const tasks = new PerformanceObserver(list => window.__perf.longTasks.push(...list.getEntries().map(e => e.duration)))
      tasks.observe({ type: 'longtask' })
      window.__perfStop = () => { window.__perfOff(); observer.disconnect(); tasks.disconnect() }
    }, project)
    const before = await metrics()
    await app.evaluate(async ({ BrowserWindow }, project) => {
      const wc = BrowserWindow.getAllWindows().find(w => w.isVisible()).webContents
      await new Promise(resolve => {
        let i = 0
        const timer = setInterval(() => {
          wc.send('agui', project, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'perf', delta: ` word${String(i++).padStart(4, '0')}`, timestamp: Date.now() })
          if (i === 150) { clearInterval(timer); resolve() }
        }, 20)
      })
    }, project)
    await win.waitForFunction(() => window.__perf.displayed.length === 150)
    const after = await metrics()
    const samples = await win.evaluate(() => { window.__perfStop(); return window.__perf })
    const p95 = values => [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)]
    assert.equal(samples.received.length, 150, 'every streamed delta is delivered')
    assert.equal(samples.displayed.length, 150, 'every streamed delta reaches the chat')
    results.push({ animated, ipcP95Ms: p95(samples.received), displayP95Ms: p95(samples.displayed), rendererBusyPct: Math.round(100 * (after.TaskDuration - before.TaskDuration) / (after.Timestamp - before.Timestamp)), longTasks: samples.longTasks.length })
  }
  console.table(results)
  const mean = (animated, key) => results.filter(r => r.animated === animated).reduce((sum, r) => sum + r[key], 0) / 2
  assert.ok(mean(true, 'displayP95Ms') < mean(false, 'displayP95Ms') + 50, 'mascot adds less than 50ms to p95 streamed-text display')
  console.log('mascot streaming performance: ok', process.argv.includes('--throttle') ? '(4× CPU throttle)' : '')
} finally {
  await app.close()
  rmSync(tmp, { recursive: true, force: true })
}
