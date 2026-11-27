// The plugin's launcher: what Claude Code starts when the AgentShot plugin is installed. It passes each MCP message to
// AgentShot's own server (src/main/mcp.ts) with the port and token from AgentShot's state file, as the Rust launcher
// (scripts/launcher) does, and gets an agent ready while AgentShot is closed.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { OutsideAccess, type Editor } from '../src/main/mcp'
import { Launcher, NOT_OPEN, SWITCH_ON, defaultStateFile, serve } from '../plugin/src/launcher'

const FILM = { dir: '/films/launch', title: 'Launch' }
const editor = (over: Partial<Editor> = {}): Editor => ({
  tools: () => [{ name: 'project_state', description: 'The project.', parameters: { type: 'object', properties: {} } }],
  call: vi.fn(async (dir, name) => ({ content: [{ type: 'text' as const, text: `${name} in ${dir}` }] })),
  projects: () => [FILM],
  addFiles: vi.fn(async () => []),
  seen: vi.fn(),
  ...over,
})

const cleanups: (() => Promise<unknown> | unknown)[] = []
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c() })

function folder() {
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-launcher-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  return dir
}
/** AgentShot with editing from other agents switched on, on a port of its own. */
async function agentshot(e = editor(), dir = folder()) {
  const access = new OutsideAccess(join(dir, 'outside.json'), e, 0)
  cleanups.push(() => access.stop())
  await access.set(true)
  return { access, editor: e, stateFile: access.stateFile, dir }
}
/** A port nothing listens on. */
async function deadPort() {
  const s = createServer()
  await new Promise<void>(ok => s.listen(0, '127.0.0.1', ok))
  const port = (s.address() as { port: number }).port
  await new Promise(ok => s.close(ok))
  return port
}
const msg = (o: object) => JSON.stringify({ jsonrpc: '2.0', ...o })
const parse = (line: string | undefined) => JSON.parse(line!)
const fast = { waitMs: 2_000, intervalMs: 20 }

describe('while AgentShot is closed', () => {
  it('gets the agent ready without opening AgentShot', async () => {
    const open = vi.fn()
    const l = new Launcher({ stateFile: join(folder(), 'outside.json'), openApp: open, ...fast })
    const init = parse(await l.handle(msg({ id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'c', version: '1' } } })))
    expect(init).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'agentshot' } } })
    expect(init.result.instructions).toMatch(/AgentShot/)
    expect(parse(await l.handle(msg({ id: 2, method: 'ping' })))).toEqual({ jsonrpc: '2.0', id: 2, result: {} })
    expect(await l.handle(msg({ method: 'notifications/initialized' }))).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
  })

  it('lists the tools as AgentShot last gave them', async () => {
    const dir = folder()
    writeFileSync(join(dir, 'outside-tools.json'), JSON.stringify([{ name: 'project_state', description: 'x', inputSchema: { type: 'object' } }]))
    const l = new Launcher({ stateFile: join(dir, 'outside.json'), ...fast })
    expect(parse(await l.handle(msg({ id: 'a', method: 'tools/list' })))).toEqual({ jsonrpc: '2.0', id: 'a', result: { tools: [{ name: 'project_state', description: 'x', inputSchema: { type: 'object' } }] } })
  })

  it('shows the editor page as AgentShot last gave it, without opening AgentShot', async () => {
    const dir = folder(), open = vi.fn()
    const page = { contents: [{ uri: 'ui://agentshot/editor.html', mimeType: 'text/html;profile=mcp-app', text: '<!doctype html>' }] }
    writeFileSync(join(dir, 'outside-resources.json'), JSON.stringify({ resources: [{ uri: 'ui://agentshot/editor.html', name: 'AgentShot editor' }], read: { 'ui://agentshot/editor.html': page } }))
    const l = new Launcher({ stateFile: join(dir, 'outside.json'), openApp: open, ...fast })
    expect(parse(await l.handle(msg({ id: 1, method: 'resources/list' })))).toEqual({ jsonrpc: '2.0', id: 1, result: { resources: [{ uri: 'ui://agentshot/editor.html', name: 'AgentShot editor' }] } })
    expect(parse(await l.handle(msg({ id: 2, method: 'resources/read', params: { uri: 'ui://agentshot/editor.html' } })))).toEqual({ jsonrpc: '2.0', id: 2, result: page })
    expect(open).not.toHaveBeenCalled()
    // a page it doesn't have is AgentShot's to answer
    expect(parse(await l.handle(msg({ id: 3, method: 'resources/read', params: { uri: 'ui://agentshot/other.html' } }))).error.message).toBe(SWITCH_ON)
  })

  it('has no pages before AgentShot ever gave one, and doesn’t open AgentShot to say so', async () => {
    const open = vi.fn()
    const l = new Launcher({ stateFile: join(folder(), 'outside.json'), openApp: open, ...fast })
    expect(parse(await l.handle(msg({ id: 1, method: 'resources/list' })))).toEqual({ jsonrpc: '2.0', id: 1, result: { resources: [] } })
    expect(open).not.toHaveBeenCalled()
  })

  it('says to switch editing from agents on when it never was, or was switched off', async () => {
    const dir = folder(), stateFile = join(dir, 'outside.json')
    const l = new Launcher({ stateFile, ...fast })
    const call = msg({ id: 7, method: 'tools/call', params: { name: 'project_state' } })
    expect(parse(await l.handle(call))).toEqual({ jsonrpc: '2.0', id: 7, error: { code: -32000, message: SWITCH_ON } })
    writeFileSync(stateFile, JSON.stringify({ enabled: false, port: 1 }))
    expect(parse(await l.handle(call)).error.message).toBe(SWITCH_ON)
    // and no tool list kept yet: the same
    expect(parse(await l.handle(msg({ id: 8, method: 'tools/list' }))).error.message).toBe(SWITCH_ON)
  })

  it('says to open AgentShot when it is switched on but not running', async () => {
    const stateFile = join(folder(), 'outside.json')
    writeFileSync(stateFile, JSON.stringify({ enabled: true, port: await deadPort(), token: 't' }))
    const l = new Launcher({ stateFile, ...fast })
    expect(parse(await l.handle(msg({ id: 3, method: 'tools/call', params: { name: 'project_state' } })))).toEqual({ jsonrpc: '2.0', id: 3, error: { code: -32000, message: NOT_OPEN } })
  })

  it('opens AgentShot on the first real request, once, and waits for it', async () => {
    const dir = folder()
    const e = editor()
    const access = new OutsideAccess(join(dir, 'outside.json'), e, 0)
    cleanups.push(() => access.stop())
    await access.set(true); await access.stop() // switched on before, closed now
    const open = vi.fn(() => { setTimeout(() => void access.start(), 50) })
    const l = new Launcher({ stateFile: access.stateFile, openApp: open, from: 'Claude Code', ...fast })
    const answer = parse(await l.handle(msg({ id: 4, method: 'tools/call', params: { name: 'project_state', arguments: {} } })))
    expect(answer.result.content[0].text).toBe('project_state in /films/launch')
    expect(open).toHaveBeenCalledTimes(1)
    await access.stop()
    await l.handle(msg({ id: 5, method: 'tools/call', params: { name: 'project_state' } }))
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('doesn’t open AgentShot, or wait, when editing from agents is switched off', async () => {
    const dir = folder(), stateFile = join(dir, 'outside.json')
    const open = vi.fn()
    const l = new Launcher({ stateFile, openApp: open, waitMs: 60_000, intervalMs: 20 })
    const call = msg({ id: 1, method: 'tools/call', params: { name: 'project_state' } })
    const started = Date.now()
    expect(parse(await l.handle(call)).error.message).toBe(SWITCH_ON)
    writeFileSync(stateFile, JSON.stringify({ enabled: false, port: 1 }))
    expect(parse(await l.handle(call)).error.message).toBe(SWITCH_ON)
    expect(open).not.toHaveBeenCalled()
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  it('answers what isn’t JSON with a parse error', async () => {
    const l = new Launcher({ stateFile: join(folder(), 'outside.json'), ...fast })
    expect(parse(await l.handle('hello'))).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Not JSON.' } })
  })
})

describe('while AgentShot is running', () => {
  it('passes requests to AgentShot’s own server and says who is asking', async () => {
    const a = await agentshot()
    const l = new Launcher({ stateFile: a.stateFile, from: 'Claude Code', ...fast })
    const init = parse(await l.handle(msg({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'c', version: '1' } } })))
    expect(init.result.serverInfo.name).toBe('agentshot')
    expect(await l.handle(msg({ method: 'notifications/initialized' }))).toBeUndefined()
    const listed = parse(await l.handle(msg({ id: 2, method: 'tools/list' })))
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual(['projects', 'add_files', 'project_state'])
    const called = parse(await l.handle(msg({ id: 3, method: 'tools/call', params: { name: 'project_state', arguments: {} } })))
    expect(called).toMatchObject({ id: 3, result: { content: [{ type: 'text', text: 'project_state in /films/launch' }] } })
    expect(a.editor.seen).toHaveBeenCalledWith('Claude Code', '/films/launch', 'project_state')
  })

  it('reads the state afresh, so a new token or port needs no new setup', async () => {
    const a = await agentshot()
    const l = new Launcher({ stateFile: a.stateFile, ...fast })
    const list = msg({ id: 1, method: 'tools/list' })
    expect(parse(await l.handle(list)).result.tools).toBeDefined()
    await a.access.set(false); await a.access.set(true) // a new token
    expect(parse(await l.handle(list)).result.tools).toBeDefined()
  })

  it('passes on AgentShot’s refusal in its own words', async () => {
    const a = await agentshot()
    const stateFile = join(folder(), 'outside.json')
    writeFileSync(stateFile, JSON.stringify({ enabled: true, port: Number(new URL(a.access.url).port), token: 'not-the-token' }))
    const l = new Launcher({ stateFile, ...fast })
    const said = parse(await l.handle(msg({ id: 9, method: 'tools/list' })))
    expect(said).toMatchObject({ id: 9, error: { code: -32000 } })
    expect(said.error.message).toMatch(/Set AgentShot up again from Settings → Keys/)
  })

  it('stays out of the way of answers the agent sends back', async () => {
    const a = await agentshot()
    const l = new Launcher({ stateFile: a.stateFile, ...fast })
    expect(await l.handle(msg({ id: 1, result: {} }))).toBeUndefined()
  })
})

describe('the stdio loop', () => {
  it('answers each message on one line, in order, and skips blank lines', async () => {
    const a = await agentshot(editor({ call: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'two\nlines' }] })) }))
    const input = new PassThrough(), output = new PassThrough()
    let out = ''
    output.on('data', d => { out += d })
    const done = serve(input, output, new Launcher({ stateFile: a.stateFile, ...fast }))
    input.write(`${msg({ id: 1, method: 'ping' })}\n\n   \n`)
    input.write(`${msg({ id: 2, method: 'tools/call', params: { name: 'project_state' } })}\n`)
    input.end(msg({ id: 3, method: 'ping' }))
    await done
    const lines = out.split('\n').filter(Boolean)
    expect(lines.map(l => JSON.parse(l).id)).toEqual([1, 2, 3])
    expect(JSON.parse(lines[1]).result.content[0].text).toBe('two\nlines')
    expect(out.endsWith('\n')).toBe(true)
  })
})

describe('where AgentShot keeps its state', () => {
  it('is AgentShot’s own settings folder on each platform, or AGENTSHOT_STATE', () => {
    expect(defaultStateFile({ AGENTSHOT_STATE: '/x/outside.json' }, 'linux', '/home/a')).toBe('/x/outside.json')
    expect(defaultStateFile({}, 'linux', '/home/a')).toBe(join('/home/a', '.config', 'AgentShot', 'outside.json'))
    expect(defaultStateFile({ XDG_CONFIG_HOME: '/cfg' }, 'linux', '/home/a')).toBe(join('/cfg', 'AgentShot', 'outside.json'))
    expect(defaultStateFile({}, 'darwin', '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support', 'AgentShot', 'outside.json'))
    expect(defaultStateFile({ APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'win32', 'C:\\Users\\a')).toBe(join('C:\\Users\\a\\AppData\\Roaming', 'AgentShot', 'outside.json'))
  })
})
