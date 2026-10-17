// "Send to Manul" in the iOS share sheet: a share extension, added to the Xcode project at prebuild by
// @bacons/apple-targets. It hands files to the app through the app group, so it shares the app's.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = config => ({
  type: 'share',
  name: 'ManulShare',
  displayName: 'Send to Manul',
  bundleIdentifier: '.share',
  deploymentTarget: '16.4',
  frameworks: ['UniformTypeIdentifiers'],
  entitlements: {
    'com.apple.security.application-groups': config.ios.entitlements['com.apple.security.application-groups'],
  },
})
