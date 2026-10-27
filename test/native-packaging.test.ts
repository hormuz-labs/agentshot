import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS packaging hook
import { checkNative, NATIVE_MODELS, NATIVE_TOOLS } from '../scripts/check-native.mjs'
import { readFileSync } from 'node:fs'

describe('native packaging gate', () => {
  it('requires all four target builds to verify native tools before publishing', () => {
    const release = readFileSync(join(import.meta.dirname, '../.github/workflows/release.yml'), 'utf8')
    for (const os of ['macos-14', 'macos-15-intel', 'ubuntu-24.04', 'ubuntu-24.04-arm']) expect(release).toContain(os)
    expect(release).toContain('npm run check:native')
    expect(readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')).toContain('beforePack: scripts/check-native.mjs')
    expect(readFileSync(join(import.meta.dirname, '../electron-builder.yml'), 'utf8')).toContain('afterPack: scripts/check-packaged-native.mjs')
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
