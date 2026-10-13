import { join } from 'node:path'
import { checkNative } from './check-native.mjs'

export default async function afterPack(context) {
  const arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : String(context.arch)
  const platform = context.electronPlatformName
  const resources = platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')
  checkNative(resources, { platform, arch, packaged: true })
}
