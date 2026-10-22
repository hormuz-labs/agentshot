// Native Windows regression: no wildcard interpretation in either ZIP path, no Unix extraction dependency.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { plan, UV_BUILDS, windowsPowerShell } from '../src/main/tools'

describe.skipIf(process.platform !== 'win32')('native Windows ZIP extraction', () => {
  it('extracts a verified ZIP into a profile path containing brackets, spaces and an apostrophe', async () => {
    const root = mkdtempSync(join(tmpdir(), "manul [profile] tools'quote-"))
    const source = join(root, 'source'), zip = join(root, 'payload.zip'), tools = join(root, 'tools')
    const build = UV_BUILDS[`win32-${process.arch}`], hash = build.sha256
    const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
    try {
      mkdirSync(source)
      writeFileSync(join(source, 'uv.exe'), 'verified executable fixture')
      execFileSync(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `[System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(source)}, ${quote(zip)})`], { windowsHide: true })
      const payload = readFileSync(zip)
      build.sha256 = createHash('sha256').update(payload).digest('hex')
      vi.stubEnv('MANUL_TOOLS', tools)
      vi.stubGlobal('fetch', vi.fn(async () => new Response(payload)))
      mkdirSync(join(tools, 'uv'), { recursive: true })
      await plan('uv')[0].install({ id: 'test', progress: () => {}, done: () => {}, fail: () => {} })
      expect(readFileSync(join(tools, 'uv', 'uv.exe'), 'utf8')).toBe('verified executable fixture')
    } finally {
      build.sha256 = hash
      vi.unstubAllEnvs()
      vi.unstubAllGlobals()
      rmSync(root, { recursive: true, force: true })
    }
  })
})
