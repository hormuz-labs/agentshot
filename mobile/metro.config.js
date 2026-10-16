// The app shares the protocol and the chat's event folding with the desktop app (../src/shared). Metro watches that
// folder, and what those files import resolves from this app's node_modules, as if they lived here.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const shared = path.resolve(__dirname, '../src/shared')
config.watchFolders = [shared]
config.resolver.resolveRequest = (context, moduleName, platform) =>
  context.resolveRequest(
    context.originModulePath.startsWith(shared + path.sep) && !moduleName.startsWith('.')
      ? { ...context, originModulePath: path.join(__dirname, 'index.ts') }
      : context,
    moduleName,
    platform,
  )

module.exports = config
