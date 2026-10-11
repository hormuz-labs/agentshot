// macOS takes the Dock name and icon from the .app bundle, even when app.setName() is called.
// Keep a branded development bundle cached alongside dependencies for dev and preview launches.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { copyFile, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const root = join(import.meta.dirname, '..')

export async function prepareElectron() {
  if (process.env.ELECTRON_EXEC_PATH) return process.env.ELECTRON_EXEC_PATH
  const electron = require('electron')
  if (process.platform !== 'darwin') return electron

  const source = join(dirname(electron), '../..')
  const icon = join(root, 'build/icon.icns')
  const cache = join(root, 'node_modules/.cache/manul')
  const bundle = join(cache, 'Manul.app')
  const executable = join(bundle, 'Contents/MacOS/Electron')
  const stamp = join(cache, 'branding.sha256')
  // Refresh after an Electron upgrade, icon change, or change to this launcher.
  const hash = createHash('sha256').update(electron)
  for (const file of [join(source, 'Contents/Info.plist'), icon, fileURLToPath(import.meta.url)]) {
    hash.update(await readFile(file))
  }
  const fingerprint = hash.digest('hex')
  if (existsSync(executable) && existsSync(stamp) && (await readFile(stamp, 'utf8')) === fingerprint) return executable

  await mkdir(cache, { recursive: true })
  await rm(bundle, { recursive: true, force: true })
  await cp(source, bundle, { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE })
  await copyFile(icon, join(bundle, 'Contents/Resources/Manul.icns'))
  const plist = join(bundle, 'Contents/Info.plist')
  for (const [key, value] of Object.entries({
    CFBundleDisplayName: 'Manul',
    CFBundleName: 'Manul',
    CFBundleIdentifier: 'com.hormuzlabs.manul.dev',
    CFBundleIconFile: 'Manul.icns',
  })) {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist])
  }
  // Changing bundle metadata invalidates Electron's signature; retain its JIT entitlements.
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements', bundle], { stdio: 'pipe' })
  await writeFile(stamp, fingerprint)
  return executable
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.env.ELECTRON_EXEC_PATH = await prepareElectron()
  const vite = dirname(require.resolve('electron-vite/package.json'))
  await import(pathToFileURL(join(vite, 'bin/electron-vite.js')).href)
}
