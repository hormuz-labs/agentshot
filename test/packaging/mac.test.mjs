import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { macSigning, notarizeMac } from '../../scripts/package.mjs'

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

test('notarizing tries stapling again when Apple\'s end drops, and gives up only after a few tries', async () => {
  const calls = []
  const opts = (stapleFails) => ({
    notarize: async o => { calls.push(['notarize', o]); throw new Error('Failed to staple your application with code: 68') },
    staple: async app => { calls.push(['staple', app]); if (stapleFails-- > 0) throw new Error('Error 68') },
    wait: async () => {},
  })
  await notarizeMac('/out/AgentShot.app', { ...apiKey }, opts(2))
  assert.deepEqual(calls.map(c => c[0]), ['notarize', 'staple', 'staple', 'staple'])
  assert.deepEqual(calls[0][1], { tool: 'notarytool', appPath: '/out/AgentShot.app', appleApiKey: '/tmp/AuthKey.p8', appleApiKeyId: 'KEY123', appleApiIssuer: 'issuer-uuid' })
  calls.length = 0
  await assert.rejects(notarizeMac('/out/AgentShot.app', appleId, opts(99)), /Error 68/)
  assert.equal(calls.filter(c => c[0] === 'staple').length, 5)
  assert.deepEqual(calls[0][1], { tool: 'notarytool', appPath: '/out/AgentShot.app', appleId: 'me@example.com', appleIdPassword: 'app-password', teamId: 'TEAM123456' })
})

test('notarizing that itself fails is not retried as stapling', async () => {
  let stapled = 0
  await assert.rejects(notarizeMac('/out/AgentShot.app', apiKey, {
    notarize: async () => { throw new Error('Notarize failed: status Invalid') },
    staple: async () => { stapled++ },
    wait: async () => {},
  }), /status Invalid/)
  assert.equal(stapled, 0)
})

test('a notarization that staples first time needs nothing more', async () => {
  let stapled = 0
  await notarizeMac('/out/AgentShot.app', apiKey, { notarize: async () => {}, staple: async () => { stapled++ }, wait: async () => {} })
  assert.equal(stapled, 0)
})
