// A change to the plugin reaches people only when its version goes up (Claude Code caches a plugin by its version):
// scripts/check-plugin-version.mjs fails a pull request that changes plugin/ without raising it.
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
// @ts-expect-error a plain .mjs script
import { checkPluginVersion, compareVersions } from '../scripts/check-plugin-version.mjs'

describe('comparing versions', () => {
  it('orders by major, minor and patch, as numbers', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBeGreaterThan(0)
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '0.99.99')).toBeGreaterThan(0)
    expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.1.0', '0.1.1')).toBeLessThan(0)
  })
})

describe('whether the plugin needs a new version', () => {
  it('passes when nothing in the plugin changed', () => {
    expect(checkPluginVersion({ changed: [], base: '0.1.0', head: '0.1.0' })).toBeNull()
  })

  it('passes when only the README changed', () => {
    expect(checkPluginVersion({ changed: ['plugin/README.md'], base: '0.1.0', head: '0.1.0' })).toBeNull()
  })

  it('fails when the plugin changed and its version didn’t', () => {
    for (const file of ['plugin/bin/agentshot-mcp.mjs', 'plugin/skills/edit-video/SKILL.md', 'plugin/.mcp.json', 'plugin/.claude-plugin/plugin.json']) {
      expect(checkPluginVersion({ changed: [file], base: '0.1.0', head: '0.1.0' }), file).toMatch(/raise "version" in plugin\/\.claude-plugin\/plugin\.json above 0\.1\.0/)
    }
  })

  it('fails when the version went down', () => {
    expect(checkPluginVersion({ changed: ['plugin/src/launcher.ts'], base: '0.2.0', head: '0.1.9' })).toMatch(/above 0\.2\.0/)
  })

  it('passes when the plugin changed and its version went up', () => {
    expect(checkPluginVersion({ changed: ['plugin/src/launcher.ts'], base: '0.1.0', head: '0.1.1' })).toBeNull()
  })

  it('passes for a plugin that is new on this branch', () => {
    expect(checkPluginVersion({ changed: ['plugin/src/launcher.ts'], base: undefined, head: '0.1.0' })).toBeNull()
  })

  it('fails when the version is missing or not major.minor.patch', () => {
    expect(checkPluginVersion({ changed: [], base: '0.1.0', head: undefined })).toMatch(/needs a "version"/)
    expect(checkPluginVersion({ changed: [], base: '0.1.0', head: '0.2' })).toMatch(/major\.minor\.patch/)
    expect(checkPluginVersion({ changed: [], base: '0.1.0', head: 'v0.2.0' })).toMatch(/major\.minor\.patch/)
  })
})

describe('the command, in a real repository', () => {
  const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-plugin-version.mjs')
  const repos: string[] = []
  afterEach(() => { for (const r of repos.splice(0)) rmSync(r, { recursive: true, force: true }) })

  function repo() {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-version-'))
    repos.push(dir)
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } })
    const write = (path: string, text: string) => { mkdirSync(join(dir, path, '..'), { recursive: true }); writeFileSync(join(dir, path), text) }
    const version = (v: string) => write('plugin/.claude-plugin/plugin.json', JSON.stringify({ name: 'agentshot', version: v }))
    git('init', '-q', '-b', 'main')
    version('0.1.0'); write('plugin/bin/agentshot-mcp.mjs', 'one'); write('other.txt', 'x')
    git('add', '-A'); git('commit', '-q', '-m', 'base')
    git('checkout', '-q', '-b', 'change')
    const run = () => spawnSync(process.execPath, [SCRIPT, 'main'], { cwd: dir, encoding: 'utf8' })
    const commit = () => { git('add', '-A'); git('commit', '-q', '-m', 'change') }
    return { write, version, run, commit }
  }

  it('passes a change outside the plugin', () => {
    const r = repo()
    r.write('other.txt', 'y'); r.commit()
    expect(r.run().status).toBe(0)
  })

  it('fails a plugin change without a new version, and says what to do', () => {
    const r = repo()
    r.write('plugin/bin/agentshot-mcp.mjs', 'two'); r.commit()
    const out = r.run()
    expect(out.status).toBe(1)
    expect(out.stderr).toMatch(/plugin\/bin\/agentshot-mcp\.mjs/)
    expect(out.stderr).toMatch(/above 0\.1\.0/)
  })

  it('passes a plugin change with a new version', () => {
    const r = repo()
    r.write('plugin/bin/agentshot-mcp.mjs', 'two'); r.version('0.1.1'); r.commit()
    expect(r.run().status).toBe(0)
  })
})
