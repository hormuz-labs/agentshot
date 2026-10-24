import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { macSigning } from '../../scripts/package.mjs'

const root = join(import.meta.dirname, '..', '..')
const cert = { CSC_LINK: 'cert', CSC_KEY_PASSWORD: 'password' }
const appleId = { APPLE_ID: 'me@example.com', APPLE_APP_SPECIFIC_PASSWORD: 'app-password', APPLE_TEAM_ID: 'TEAM123456' }
const apiKey = { APPLE_API_KEY: '/tmp/AuthKey.p8', APPLE_API_KEY_ID: 'KEY123', APPLE_API_ISSUER: 'issuer-uuid' }

test('local Mac builds may be unsigned', () => {
  assert.deepEqual(macSigning({}), { forceCodeSigning: false, notarize: false })
})

test('public Mac release fails without a Developer ID certificate and notarization credentials', () => {
  for (const env of [{}, cert, appleId, apiKey, { ...cert, APPLE_ID: 'me@example.com', APPLE_TEAM_ID: 'TEAM123456' },
    { ...cert, APPLE_API_KEY_ID: 'KEY123', APPLE_API_ISSUER: 'issuer-uuid' }, { CSC_LINK: 'cert', ...appleId }])
    assert.throws(() => macSigning({ MANUL_PUBLIC_RELEASE: '1', ...env }), /macOS releases must be signed and notarized/)
})

test('public Mac release signs and notarizes with an Apple ID or an App Store Connect API key', () => {
  for (const notary of [appleId, apiKey])
    assert.deepEqual(macSigning({ MANUL_PUBLIC_RELEASE: '1', ...cert, ...notary }), { forceCodeSigning: true, notarize: true })
})

test('the Mac app keeps the hardened runtime notarization requires', async () => {
  const config = yaml.load(readFileSync(join(root, 'electron-builder.yml'), 'utf8'))
  const { mac } = config
  // the release build merges macSigning() into mac; electron-builder must accept the result
  const { validateConfiguration } = createRequire(import.meta.url)('app-builder-lib/out/util/config/config.js')
  await validateConfiguration({ ...config, mac: { ...mac, forceCodeSigning: true, notarize: true } })
  assert.equal(mac.hardenedRuntime, true)
  assert.equal(mac.entitlements, 'build/entitlements.mac.plist')
})

test('the release workflow checks Mac signing before building and Gatekeeper after', () => {
  const release = readFileSync(join(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(release, /macSigning\(\)/)
  assert.match(release, /scripts\/check-mac-signature\.sh dist/)
  assert.ok(release.indexOf('macSigning()') < release.indexOf('npm run package'))
  assert.ok(release.indexOf('check-mac-signature.sh') > release.indexOf('npm run package'))
})
