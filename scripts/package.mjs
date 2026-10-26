import { execFile } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

export function windowsSigning(env = process.env) {
  const publicRelease = env.MANUL_PUBLIC_RELEASE === '1'
  const link = env.WIN_CSC_LINK?.trim()
  const password = env.WIN_CSC_KEY_PASSWORD
  const publisher = env.WINDOWS_PUBLISHER_NAME?.trim()
  if ((publicRelease || link || password || publisher) && (!link || !password || !publisher))
    throw new Error('Windows signing requires WIN_CSC_LINK, WIN_CSC_KEY_PASSWORD and exact WINDOWS_PUBLISHER_NAME; public releases must be signed')
  return {
    forceCodeSigning: Boolean(link),
    verifyUpdateCodeSignature: true,
    signtoolOptions: { signingHashAlgorithms: ['sha256'], ...(publisher ? { publisherName: publisher } : {}) },
  }
}

// Developer ID signing plus notarization, so Gatekeeper opens the app without a warning. Notarization takes either an
// App Store Connect API key (APPLE_API_KEY/_KEY_ID/_ISSUER) or an Apple ID with an app-specific password.
export function macSigning(env = process.env) {
  const publicRelease = env.MANUL_PUBLIC_RELEASE === '1'
  const cert = Boolean(env.CSC_LINK?.trim() && env.CSC_KEY_PASSWORD)
  const apiKey = Boolean(env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER)
  const appleId = Boolean(env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID)
  if (publicRelease && (!cert || !(apiKey || appleId)))
    throw new Error('macOS releases must be signed and notarized: set CSC_LINK and CSC_KEY_PASSWORD (Developer ID Application .p12), plus APPLE_API_KEY, APPLE_API_KEY_ID and APPLE_API_ISSUER, or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD and APPLE_TEAM_ID')
  return { forceCodeSigning: publicRelease, notarize: cert && (apiKey || appleId) }
}

// Notarizes the signed app ourselves (afterSign) rather than through electron-builder, which gives up at the first
// failure: notarizing ends in stapling the ticket to the app, which asks Apple (CloudKit), and that connection drops
// now and then on CI ("The network connection was lost", error 68) though the app is notarized. So stapling gets a
// few tries, as validating it does in scripts/check-mac-signature.sh.
export async function notarizeMac(appPath, env = process.env, {
  notarize = async opts => (await import('@electron/notarize')).notarize(opts),
  staple = async app => { await promisify(execFile)('xcrun', ['stapler', 'staple', app]) },
  wait = ms => new Promise(done => setTimeout(done, ms)),
  tries = 5,
} = {}) {
  const credentials = env.APPLE_API_KEY
    ? { appleApiKey: env.APPLE_API_KEY, appleApiKeyId: env.APPLE_API_KEY_ID, appleApiIssuer: env.APPLE_API_ISSUER }
    : { appleId: env.APPLE_ID, appleIdPassword: env.APPLE_APP_SPECIFIC_PASSWORD, teamId: env.APPLE_TEAM_ID }
  try {
    await notarize({ tool: 'notarytool', appPath, ...credentials })
    return
  } catch (e) {
    if (!/staple/i.test(String(e?.message))) throw e // notarizing itself failed: nothing to staple
    console.log(`notarized, but stapling failed (${String(e.message).split('\n')[0]}); trying again`)
  }
  for (let n = 1; ; n++) {
    await wait(15_000)
    try {
      await staple(appPath)
      return
    } catch (e) {
      if (n >= tries) throw e
      console.log(`stapling failed; trying again in 15 s (${n}/${tries})`)
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build, Platform } = await import('electron-builder')
  // Empty CI secrets must not be interpreted as certificate file paths.
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])
    if (!process.env[key]) delete process.env[key]
  const dir = process.argv.includes('--dir')
  const platform = process.platform === 'darwin' ? Platform.MAC : process.platform === 'linux' ? Platform.LINUX : process.platform === 'win32' ? Platform.WINDOWS : null
  if (!platform) throw new Error(`Unsupported packaging host ${process.platform}`)
  const mac = process.platform === 'darwin' ? macSigning() : undefined
  const config = process.platform === 'win32' ? { win: windowsSigning() } : mac ? {
    // signed by electron-builder, notarized by notarizeMac (above), which tries stapling again when Apple's end drops
    mac: { ...mac, notarize: false },
    ...(mac.notarize ? { afterSign: ctx => notarizeMac(join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`)) } : {}),
  } : {}
  await build({ targets: platform.createTarget(dir ? ['dir'] : undefined), config, publish: 'never' })
}
