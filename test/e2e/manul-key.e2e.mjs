// Settings → Keys → Manul key: offers signing in; pasting a key instead makes the agent use "Manul" (Manul's gateway picks the real model, see
// gateway.ts), the key never comes back to the page, and removing it takes the model away. Talks to no gateway.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-key-'))
const out = process.argv[2] || tmp
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'p') }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MANUL_KEY']) delete env[k] // only the Manul key
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  const models = () => win.evaluate(() => window.manul.agent.models())
  assert.equal((await models()).models.length, 0, 'no keys, no models')

  await win.click('[aria-label="Settings"]')
  await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Keys')
  await win.click('role=tab[name=/Manul key/]')
  await win.waitForSelector('button:has-text("Sign in to Manul")')
  await win.click('text=Have a key? Paste it')
  await win.fill('[aria-label="Manul key"]', 'sk-bf-e2e-secret')
  await win.click('button:has-text("Save")')
  await win.waitForSelector('text=Manul key added')
  await win.screenshot({ path: join(out, 'manul-key.png') })
  assert.ok(!(await win.content()).includes('sk-bf-e2e-secret'), 'the key never comes back to the page')

  const m = await models()
  assert.deepEqual(m.models.map(x => [x.providerLabel, x.modelId, x.name, x.price]), [['Manul', 'manul', 'Manul', undefined]], 'one model, no vendor, no price')
  assert.deepEqual(m.current, { provider: 'manul', modelId: 'manul' })

  await win.click('button:has-text("Remove")')
  await win.waitForSelector('button:has-text("Sign in to Manul")')
  assert.equal((await models()).models.length, 0, 'removing the key takes its models away')
  console.log('manul key e2e ok:', join(out, 'manul-key.png'))
} finally {
  await app.close()
}
