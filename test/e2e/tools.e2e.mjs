// Tools page: the cloud section lists Upscale as coming soon (off until worker.trypitch.co serves it).
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'agentshot-tools-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'agentshot-ud-'))}`] })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.click('[aria-label="Settings"]') // the sidebar's gear
  await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Tools')
  await win.waitForSelector('text=Downloaded when needed')
  // cloud jobs are offered in Export, where they're used, and only once the worker offers them: nothing here says "Coming soon"
  const text = await win.getByRole('dialog').innerText()
  await win.getByLabel('Processing', { exact: true }).selectOption('cpu')
  await win.getByLabel('CPU threads per worker').selectOption('8')
  const performance = await win.evaluate(async () => (await window.agentshot.whisper.status()).performance)
  if (performance.device !== 'cpu' || performance.threads !== 8) throw new Error('Speech settings did not persist')
  await win.getByLabel('Processing', { exact: true }).selectOption('auto')
  await win.getByLabel('CPU threads per worker').selectOption('4')
  await win.screenshot({ path: join(out, 'tools.png') })
  if (/In the cloud|Coming soon/.test(text)) throw new Error(`Tools still lists cloud placeholders: ${text}`)
  console.log('tools e2e ok:', join(out, 'tools.png'))
} finally { await app.close() }
