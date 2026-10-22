exports.default = async context => {
  // ${platform} expands to the HOST, not the requested builder target. Cross-packaging would copy wrong binaries.
  const arch = require('builder-util').Arch[context.arch]
  if (context.electronPlatformName !== process.platform || arch !== process.arch)
    throw new Error('Manul packaging requires a native runner and Node architecture matching the target')
  const { checkPackaging } = await import('./check-packaging.mjs')
  checkPackaging({ root: context.packager.projectDir, platform: context.electronPlatformName, arch })
}
