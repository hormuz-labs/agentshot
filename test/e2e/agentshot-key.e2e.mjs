// Settings → Keys → AgentShot key: offers signing in (and its link, to open in another browser); pasting a key instead makes the agent use "AgentShot" (AgentShot's gateway picks the real model, see
// gateway.ts), the key never comes back to the page, and removing it takes the model away. Talks to no gateway.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-key-'))
const out = process.argv[2] || tmp
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'p') }
for (const k of ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'MANUL_KEY']) delete env[k] // only the AgentShot key
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  const models = () => win.evaluate(() => window.agentshot.agent.models())
  assert.equal((await models()).models.length, 0, 'no keys, no models')

  await win.click('[aria-label="Settings"]')
  await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Keys')
  await win.click('role=tab[name=/AgentShot key/]')
  await win.waitForSelector('button:has-text("Sign in to AgentShot")')

  // signing in, when the default browser has the wrong Google account: the waiting sign-in's link, to copy into
  // another browser (the browser itself stays shut here)
  await app.evaluate(({ shell }) => { shell.openExternal = async () => {} })
  await win.click('button:has-text("Sign in to AgentShot")')
  await win.click('[data-testid="copy-sign-in-link"]')
  await win.waitForSelector('text=Paste it in the browser with your Google account.')
  const link = await app.evaluate(({ clipboard }) => clipboard.readText())
  assert.match(link, /\/oauth\/authorize\?/, 'the link is the sign-in itself')
  assert.match(link, /redirect_uri=http%3A%2F%2F127\.0\.0\.1%3A47619%2Foauth%2Fcallback/, 'and it comes back to this computer')
  assert.match(link, /code_challenge=/, 'signed for this sign-in only')
  await win.screenshot({ path: join(out, 'agentshot-sign-in-link.png') })
  await win.click('button:has-text("Cancel")')
  await win.waitForSelector('button:has-text("Sign in to AgentShot")')

  await win.click('text=Have a key? Paste it')
  await win.fill('[aria-label="AgentShot key"]', 'sk-bf-e2e-secret')
  await win.click('button:has-text("Save")')
  await win.waitForSelector('text=AgentShot key added')
  await win.screenshot({ path: join(out, 'agentshot-key.png') })
  assert.ok(!(await win.content()).includes('sk-bf-e2e-secret'), 'the key never comes back to the page')

  const m = await models()
  assert.deepEqual(m.models.map(x => [x.providerLabel, x.modelId, x.name, x.price]), [['AgentShot', 'manul', 'AgentShot', undefined], ['AgentShot', 'manul-low', 'AgentShot Low', undefined], ['AgentShot', 'manul-medium', 'AgentShot Medium', undefined], ['AgentShot', 'manul-high', 'AgentShot High', undefined], ['AgentShot', 'manul-max', 'AgentShot Max (Pro plan)', undefined], ['AgentShot', 'manul-ultra', 'AgentShot Ultra (Pro plan)', undefined]], 'AgentShot models and tiers, no vendor, no price')
  assert.deepEqual(m.current, { provider: 'manul', modelId: 'manul' })

  await win.click('button:has-text("Remove")')
  await win.waitForSelector('button:has-text("Sign in to AgentShot")')
  assert.equal((await models()).models.length, 0, 'removing the key takes its models away')
  console.log('AgentShot key e2e ok:', join(out, 'agentshot-key.png'))
} finally {
  await app.close()
}
