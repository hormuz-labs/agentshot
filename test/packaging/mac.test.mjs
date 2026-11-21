import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'
import yaml from 'js-yaml'
import { macSigning, notarizeDmgs, notarizeMac } from '../../scripts/package.mjs'

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

const feed = `version: 1.2.3
files:
  - url: AgentShot-1.2.3-arm64-mac.zip
    sha512: zipsha
    size: 100
  - url: AgentShot-1.2.3-arm64.dmg
    sha512: oldsha
    size: 200
path: AgentShot-1.2.3-arm64-mac.zip
sha512: zipsha
releaseDate: '2026-11-21T00:00:00.000Z'
`

test('each DMG the build made is notarized, and its feed entry matches the stapled file', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dmg-'))
  writeFileSync(join(dist, 'latest-mac.yml'), feed)
  writeFileSync(join(dist, 'AgentShot-1.2.3-arm64.dmg'), 'disk image')
  writeFileSync(join(dist, 'AgentShot-1.0.0-arm64.dmg'), 'an older build left in dist') // not this build's: left alone
  const notarized = [], mapped = []
  const done = await notarizeDmgs(dist, apiKey, {
    notarize: async (file, env) => { notarized.push([file, env]) },
    blockmap: async (file, out) => { mapped.push([file, out]); return { sha512: 'newsha', size: 321 } },
  })
  assert.deepEqual(done, ['AgentShot-1.2.3-arm64.dmg'])
  assert.deepEqual(notarized, [[join(dist, 'AgentShot-1.2.3-arm64.dmg'), apiKey]])
  assert.deepEqual(mapped, [[join(dist, 'AgentShot-1.2.3-arm64.dmg'), join(dist, 'AgentShot-1.2.3-arm64.dmg.blockmap')]])
  const after = readFileSync(join(dist, 'latest-mac.yml'), 'utf8')
  assert.equal(after, feed.replace('sha512: oldsha\n    size: 200', 'sha512: newsha\n    size: 321'))
})

test('notarizing DMGs fails loudly when the feed lists none', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dmg-'))
  writeFileSync(join(dist, 'latest-mac.yml'), feed.replace(/  - url: AgentShot-1.2.3-arm64.dmg\n.*\n.*\n/, ''))
  await assert.rejects(notarizeDmgs(dist, apiKey, { notarize: async () => {}, blockmap: async () => ({}) }), /lists no \.dmg/)
})

test('a DMG the feed lists but dist lacks fails before anything is sent to Apple', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dmg-'))
  writeFileSync(join(dist, 'latest-mac.yml'), feed)
  let sent = 0
  await assert.rejects(notarizeDmgs(dist, apiKey, { notarize: async () => { sent++ }, blockmap: async () => ({}) }), /AgentShot-1\.2\.3-arm64\.dmg, not found/)
  assert.equal(sent, 0)
})

test('the real blockmap builder gives the file\'s own sha512 and size', async () => {
  const dist = mkdtempSync(join(tmpdir(), 'dmg-'))
  const dmg = join(dist, 'AgentShot-1.2.3-arm64.dmg')
  writeFileSync(join(dist, 'latest-mac.yml'), feed)
  writeFileSync(dmg, Buffer.alloc(200_000, 7))
  await notarizeDmgs(dist, apiKey, { notarize: async () => {} })
  const { createHash } = await import('node:crypto')
  const sha = createHash('sha512').update(readFileSync(dmg)).digest('base64')
  assert.match(readFileSync(join(dist, 'latest-mac.yml'), 'utf8'), new RegExp(`url: AgentShot-1.2.3-arm64.dmg\n    sha512: ${sha.replace(/[+/]/g, '\\$&')}\n    size: 200000\n`))
  assert.ok(readFileSync(`${dmg}.blockmap`).length > 0)
})

test('signed Mac releases sign the DMG, and the release check covers it', () => {
  const pkg = readFileSync(join(root, 'scripts/package.mjs'), 'utf8')
  assert.match(pkg, /mac\.notarize \? \{ dmg: \{ sign: true \} \}/)
  assert.match(pkg, /mac\?\.notarize && !dir\) await notarizeDmgs/)
  const check = readFileSync(join(root, 'scripts/check-mac-signature.sh'), 'utf8')
  assert.match(check, /stapler validate "\$dmg"/)
  assert.match(check, /--type open --context context:primary-signature/)
})
