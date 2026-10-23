// Exercise the actual renderer → preload → main sign-in path, without a browser login.
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'

const root = join(import.meta.dirname, '../..')
mkdirSync('/tmp/opencode', { recursive: true })
const tmp = mkdtempSync('/tmp/opencode/manul-mobile-e2e-')
const env = { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'user')}`], env })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await win.click('[aria-label="Settings"]')
  await dismissSettingsOnboarding(win)
  await win.click('nav >> text=Mobile')
  assert.equal(await win.getByText('Local connection options', { exact: true }).count(), 0)
  assert.equal(await win.evaluate(() => typeof window.manul.mobile.signIn), 'function')
  await app.evaluate(({ shell }) => {
    globalThis.mobileAuthUrls = []
    shell.openExternal = async url => {
      globalThis.mobileAuthUrls.push(url)
      throw new Error('E2E browser authorization intercepted')
    }
  })
  await win.getByRole('button', { name: 'Sign in to Manul', exact: true }).click()
  await win.getByRole('alert').filter({ hasText: 'E2E browser authorization intercepted' }).waitFor()
  const urls = await app.evaluate(() => globalThis.mobileAuthUrls)
  assert.equal(urls.length, 1)
  const url = new URL(urls[0])
  assert.equal(url.pathname, '/oauth/authorize')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.ok(url.searchParams.get('scope').includes('offline_access'))
  assert.equal(await win.getByText('TypeError: action is not a function', { exact: true }).count(), 0)
  console.log('Mobile sign-in renderer/preload/main regression passed')
} finally {
  await app.close()
}
