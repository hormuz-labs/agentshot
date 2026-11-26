import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { callTool, OutsideAccess, pickProject, toolList, type Editor } from '../src/main/mcp'
import { startAgent } from '../src/main/agent'
import { ClaudeCodeConnection } from '../src/main/claude-code'
import { Memory } from '../src/main/memory'
import { Skills } from '../src/main/skills'

vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), execFile: vi.fn() }))

const A = { dir: '/films/holiday', title: 'Holiday' }, B = { dir: '/films/launch-2', title: 'Launch' }
const never = new AbortController().signal

function editor(over: Partial<Editor> = {}): Editor {
  return {
    tools: () => [{ name: 'seek', description: 'Move the playhead.', parameters: { type: 'object', properties: { t: { type: 'number' } }, required: ['t'] } }],
    call: vi.fn(async (dir, name, args) => ({ content: [{ type: 'text' as const, text: `${name} ${JSON.stringify(args)} in ${dir}` }] })),
    projects: () => [A, B],
    addFiles: vi.fn(async () => ['media/song.mp3 (music)']),
    ...over,
  }
}

const servers: OutsideAccess[] = []
afterEach(async () => { await Promise.all(servers.splice(0).map(s => s.stop())); vi.mocked(execFile).mockReset() })
/** A server switched on, on a port of its own, and what an agent needs to reach it. */
async function running(e = editor()) {
  const file = join(mkdtempSync(join(tmpdir(), 'agentshot-mcp-')), 'outside.json')
  const access = new OutsideAccess(file, e, 0)
  servers.push(access)
  await access.set(true)
  return { access, file, editor: e, ...access.setup() }
}
async function connect(url: string, token: string) {
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }))
  return client
}
/** A raw request, for the headers a well-behaved client never sends. */
function raw(url: string, headers: Record<string, string>, method = 'POST') {
  return new Promise<{ status: number; body: string }>((ok, fail) => {
    const req = request(url, { method, headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } }, res => {
      let body = ''
      res.on('data', c => { body += c }); res.on('end', () => ok({ status: res.statusCode!, body }))
    })
    req.on('error', fail)
    req.end(method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) : undefined)
  })
}

describe('which project a call is about', () => {
  it('is the one opened last when none is named', () => expect(pickProject([A, B])).toBe(B))
  it('is found by title, folder name or folder, whatever the capitals', () => {
    expect(pickProject([A, B], 'holiday')).toBe(A)
    expect(pickProject([A, B], 'LAUNCH-2')).toBe(B)
    expect(pickProject([A, B], '/films/holiday')).toBe(A)
  })
  it('says what is open when the name matches nothing', () => expect(() => pickProject([A, B], 'wedding')).toThrow('No open project is called "wedding". Open: "holiday" (Holiday), "launch-2" (Launch).'))
  it('asks for the folder name when two projects share a title', () => expect(() => pickProject([A, { dir: '/films/holiday-2', title: 'Holiday' }], 'Holiday')).toThrow('More than one open project'))
  it('says so when nothing is open', () => expect(() => pickProject([])).toThrow('No project is open in AgentShot.'))
})

describe('the tools an outside agent sees', () => {
  it('are the editor’s, each taking an optional project, plus projects and add_files', () => {
    const tools = toolList(editor())
    expect(tools.map(t => t.name)).toEqual(['projects', 'add_files', 'seek'])
    const seek = tools.find(t => t.name === 'seek')!
    expect(Object.keys(seek.inputSchema.properties)).toEqual(['project', 't'])
    expect(seek.inputSchema.required).toEqual(['t'])
    expect(tools.find(t => t.name === 'projects')!.inputSchema.properties).toEqual({})
  })
  it('runs a tool on the project named, without passing the name on', async () => {
    const e = editor()
    expect(await callTool(e, 'seek', { project: 'Holiday', t: 3 }, never)).toEqual({ content: [{ type: 'text', text: 'seek {"t":3} in /films/holiday' }] })
    expect((await callTool(e, 'seek', { t: 3 }, never)).content[0]).toEqual({ type: 'text', text: 'seek {"t":3} in /films/launch-2' })
  })
  it('lists the open projects and marks the one used by default', async () => {
    const r = await callTool(editor(), 'projects', {}, never)
    expect((r.content[0] as { text: string }).text).toBe('holiday: "Holiday" in /films/holiday\nlaunch-2: "Launch" in /films/launch-2 (used when no project is given)')
    expect((await callTool(editor({ projects: () => [] }), 'projects', undefined, never)).content[0]).toEqual({ type: 'text', text: 'No project is open in AgentShot.' })
  })
  it('adds a file from anywhere on the computer, by absolute path only', async () => {
    const e = editor(), file = join(mkdtempSync(join(tmpdir(), 'agentshot-mcp-')), 'song.mp3')
    writeFileSync(file, 'x')
    expect(await callTool(e, 'add_files', { path: file, project: 'holiday' }, never)).toEqual({ content: [{ type: 'text', text: 'Added:\nmedia/song.mp3 (music)' }] })
    expect(e.addFiles).toHaveBeenCalledWith('/films/holiday', file)
    expect(await callTool(e, 'add_files', { path: 'song.mp3' }, never)).toMatchObject({ isError: true, content: [{ text: 'Give the absolute path of a file or folder on this computer.' }] })
    expect(await callTool(e, 'add_files', { path: `${file}.missing` }, never)).toMatchObject({ isError: true })
    expect(e.addFiles).toHaveBeenCalledOnce()
  })
  it('answers a failure as something the agent can read', async () => {
    const e = editor({ call: async () => { throw new Error('No clip "intro".') } })
    expect(await callTool(e, 'seek', { t: 1 }, never)).toEqual({ isError: true, content: [{ type: 'text', text: 'No clip "intro".' }] })
    expect(await callTool(e, 'bash', {}, never)).toMatchObject({ isError: true, content: [{ text: 'AgentShot has no tool called bash.' }] })
    expect(await callTool(editor({ projects: () => [] }), 'seek', { t: 1 }, never)).toMatchObject({ isError: true })
  })
})

describe('the server', () => {
  it('is off, and listening nowhere, until switched on', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'agentshot-mcp-')), 'outside.json')
    const access = new OutsideAccess(file, editor(), 0)
    servers.push(access)
    await access.start()
    expect(access.status()).toEqual({ enabled: false, running: false })
    expect(() => access.setup()).toThrow('Switch it on first.')
  })
  it('lets a real MCP client list and call the tools', async () => {
    const image = { type: 'image' as const, data: Buffer.from('jpeg').toString('base64'), mimeType: 'image/jpeg' }
    const s = await running(editor({ call: vi.fn(async () => ({ content: [{ type: 'text' as const, text: 'frame at 2 s' }, image] })) }))
    expect(s.access.status()).toEqual({ enabled: true, running: true, url: s.url })
    expect(s.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const client = await connect(s.url, s.token)
    expect(client.getInstructions()).toContain('project_state')
    expect((await client.listTools()).tools.map(t => t.name)).toEqual(['projects', 'add_files', 'seek'])
    const r = await client.callTool({ name: 'seek', arguments: { t: 2, project: 'Holiday' } })
    expect(r.content).toEqual([{ type: 'text', text: 'frame at 2 s' }, image])
    expect(s.editor.call).toHaveBeenCalledWith('/films/holiday', 'seek', { t: 2 }, expect.any(AbortSignal))
    await client.close()
  })
  it('refuses anyone without the token, web pages, other hosts and other paths', async () => {
    const s = await running(), auth = { authorization: `Bearer ${s.token}` }
    expect((await raw(s.url, auth)).status).toBe(200)
    expect((await raw(s.url, {})).status).toBe(401)
    expect((await raw(s.url, { authorization: 'Bearer wrong' })).status).toBe(401)
    expect((await raw(s.url, { authorization: s.token })).status).toBe(401)
    expect((await raw(s.url, { ...auth, origin: 'https://evil.example' })).status).toBe(403)
    expect((await raw(s.url, { ...auth, origin: 'http://127.0.0.1' })).status).toBe(403)
    expect((await raw(s.url, { ...auth, host: 'evil.example' })).status).toBe(403)
    expect((await raw(s.url.replace('/mcp', '/'), auth)).status).toBe(404)
    expect((await raw(s.url, auth, 'GET')).status).toBe(405)
    expect(s.editor.call).not.toHaveBeenCalled()
  })
  it('keeps its token where only this user can read it, and its port and token across a restart', async () => {
    const s = await running()
    if (process.platform !== 'win32') expect(statSync(s.file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(s.file, 'utf8')).token).toBe(s.token)
    await s.access.stop()
    const again = new OutsideAccess(s.file, editor(), 0)
    servers.push(again)
    await again.start()
    expect(again.setup()).toMatchObject({ url: s.url, token: s.token })
    expect((await raw(s.url, { authorization: `Bearer ${s.token}` })).status).toBe(200)
  })
  it('forgets the token when switched off, so an agent set up before can’t get back in', async () => {
    const s = await running()
    expect(await s.access.set(false)).toEqual({ enabled: false, running: false })
    expect(JSON.parse(readFileSync(s.file, 'utf8')).token).toBeUndefined()
    await expect(raw(s.url, { authorization: `Bearer ${s.token}` })).rejects.toThrow()
    await s.access.set(true)
    const now = s.access.setup()
    expect(now.token).not.toBe(s.token)
    expect(now.url).toBe(s.url)
    expect((await raw(now.url, { authorization: `Bearer ${s.token}` })).status).toBe(401)
    expect((await raw(now.url, { authorization: `Bearer ${now.token}` })).status).toBe(200)
  })
  it('takes another port when its own is in use', async () => {
    const taken = createServer()
    await new Promise<void>(ok => taken.listen(0, '127.0.0.1', ok))
    try {
      const port = (taken.address() as { port: number }).port
      const access = new OutsideAccess(join(mkdtempSync(join(tmpdir(), 'agentshot-mcp-')), 'outside.json'), editor(), port)
      servers.push(access)
      expect((await access.set(true)).running).toBe(true)
      expect(access.setup().url).not.toContain(`:${port}/`)
    } finally { taken.close() }
  })
  it('gives each agent its own setup: Claude Code’s command and the entry others read', async () => {
    const s = await running()
    expect(s.command).toBe(`claude mcp add --scope user --transport http agentshot ${s.url} --header "Authorization: Bearer ${s.token}"`)
    expect(JSON.parse(s.json)).toEqual({ mcpServers: { agentshot: { type: 'http', url: s.url, headers: { Authorization: `Bearer ${s.token}` } } } })
  })
  it('stops the work when the agent hangs up mid-call', async () => {
    let signal: AbortSignal | undefined
    const s = await running(editor({ call: (_d, _n, _a, sig) => { signal = sig; return new Promise(() => {}) } }))
    const { port } = new URL(s.url)
    const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${s.token}` } })
    req.on('error', () => {})
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'seek', arguments: { t: 1 } } }))
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(signal!.aborted).toBe(false)
    req.destroy()
    await vi.waitFor(() => expect(signal!.aborted).toBe(true))
  })
})

describe('the editor’s own tools, from outside', () => {
  async function agent(bridge: Record<string, unknown>) {
    const root = mkdtempSync(join(tmpdir(), 'agentshot-mcp-agent-'))
    const a = await startAgent({ dbPath: join(root, 'agent.sqlite'), bridge: bridge as never, memory: new Memory(join(root, 'memory')),
      skills: new Skills({ bundled: join(root, 'none'), profiles: join(root, 'profiles') }), browserPrompt: () => 'browser', onEvent: () => {} })
    return a
  }
  it('are offered without the ones that need AgentShot’s own conversation, a shell or a filmed browser', async () => {
    const a = await agent({ project: () => undefined })
    try {
      const names = a.outside.tools().map(t => t.name)
      for (const n of ['project_state', 'transcript', 'analyze_video', 'look', 'edit_timeline', 'ffmpeg', 'propose_version', 'create_clip', 'export_video', 'remember']) expect(names).toContain(n)
      for (const n of ['ask_user', 'suggest_next', 'demo_layout', 'compose_demo', 'import_media', 'walkthrough_record', 'compose_walkthrough', 'bash', 'read', 'write', 'edit']) expect(names).not.toContain(n)
      // what an MCP client is sent must be plain JSON Schema objects
      for (const t of toolList({ ...editor(), tools: a.outside.tools })) expect(t.inputSchema.type).toBe('object')
    } finally { await a.shutdown() }
  })
  it('run on the project folder the call names, and refuse input that doesn’t fit', async () => {
    const seek = vi.fn()
    const a = await agent({ project: (dir: string) => (dir === '/films/holiday' ? { dir } : undefined), seek })
    try {
      expect(await a.outside.call('/films/holiday', 'seek', { t: 12 }, never)).toEqual({ content: [{ type: 'text', text: 'playhead → 0:12.0' }] })
      expect(seek).toHaveBeenCalledWith('/films/holiday', 12)
      await expect(a.outside.call('/films/holiday', 'seek', { t: 'soon' }, never)).rejects.toThrow(/^seek: t: /)
      await expect(a.outside.call('/films/other', 'seek', { t: 1 }, never)).rejects.toThrow('This project is not open.')
      await expect(a.outside.call('/films/holiday', 'ask_user', {}, never)).rejects.toThrow('AgentShot has no tool called ask_user.')
      expect(seek).toHaveBeenCalledOnce()
    } finally { await a.shutdown() }
  })
})

describe('adding AgentShot to Claude Code', () => {
  it('replaces an older entry, for every folder, with the token as a header', async () => {
    const calls: string[][] = []
    vi.mocked(execFile).mockImplementation(((_bin: string, args: string[], _o: unknown, done: (e: Error | null, out: string) => void) => {
      calls.push(args)
      done(args[1] === 'remove' ? new Error('not found') : null, '')
    }) as never)
    const c = new ClaudeCodeConnection(join(mkdtempSync(join(tmpdir(), 'agentshot-mcp-')), 'claude-code.json'), process.execPath)
    await c.addServer('agentshot', 'http://127.0.0.1:48620/mcp', 'secret')
    expect(calls).toEqual([
      ['mcp', 'remove', '--scope', 'user', 'agentshot'],
      ['mcp', 'add', '--scope', 'user', '--transport', 'http', 'agentshot', 'http://127.0.0.1:48620/mcp', '--header', 'Authorization: Bearer secret'],
    ])
  })
})
