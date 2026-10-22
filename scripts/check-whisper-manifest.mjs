import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function assertUtf8Manifest(xml) {
  assert.match(xml, /<activeCodePage\b[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/SMI\/2019\/WindowsSettings"[^>]*>\s*UTF-8\s*<\/activeCodePage>/, 'whisper-cli must embed UTF-8 activeCodePage in its Windows manifest')
}

export function checkWhisperManifest(exe, mt) {
  if (process.platform !== 'win32') throw new Error('Embedded manifest inspection requires Windows SDK mt.exe')
  if (!mt) {
    // Works in a developer shell and plain PowerShell with the Windows SDK installed.
    const sdk = join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin')
    const versions = readdirSync(sdk).filter(v => /^10\.\d+\.\d+\.\d+$/.test(v)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }))
    mt = versions.map(v => join(sdk, v, 'x64', 'mt.exe')).find(existsSync)
    if (!mt) throw new Error('Windows SDK manifest tool mt.exe not found')
  }
  const tmp = mkdtempSync(join(tmpdir(), 'manul manifest '))
  try {
    const output = join(tmp, 'embedded.manifest')
    execFileSync(mt, ['-nologo', `-inputresource:${resolve(exe)};#1`, `-out:${output}`], { stdio: 'pipe', timeout: 30000, windowsHide: true })
    assertUtf8Manifest(readFileSync(output, 'utf8'))
    console.log(`whisper-cli embedded UTF-8 manifest: ${exe} ok`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  checkWhisperManifest(process.argv[2] || join(import.meta.dirname, '..', 'resources', 'bin', 'win32-x64', 'whisper-cli.exe'))
