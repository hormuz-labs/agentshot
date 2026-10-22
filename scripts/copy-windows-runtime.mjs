// The pinned BSK MSVC build imports VCRUNTIME140.dll. Ship the VS redistributable, never a System32 copy.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function copyWindowsRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('VC runtime copy requires native Windows x64')
  let redist = process.env.VCToolsRedistDir
  if (!redist) {
    const vswhere = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
    const vs = execFileSync(vswhere, ['-latest', '-products', '*', '-version', '[17.0,18.0)', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim()
    if (!vs) throw new Error('Visual Studio 2022 C++ redistributable tools not found')
    const base = join(vs, 'VC', 'Redist', 'MSVC')
    const versions = readdirSync(base).filter(v => /^\d+\.\d+\.\d+$/.test(v)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    if (!versions.length) throw new Error(`VC redistributable missing from ${base}`)
    redist = join(base, versions[0])
  }
  const source = join(redist, 'x64', 'Microsoft.VC143.CRT', 'vcruntime140.dll')
  if (!existsSync(source)) throw new Error(`BSK requires the VS2022 x64 redistributable: ${source}`)
  const out = join(import.meta.dirname, '..', 'resources', 'bin', 'win32-x64')
  mkdirSync(out, { recursive: true })
  copyFileSync(source, join(out, 'vcruntime140.dll'))
  console.log(`  bundled BrowserSkill's VC runtime from ${source}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) copyWindowsRuntime()
