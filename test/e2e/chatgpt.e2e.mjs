// Real desktop IPC/UI and OAuth callback. Only provider HTTP and secure-storage
// availability are replaced inside the disposable Electron process. No production bypass.
import { _electron as electron } from 'playwright-core'
import { generateKeyPairSync } from 'node:crypto'
import { tmpdir } from 'node:os'
import { mkdtempSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-chatgpt-'))
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, ...(process.platform === 'linux' ? ['--password-store=basic'] : [])],
  env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p'), GEMINI_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '', MANUL_KEY: '' } })
try {
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 1000 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  if (process.platform === 'linux') {
    const unavailable = await win.evaluate(() => window.agentshot.chatgpt.status())
    assert.equal(unavailable.available, false, 'Linux basic_text must fail closed')
  }
  await app.evaluate(async ({ safeStorage, shell }, { jwk, pem }) => {
    const { sign } = process.getBuiltinModule('node:crypto')
    if (process.platform === 'linux') safeStorage.setUsePlainTextEncryption(true)
    safeStorage.isEncryptionAvailable = () => true
    safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
    const originalFetch = globalThis.fetch
    let nonce
    shell.openExternal = async raw => {
      const url = new URL(raw)
      if (url.hostname !== 'auth.openai.com') return
      nonce = url.searchParams.get('nonce')
      const callback = new URL(url.searchParams.get('redirect_uri'))
      callback.search = new URLSearchParams({ code: 'synthetic-code', state: url.searchParams.get('state'), client_id: 'oaiapp_e2e' }).toString()
      await originalFetch(callback)
    }
    globalThis.fetch = async (input, init) => {
      const url = String(input)
      const json = v => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/jwks.json')) return json({ keys: [jwk] })
      if (url.endsWith('/oauth/token')) {
        const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test' })).toString('base64url')
        const claims = Buffer.from(JSON.stringify({ iss: 'https://auth.openai.com', aud: 'oaiapp_e2e', sub: 'synthetic', email: 'subscription@example.test', exp: Date.now() / 1000 + 3600, nonce })).toString('base64url')
        const id_token = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), pem).toString('base64url')}`
        return json({ access_token: 'synthetic-access-secret', refresh_token: 'synthetic-refresh-secret', id_token, token_type: 'Bearer', expires_in: 3600,
          scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct' })
      }
      if (url === 'https://api.openai.com/v1/models') return json({ models: [{ slug: 'gpt-6.1-sol', display_name: 'Sol subscription', visibility: 'list' }] })
      if (url.endsWith('/openid-configuration')) return json({ revocation_endpoint: 'https://auth.openai.com/api/accounts/oauth/revoke' })
      if (url.endsWith('/oauth/revoke')) return new Response(null, { status: 200 })
      return originalFetch(input, init)
    }
  }, { jwk: { ...publicKey.export({ format: 'jwk' }), kid: 'test', use: 'sig' }, pem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString() })
  await app.evaluate(({ Menu }) => { const find = items => { for (const i of items) { if (i.label === 'Keys…') return i; const s = i.submenu && find(i.submenu.items); if (s) return s } }; find(Menu.getApplicationMenu().items).click() })
  await dismissSettingsOnboarding(win)
  for (const provider of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY']) {
    await win.locator(`svg[data-provider-logo="${provider}"]`).waitFor()
    assert.equal(await win.locator(`svg[data-provider-logo="${provider}"]`).count(), 1)
  }
  await win.getByRole('button', { name: 'Connect Anthropic', exact: true }).click()
  await win.getByRole('button', { name: 'Claude Code', exact: false }).click()
  const claude = win.getByRole('region', { name: 'Claude Code connection' })
  await claude.getByRole('button', { name: 'Sign in through Claude Code' }).waitFor()
  await win.getByRole('button', { name: 'Close provider connection' }).click()
  await win.getByRole('button', { name: 'Connect OpenAI', exact: true }).click()
  await win.getByRole('button', { name: 'ChatGPT subscription', exact: false }).click()
  const section = win.getByRole('region', { name: 'ChatGPT subscription' })
  // section with aria-label has implicit region semantics.
  await section.getByRole('button', { name: 'Continue with ChatGPT' }).click()
  await win.getByRole('heading', { name: 'You’re using your ChatGPT plan' }).waitFor()
  await win.getByRole('button', { name: 'Got it', exact: true }).click()
  await section.getByText('subscription@example.test', { exact: false }).waitFor()
  const models = await win.evaluate(() => window.agentshot.agent.models())
  assert.ok(models.models.some(m => m.provider === 'chatgpt' && m.name === 'Sol subscription'))
  assert.equal(await win.evaluate(() => window.agentshot.agent.ready()), true)
  assert.ok(!(await win.content()).includes('synthetic-access-secret'))
  assert.ok(!(await win.content()).includes('synthetic-refresh-secret'))
  const stored = readFileSync(join(tmp, 'ud', 'chatgpt.enc'))
  assert.ok(!stored.includes(Buffer.from('synthetic-access-secret')))
  await win.screenshot({ path: join(tmp, 'chatgpt.png') })
  await section.getByRole('button', { name: 'Sign out', exact: true }).click()
  await section.getByRole('button', { name: 'Continue with ChatGPT' }).first().waitFor()
  await win.waitForFunction(async () => !(await window.agentshot.agent.models()).models.some(m => m.provider === 'chatgpt'))
  assert.equal(await win.evaluate(() => window.agentshot.agent.ready()), false)
  await win.getByRole('button', { name: 'Close provider connection' }).click()
  await win.screenshot({ path: join(tmp, 'providers-list.png') })
  console.log(`chatgpt e2e: ok; screenshot: ${join(tmp, 'chatgpt.png')}`)
} finally { await app.close() }
