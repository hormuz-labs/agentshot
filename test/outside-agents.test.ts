import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { claudeAppConfig, codexConfig, installedAgents, setClaudeAppServer, setCodexServer, withClaudeAppServer, withCodexServer } from '../src/main/outside-agents'
import { OutsideAccess, whoOf, type Editor } from '../src/main/mcp'
import { activityLine } from '../src/shared/outside'
import { executableName } from '../src/main/paths'

const launch = { command: '/Applications/AgentShot.app/Contents/Resources/bin/agentshot-mcp', args: ['/Users/me/Library/Application Support/AgentShot/outside.json', '--app', '/Applications/AgentShot.app', '--from', 'Claude'] }
const tmp = () => mkdtempSync(join(tmpdir(), 'agentshot-agents-'))

describe('where each agent keeps its servers', () => {
  it('is the Claude app’s own settings file on each system', () => {
    expect(claudeAppConfig('/Users/me', 'darwin', {})).toBe('/Users/me/Library/Application Support/Claude/claude_desktop_config.json')
    expect(claudeAppConfig('/home/me', 'linux', {})).toBe('/home/me/.config/Claude/claude_desktop_config.json')
    expect(claudeAppConfig('/home/me', 'linux', { XDG_CONFIG_HOME: '/cfg' })).toBe('/cfg/Claude/claude_desktop_config.json')
    expect(claudeAppConfig('C:/Users/me', 'win32', { APPDATA: 'C:/Roaming' }).replace(/\\/g, '/')).toBe('C:/Roaming/Claude/claude_desktop_config.json')
  })
  it('is Codex’s config.toml, wherever CODEX_HOME says', () => {
    expect(codexConfig('/Users/me', {})).toBe('/Users/me/.codex/config.toml')
    expect(codexConfig('/Users/me', { CODEX_HOME: '/elsewhere' })).toBe('/elsewhere/config.toml')
  })
  it('counts an agent as installed once its settings folder exists', () => {
    const home = tmp()
    expect(installedAgents(home, 'darwin', {})).toEqual({ claudeApp: false, codex: false })
    mkdirSync(join(home, '.codex'))
    mkdirSync(join(home, 'Library', 'Application Support', 'Claude'), { recursive: true })
    expect(installedAgents(home, 'darwin', {})).toEqual({ claudeApp: true, codex: true })
  })
})

describe('the Claude app', () => {
  it('gets AgentShot’s entry, with everything else as it was', () => {
    const before = JSON.stringify({ theme: 'dark', mcpServers: { files: { command: 'npx', args: ['files'] } } })
    const after = JSON.parse(withClaudeAppServer(before, 'agentshot', launch))
    expect(after).toEqual({ theme: 'dark', mcpServers: { files: { command: 'npx', args: ['files'] }, agentshot: launch } })
    expect(JSON.stringify(after)).not.toMatch(/token|Bearer/i)
  })
  it('starts from nothing when there is no file or an empty one', () => {
    expect(JSON.parse(withClaudeAppServer(null, 'agentshot', launch))).toEqual({ mcpServers: { agentshot: launch } })
    expect(JSON.parse(withClaudeAppServer('  ', 'agentshot', launch))).toEqual({ mcpServers: { agentshot: launch } })
  })
  it('loses only AgentShot’s entry when removed', () => {
    const both = withClaudeAppServer(JSON.stringify({ mcpServers: { files: { command: 'npx' } } }), 'agentshot', launch)
    expect(JSON.parse(withClaudeAppServer(both, 'agentshot', null))).toEqual({ mcpServers: { files: { command: 'npx' } } })
    expect(JSON.parse(withClaudeAppServer(withClaudeAppServer('{"theme":"dark"}', 'agentshot', launch), 'agentshot', null))).toEqual({ theme: 'dark' })
  })
  it('is left alone when its file can’t be read as settings', () => {
    expect(() => withClaudeAppServer('{ not json', 'agentshot', launch)).toThrow(/isn’t valid JSON/)
    expect(() => withClaudeAppServer('[1]', 'agentshot', launch)).toThrow(/left alone/)
    const file = join(tmp(), 'claude_desktop_config.json')
    writeFileSync(file, '{ not json')
    expect(() => setClaudeAppServer(file, 'agentshot', launch)).toThrow()
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })
  it('keeps one copy of the file as it was before AgentShot first touched it', () => {
    const file = join(tmp(), 'claude_desktop_config.json')
    writeFileSync(file, '{"theme":"dark"}')
    setClaudeAppServer(file, 'agentshot', launch)
    setClaudeAppServer(file, 'agentshot', { ...launch, args: ['other'] })
    setClaudeAppServer(file, 'agentshot', null)
    expect(readFileSync(`${file}.before-agentshot`, 'utf8')).toBe('{"theme":"dark"}')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ theme: 'dark' })
  })
  it('makes no file just to remove an entry from it', () => {
    const file = join(tmp(), 'Claude', 'claude_desktop_config.json')
    setClaudeAppServer(file, 'agentshot', null)
    expect(existsSync(file)).toBe(false)
    setClaudeAppServer(file, 'agentshot', launch)
    expect(JSON.parse(readFileSync(file, 'utf8')).mcpServers.agentshot).toEqual(launch)
    expect(existsSync(`${file}.before-agentshot`)).toBe(false)
  })
})

describe('Codex', () => {
  const section = `[mcp_servers.agentshot]\ncommand = "${launch.command}"\nargs = ["/Users/me/Library/Application Support/AgentShot/outside.json", "--app", "/Applications/AgentShot.app", "--from", "Claude"]\nstartup_timeout_sec = 60\ntool_timeout_sec = 900\n`
  it('gets AgentShot’s section at the end, the rest untouched', () => {
    const before = 'model = "gpt-5"\n\n[mcp_servers.files]\ncommand = "npx"\n'
    expect(withCodexServer(before, 'agentshot', launch)).toBe(`model = "gpt-5"\n\n[mcp_servers.files]\ncommand = "npx"\n\n${section}`)
    expect(withCodexServer(null, 'agentshot', launch)).toBe(section)
  })
  it('replaces an older section and its sub-tables, wherever it sits, and doesn’t pile up', () => {
    const before = '[mcp_servers.agentshot]\ncommand = "old"\n\n[mcp_servers.agentshot.env]\nA = "1"\n\n[mcp_servers.agentshotter]\ncommand = "keep"\n\n[profiles.x]\nmodel = "y"\n'
    const once = withCodexServer(before, 'agentshot', launch)
    expect(once).toBe(`[mcp_servers.agentshotter]\ncommand = "keep"\n\n[profiles.x]\nmodel = "y"\n\n${section}`)
    expect(withCodexServer(once, 'agentshot', launch)).toBe(once)
  })
  it('loses only AgentShot’s section when removed', () => {
    const before = 'model = "gpt-5"\n\n[mcp_servers.files]\ncommand = "npx"\n'
    expect(withCodexServer(withCodexServer(before, 'agentshot', launch), 'agentshot', null)).toBe(before)
    expect(withCodexServer(section, 'agentshot', null)).toBe('')
  })
  it('writes Windows paths as valid strings', () => {
    expect(withCodexServer(null, 'agentshot', { command: 'C:\\Program Files\\AgentShot\\agentshot-mcp.exe', args: [] })).toContain('command = "C:\\\\Program Files\\\\AgentShot\\\\agentshot-mcp.exe"')
  })
  it('keeps a copy of config.toml as it was', () => {
    const file = join(tmp(), 'config.toml')
    writeFileSync(file, 'model = "gpt-5"\n')
    setCodexServer(file, 'agentshot', launch)
    expect(readFileSync(file, 'utf8')).toContain('[mcp_servers.agentshot]')
    expect(readFileSync(`${file}.before-agentshot`, 'utf8')).toBe('model = "gpt-5"\n')
    setCodexServer(file, 'agentshot', null)
    expect(readFileSync(file, 'utf8')).toBe('model = "gpt-5"\n')
  })
})

describe('who is editing', () => {
  it('is what the launcher was told, else what the client calls itself', () => {
    expect(whoOf({ 'x-agentshot-from': 'Claude', 'user-agent': 'agentshot-mcp' })).toBe('Claude')
    expect(whoOf({ 'user-agent': 'claude-code/2.1.0 (cli)' })).toBe('Claude Code')
    expect(whoOf({ 'user-agent': 'codex-cli/1.2' })).toBe('Codex')
    expect(whoOf({ 'user-agent': 'node' })).toBe('Another agent')
    expect(whoOf({})).toBe('Another agent')
  })
  it('can’t carry markup or run on', () => {
    const who = whoOf({ 'x-agentshot-from': '<b>Evil</b> agent '.repeat(5) })
    expect(who).toBe('bEvilb agent bEvilb agent bEvilb agent b')
    expect(who.length).toBeLessThanOrEqual(40)
    expect(whoOf({ 'x-agentshot-from': '<script>' })).toBe('script')
  })
  it('is said in a few plain words', () => {
    expect(activityLine({ who: 'Claude Code', tool: 'transcript' })).toBe('Claude Code is listening')
    expect(activityLine({ who: 'Codex', tool: 'edit_timeline' })).toBe('Codex is editing')
    expect(activityLine({ who: 'Claude', tool: 'propose_version' })).toBe('Claude is making a new cut')
    expect(activityLine({ who: 'Another agent', tool: 'remember' })).toBe('Another agent is working on this film')
  })
})

// The real launcher (scripts/launcher, built by scripts/build-launcher.mjs) against the real server.
const LAUNCHER = join(import.meta.dirname, '..', 'resources', 'bin', `${process.platform}-${process.arch}`, executableName('agentshot-mcp'))
describe.skipIf(!existsSync(LAUNCHER))('the launcher', () => {
  const running: { access?: OutsideAccess; child?: ChildProcessWithoutNullStreams }[] = []
  afterEach(async () => { for (const r of running.splice(0)) { r.child?.kill(); await r.access?.stop() } })

  async function setup() {
    const seen: [string, string, string][] = []
    const editor: Editor = {
      tools: () => [{ name: 'seek', description: 'Move the playhead.', parameters: { type: 'object', properties: { t: { type: 'number' } }, required: ['t'] } }],
      call: async (dir, name, args) => ({ content: [{ type: 'text', text: `${name} ${JSON.stringify(args)} in ${dir}\nsecond line` }] }),
      projects: () => [{ dir: '/films/holiday', title: 'Holiday' }],
      addFiles: async () => [],
      seen: (who, dir, tool) => seen.push([who, dir, tool]),
    }
    const file = join(tmp(), 'outside.json')
    const access = new OutsideAccess(file, editor, 0)
    await access.set(true)
    const child = spawn(LAUNCHER, [file, '--from', 'Claude', '--wait', '0'])
    running.push({ access, child })
    const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]()
    const ask = async (message: object) => { child.stdin.write(`${JSON.stringify(message)}\n`); return JSON.parse((await lines.next()).value) }
    const tell = (message: object) => { child.stdin.write(`${JSON.stringify(message)}\n`) }
    return { access, file, seen, ask, tell }
  }

  it('passes an agent’s messages to AgentShot and its answers back, one per line', async () => {
    const s = await setup()
    const init = await s.ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
    expect(init.result.serverInfo.name).toBe('agentshot')
    expect(init.result.instructions).toContain('propose_version')
    s.tell({ jsonrpc: '2.0', method: 'notifications/initialized' }) // owed no answer: the next line read must be the list
    const list = await s.ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    expect(list.id).toBe(2)
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['projects', 'add_files', 'seek'])
    const call = await s.ask({ jsonrpc: '2.0', id: 'c', method: 'tools/call', params: { name: 'seek', arguments: { t: 4 } } })
    expect(call).toMatchObject({ id: 'c', result: { content: [{ type: 'text', text: 'seek {"t":4} in /films/holiday\nsecond line' }] } })
    expect(s.seen).toEqual([['Claude', '/films/holiday', 'seek']])
  })

  it('gets an agent ready while AgentShot is closed, with the tools it last listed, and says so when work is asked for', async () => {
    const s = await setup()
    await s.ask({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) // AgentShot keeps the list beside its state file
    await s.access.stop()
    const init = await s.ask({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(init.result.protocolVersion).toBe('2025-03-26')
    const list = await s.ask({ jsonrpc: '2.0', id: 3, method: 'tools/list' })
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['projects', 'add_files', 'seek'])
    const call = await s.ask({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'seek', arguments: { t: 4 } } })
    expect(call.error.message).toBe('AgentShot isn\'t open. Ask the user to open it, then try again.')
  })

  it('follows a new token without being set up again, and says when the switch is off', async () => {
    const s = await setup()
    const before = s.access.setup().token
    await s.access.set(false)
    const off = await s.ask({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'seek', arguments: { t: 1 } } })
    expect(off.error.message).toContain('switched off')
    await s.access.set(true)
    expect(s.access.setup().token).not.toBe(before)
    const on = await s.ask({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'seek', arguments: { t: 1 } } })
    expect(on.result.content[0].text).toContain('seek {"t":1}')
  })
})
