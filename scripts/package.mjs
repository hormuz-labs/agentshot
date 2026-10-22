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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build, Platform } = await import('electron-builder')
  // Empty CI secrets must not be interpreted as certificate file paths.
  for (const key of ['CSC_LINK', 'CSC_KEY_PASSWORD', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
    if (!process.env[key]) delete process.env[key]
  const dir = process.argv.includes('--dir')
  const platform = process.platform === 'darwin' ? Platform.MAC : process.platform === 'linux' ? Platform.LINUX : process.platform === 'win32' ? Platform.WINDOWS : null
  if (!platform) throw new Error(`Unsupported packaging host ${process.platform}`)
  const config = process.platform === 'win32' ? { win: windowsSigning() } : process.platform === 'darwin' ? { mac: { notarize: Boolean(process.env.APPLE_ID) } } : {}
  await build({ targets: platform.createTarget(dir ? ['dir'] : undefined), config, publish: 'never' })
}
