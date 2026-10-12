// Settings → Keys → Other providers: import omp's custom providers (a fake ~/.omp with a key file), add one by hand,
// and their models reach the agent's model list. Talks to no real endpoint.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-providers-'))
const home = join(tmp, 'home')
mkdirSync(join(home, '.omp/agent'), { recursive: true })
writeFileSync(join(home, 'foundry-key'), 'sk-e2e-secret\n')
writeFileSync(join(home, '.omp/agent/models.yml'), `providers:
  azure-foundry:
    baseUrl: https://example.services.ai.azure.com/openai/v1
    api: openai-responses
    apiKey: "!cat ~/foundry-key"
    headers:
      api-key: "!cat ~/foundry-key"
    models:
      - id: gpt-5.6-terra
        name: GPT-5.6 Terra (Azure AI Foundry)
      - id: gpt-5.6-luna
        name: GPT-5.6 Luna (Azure AI Foundry)
`)
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, HOME: home, MANUL_PROJECTS: join(tmp, 'p') } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ Menu }) => { const f = it => { for (const i of it) { if (i.label === 'Keys…') return i; const s = i.submenu && f(i.submenu.items); if (s) return s } }; f(Menu.getApplicationMenu().items).click() })
  await dismissSettingsOnboarding(win)
  const dlg = win.locator('[role="dialog"]')
  await dlg.locator('text=Other providers').waitFor()

  // 1. import from omp: both models, the key read from the file, never shown
  await dlg.locator('button:has-text("Import from omp")').click()
  await dlg.locator('text=Imported Azure Foundry (2 models)').waitFor()
  await dlg.locator('text=GPT-5.6 Terra · GPT-5.6 Luna').waitFor()
  assert.ok(!(await win.content()).includes('sk-e2e-secret'), 'the key must never reach the page')
  assert.equal(await dlg.locator('span:has-text("Editing agent")').evaluate(e => getComputedStyle(e).textDecorationLine), 'none', 'a keyed provider unlocks the editing agent')

  // 2. add one by hand; a bad URL is explained, then it saves
  await dlg.locator('button:has-text("Add")').last().click()
  await dlg.locator('input[placeholder^="Name"]').fill('Local server')
  await dlg.locator('select').selectOption('openai-completions')
  await dlg.locator('input[placeholder^="Base URL"]').fill('http://example.com/v1')
  await dlg.locator('input[placeholder^="Model ids"]').fill('qwen-coder, llama-4')
  await dlg.locator('input[placeholder="API key"]').fill('sk-local')
  await dlg.locator('button:has-text("Save")').click()
  await dlg.locator('text=The base URL must use https').waitFor()
  await dlg.locator('input[placeholder^="Base URL"]').fill('http://localhost:8080/v1')
  await dlg.locator('button:has-text("Save")').click()
  await dlg.locator('text=Qwen Coder · Llama 4').waitFor()
  await dlg.locator('text=Other providers').scrollIntoViewIfNeeded()
  await win.screenshot({ path: join(tmp, 'providers.png') })

  // 3. the agent offers their models, labelled by provider
  const { models } = await win.evaluate(() => window.manul.agent.models())
  const ids = models.map(m => `${m.providerLabel}/${m.name}`)
  for (const want of ['Azure Foundry/GPT-5.6 Terra', 'Azure Foundry/GPT-5.6 Luna', 'Local server/Qwen Coder', 'Local server/Llama 4']) assert.ok(ids.includes(want), `${want} missing from ${ids}`)

  // 4. remove one: its models go too
  await dlg.locator('div.rounded-lg:has-text("Local server") >> button:has-text("Remove")').click()
  await dlg.locator('text=Qwen Coder · Llama 4').waitFor({ state: 'detached' })
  const after = (await win.evaluate(() => window.manul.agent.models())).models.map(m => m.provider)
  assert.ok(!after.includes('local-server'), 'removed provider still offered')
  console.log('providers e2e ok:', join(tmp, 'providers.png'))
} finally {
  await app.close()
}
