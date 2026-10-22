// Tools page: the cloud section lists Upscale as coming soon (off until worker.trypitch.co serves it).
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const out = process.argv[2] || mkdtempSync(join(tmpdir(), 'manul-tools-e2e-'))
const app = await electron.launch({ args: ['.', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'manul-ud-'))}`] })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.click('[aria-label="Settings"]') // the sidebar's gear
  await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Tools')
  await win.waitForSelector('text=In the cloud')
  const row = win.locator('[data-cloud-tool="upscale"]')
  const text = await row.innerText()
  const disabled = await row.getAttribute('aria-disabled')
  await row.scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(out, 'tools.png') })
  if (!/Upscale/.test(text) || !/Coming soon/.test(text) || disabled !== 'true') throw new Error(`upscale row wrong: ${text}`)
  console.log('tools e2e ok:', join(out, 'tools.png'))
} finally { await app.close() }
