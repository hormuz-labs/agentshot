import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS packaging hook
import { checkNative, NATIVE_MODELS, NATIVE_TOOLS } from '../scripts/check-native.mjs'
import { readFileSync } from 'node:fs'

describe('native packaging gate', () => {
  it('requires all four target builds to verify native tools before publishing', () => {
    const release = readFileSync(join(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
    for (const os of ['{ os: macos-15, arch: arm64', 'macos-15-intel', 'ubuntu-24.04', 'ubuntu-24.04-arm']) expect(release).toContain(os)
    expect(release).toContain('npm run check:native')
    expect(readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')).toContain('beforePack: scripts/check-native.mjs')
    expect(readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')).toContain('afterPack: scripts/check-packaged-native.mjs')
  })
  it('runs every job on a machine GitHub still offers', () => {
    // From early November 2026 GitHub refused macos-14 for this repository ("The configuration 'macos-14-arm64-us-default'
    // is not supported"). A job that names a machine it can't have doesn't fail a test: it is cancelled before it
    // starts, so the Mac tests silently stopped running. Name only machines known to start, and add a new one here
    // when a workflow first uses it.
    const offered = ['ubuntu-24.04', 'ubuntu-24.04-arm', 'ubuntu-latest', 'macos-15', 'macos-15-intel', 'macos-latest', 'windows-2022']
    const dir = join(import.meta.dirname, '../.github/workflows')
    const named: string[] = []
    for (const file of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
      const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n')
      for (const m of text.matchAll(/^\s*runs-on:\s*([a-z0-9.-]+)\s*$/gm)) named.push(`${file}: ${m[1]}`)
      for (const m of text.matchAll(/\bos:\s*\[([^\]]+)\]/g)) for (const os of m[1].split(',')) named.push(`${file}: ${os.trim()}`)
      for (const m of text.matchAll(/\{\s*os:\s*([a-z0-9.-]+)\s*,/g)) named.push(`${file}: ${m[1]}`)
    }
    expect(named.length).toBeGreaterThan(15)
    expect(named.filter(n => !offered.includes(n.split(': ')[1]))).toEqual([])
    expect(named).toContain('ci.yml: macos-15')
  })
  it('builds for macOS 12 and later whichever Mac the build runs on', () => {
    // moving the build to a newer machine must not raise what a person's Mac needs: each native build says 12.0 itself
    const read = (f: string) => readFileSync(join(import.meta.dirname, '..', f), 'utf8')
    expect(read('scripts/build-whisper.sh')).toContain('-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0')
    expect(read('scripts/build-beats.sh')).toContain('-mmacosx-version-min=12.0')
    expect(read('scripts/build-ml.sh')).toContain('-mmacosx-version-min=12.0')
    expect(read('scripts/ffmpeg/build.sh')).toContain('MACOSX_DEPLOYMENT_TARGET=12.0')
    expect(read('electron-builder.yml')).toContain('minimumSystemVersion: "12.0"')
  })
  it('rejects missing and wrong-architecture executables for a Linux target', () => {
    const root = mkdtempSync(join(tmpdir(), 'agentshot-package-native-'))
    try {
      const bin = join(root, 'resources/bin/linux-arm64'), models = join(root, 'resources/models')
      mkdirSync(bin, { recursive: true }); mkdirSync(models, { recursive: true })
      expect(() => checkNative(root, { platform: 'linux', arch: 'arm64', runChecks: false })).toThrow(/Native resources missing/)
      const elf = Buffer.alloc(32); elf.write('\x7fELF'); elf[4] = 2; elf.writeUInt16LE(183, 18)
      for (const tool of [...NATIVE_TOOLS, 'agentshot-fence']) { writeFileSync(join(bin, tool), elf); chmodSync(join(bin, tool), 0o755) }
      for (const model of NATIVE_MODELS) writeFileSync(join(models, model), 'model')
      expect(checkNative(root, { platform: 'linux', arch: 'arm64', runChecks: false })).toMatchObject({ tools: 9, models: 5 })
      elf.writeUInt16LE(62, 18); writeFileSync(join(bin, 'agentshot-speakers'), elf)
      expect(() => checkNative(root, { platform: 'linux', arch: 'arm64', runChecks: false })).toThrow(/wrong architecture/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
