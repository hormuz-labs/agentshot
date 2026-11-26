// The AgentShot plugin as Claude Code installs it: marketplace → plugin manifest → .mcp.json → the committed bundle,
// started for real and driven against AgentShot's own MCP server (src/main/mcp.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'esbuild'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { OutsideAccess, SERVER_NAME, type Editor } from '../src/main/mcp'
import { VERSION } from '../plugin/src/version'
// @ts-expect-error a plain .mjs build script
import { options, OUTFILE } from '../plugin/build.mjs'

const root = resolve(__dirname, '..')
const json = (path: string) => JSON.parse(readFileSync(join(root, path), 'utf8'))
const BUNDLE = join(root, 'plugin', 'bin', 'agentshot-mcp.mjs')

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c() })

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-plugin-e2e-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}
/** Claude Code starting the plugin's server, with AgentShot's state file at [stateFile]. */
async function claudeCode(stateFile: string) {
  const client = new Client({ name: 'packaging-test', version: '1.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [BUNDLE],
    env: { ...process.env as Record<string, string>, AGENTSHOT_STATE: stateFile },
    stderr: 'pipe',
  }))
  cleanups.push(() => client.close())
  return client
}

describe('Claude plugin packaging', () => {
  it('lists the plugin in the repository’s marketplace', () => {
    const market = json('.claude-plugin/marketplace.json')
    expect(market.name).toBe('agentshot')
    expect(market.owner?.name).toBeTruthy()
    const entry = market.plugins.find((p: { name: string }) => p.name === 'agentshot')
    expect(entry).toMatchObject({ source: './plugin', version: VERSION })
    expect(entry.description.length).toBeGreaterThan(20)
    expect(existsSync(join(root, entry.source, '.claude-plugin', 'plugin.json'))).toBe(true)
  })

  it('has one version everywhere', () => {
    expect(json('plugin/.claude-plugin/plugin.json').version).toBe(VERSION)
    expect(json('plugin/package.json').version).toBe(VERSION)
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('describes the plugin and its license', () => {
    const manifest = json('plugin/.claude-plugin/plugin.json')
    expect(manifest.name).toBe('agentshot')
    expect(manifest.license).toBe(json('package.json').license)
    expect(manifest.description.length).toBeGreaterThan(20)
    expect(manifest.repository).toMatch(/^https:\/\/github\.com\//)
  })

  it('has a square listing icon the directory accepts', () => {
    const icon = readFileSync(join(root, 'plugin', '.claude-plugin', 'icon.png'))
    expect(icon.subarray(1, 4).toString()).toBe('PNG')
    const width = icon.readUInt32BE(16), height = icon.readUInt32BE(20)
    expect(width).toBe(height)
    expect(width).toBeGreaterThanOrEqual(512); expect(width).toBeLessThanOrEqual(2048)
    expect(icon.length).toBeLessThan(2 * 1024 * 1024)
  })

  it('declares that it reaches AgentShot on this computer, and nothing else', () => {
    expect(json('plugin/.claude-plugin/plugin.json').network).toEqual({ hosts: ['127.0.0.1'] })
    const readme = readFileSync(join(root, 'plugin', 'README.md'), 'utf8')
    expect(readme).toMatch(/## What it runs and sends/)
    expect(readme).toContain('127.0.0.1')
  })

  it('ships readable source, not a minified bundle', () => {
    const bundle = readFileSync(BUNDLE, 'utf8')
    expect(bundle.split('\n').length).toBeGreaterThan(100)
    expect(bundle).toMatch(/\bLauncher = class\b|class Launcher\b/)
    expect(bundle).toContain('SWITCH_ON')
  })

  it('keeps the plugin folder to what the directory takes: small text files and the icon', () => {
    const files = (execFileSync('git', ['ls-files', 'plugin'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean))
    expect(files.length).toBeLessThan(512)
    for (const f of files) {
      const size = statSync(join(root, f)).size
      if (f.endsWith('.png')) continue
      expect(size, f).toBeLessThan(256 * 1024)
      expect(/\.(ts|mjs|js|json|md)$/.test(f), f).toBe(true)
    }
  })

  it('starts the committed bundle under the name AgentShot’s server goes by, with no token in it', () => {
    const servers = json('plugin/.mcp.json').mcpServers
    expect(Object.keys(servers)).toEqual([SERVER_NAME])
    const server = servers[SERVER_NAME]
    expect(server.command).toBe('node')
    expect(server.args).toEqual(['${CLAUDE_PLUGIN_ROOT}/bin/agentshot-mcp.mjs'])
    expect(JSON.stringify(server)).not.toMatch(/token|authorization|bearer/i)
    expect(existsSync(BUNDLE)).toBe(true)
  })

  it('ships a skill that tells Claude how to set up and use AgentShot’s tools', () => {
    const skill = readFileSync(join(root, 'plugin', 'skills', 'edit-video', 'SKILL.md'), 'utf8')
    const front = /^---\n([\s\S]*?)\n---\n/.exec(skill)?.[1] ?? ''
    expect(front).toMatch(/^name: edit-video$/m)
    expect(front).toMatch(/^description: .{40,}$/m)
    expect(skill).toContain('Edit from Claude Code or Codex')
    for (const tool of ['projects', 'project_state', 'transcript', 'edit_timeline', 'propose_version', 'decide_version', 'add_files', 'export_video']) expect(skill).toContain(`\`${tool}\``)
  })

  it('commits the bundle as the sources build it', async () => {
    const fresh = await build({ ...options, write: false, outfile: OUTFILE })
    expect(readFileSync(OUTFILE, 'utf8') === fresh.outputFiles![0].text, 'plugin/bin/agentshot-mcp.mjs is stale: run npm run plugin:build').toBe(true)
  }, 60_000)
})

describe('the bundled launcher, end to end', () => {
  it('connects Claude Code to a running AgentShot through its state file', async () => {
    const seen = vi.fn()
    const editor: Editor = {
      tools: () => [{ name: 'project_state', description: 'The project.', parameters: { type: 'object', properties: {} } }],
      call: async (d, name) => ({ content: [{ type: 'text', text: `${name} in ${d}` }] }),
      projects: () => [{ dir: '/films/launch', title: 'Launch' }],
      addFiles: async () => [],
      seen,
    }
    const access = new OutsideAccess(join(folder(), 'outside.json'), editor, 0)
    cleanups.push(() => access.stop())
    await access.set(true)

    const client = await claudeCode(access.stateFile)
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME)
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['projects', 'add_files', 'project_state'])
    const called = await client.callTool({ name: 'project_state', arguments: {} }) as { isError?: boolean; content: { text: string }[] }
    expect(called.isError).toBeFalsy()
    expect(called.content[0].text).toBe('project_state in /films/launch')
    expect(seen).toHaveBeenCalledWith('Claude Code', '/films/launch', 'project_state')
  }, 60_000)

  it('gets Claude Code ready, and says what to do, while editing from agents is switched off', async () => {
    const client = await claudeCode(join(folder(), 'outside.json'))
    expect(client.getServerVersion()?.name).toBe(SERVER_NAME)
    await expect(client.listTools()).rejects.toThrow(/Edit from Claude Code or Codex/)
  }, 60_000)
})
