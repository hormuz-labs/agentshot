import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ClaudeCodeConnection } from '../src/main/claude-code'
import { ClaudeCodeRun } from '../src/main/claude-code-agent'
import { codingExtension, editorExtension, startAgent } from '../src/main/agent'
import { Memory } from '../src/main/memory'
import { Skills } from '../src/main/skills'
import { AguiAdapter } from '../src/main/agui'

const sdk = vi.hoisted(() => ({ query: vi.fn(), tools: [] as any[] }))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: sdk.query,
  startup: vi.fn(),
  tool: (name: string, description: string, schema: unknown, handler: unknown) => ({ name, description, schema, handler }),
  createSdkMcpServer: (options: any) => { sdk.tools = options.tools; return options },
}))
afterEach(() => { sdk.query.mockReset(); sdk.tools = [] })

function fixture(extensions: any[] = []) {
  const entries: any[] = [], events: any[] = []
  const conv = { id: 1, waitForIdle: async () => {}, agent: async () => ({}),
    context: async () => ({ messages: entries.flatMap(e => e.model) }),
    submit: async ({ entry }: any) => { entries.push({ ...entry, id: entries.length + 1 }); return { wait: async () => {} } },
  }
  let run: ClaudeCodeRun
  const adapter = new AguiAdapter('1', e => events.push(e))
  run = new ClaudeCodeRun({ conv: conv as never, model: 'opus', executable: '/published/claude', dir: '/project', extensions,
    env: { cwd: '/project' } as never, update: () => adapter.update(run.view({ entries, docs: {} })) })
  return { run, entries, events }
}
function stream(iterable: AsyncGenerator<any>) { return Object.assign(iterable, { close: vi.fn() }) }

describe('Claude Code backend', () => {
  it('persists Claude turns in the real SQLite harness and replays them after restart', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentshot-claude-durable-')), dir = join(root, 'project')
    const events: any[] = []
    const deps = { dbPath: join(root, 'agent.sqlite'),
      bridge: { project: () => ({ dir, model: { provider: 'claude-code', modelId: 'opus' } }) } as never,
      memory: new Memory(join(root, 'memory')), skills: new Skills({ bundled: join(root, 'none'), profiles: join(root, 'profiles') }),
      claudeCode: { executable: '/published/claude', status: async () => ({ connected: true, enabled: true }),
        models: async () => [{ value: 'opus', displayName: 'Opus' }] } as never,
      onEvent: (_dir: string, e: any) => events.push(e) }
    sdk.query.mockImplementation(() => stream((async function* () {
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Persisted response' }] } }
      yield { type: 'result', subtype: 'success', is_error: false }
    })()))
    let agent = await startAgent(deps)
    try {
      const id = await agent.open(dir)
      await agent.send(dir, 'Remember this turn')
      await vi.waitFor(() => expect(events.some(e => e.type === 'RUN_FINISHED')).toBe(true))
      expect(events.find(e => e.type === 'RUN_ERROR')).toBeUndefined()
      await agent.shutdown()
      events.length = 0
      agent = await startAgent(deps)
      await agent.open(dir, id)
      await vi.waitFor(() => expect(JSON.stringify(events)).toContain('Persisted response'))
      expect(JSON.stringify(events)).toContain('Remember this turn')
    } finally { await agent.shutdown() }
  })
  it('bridges existing tools and durable messages, with no built-in or unfenced tools', async () => {
    const execute = vi.fn(async (_args, api, context) => {
      expect(api.env.cwd).toBe('/project')
      expect(context.abortSignal).toBeInstanceOf(AbortSignal)
      return { content: [{ type: 'text', text: 'edited' }] }
    })
    sdk.query.mockImplementation(({ options, prompt }) => stream((async function* () {
      expect(options.tools).toEqual([])
      expect(options.settingSources).toEqual([])
      expect(options.persistSession).toBe(false)
      expect(options.pathToClaudeCodeExecutable).toBe('/published/claude')
      expect(JSON.parse(prompt).messages[0].content[0].text).toBe('Edit this')
      expect((await options.canUseTool('Bash', {})).behavior).toBe('deny')
      expect(await sdk.tools[0].handler({ title: 'Cut' })).toEqual({ isError: false, content: [{ type: 'text', text: 'edited' }] })
      yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Done' } } }
      yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Done' }] } }
      yield { type: 'result', subtype: 'success', is_error: false }
    })()))
    const f = fixture([{ name: 'editor', tools: [{ name: 'propose', description: 'propose', parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }, execute }] }])
    await f.run.start('Edit this')
    expect(execute).toHaveBeenCalledOnce()
    expect(f.entries.flatMap(e => e.model).map(m => m.role)).toEqual(['user', 'assistant', 'toolResult', 'assistant'])
    expect(f.events.map(e => e.type)).toContain('TEXT_MESSAGE_CONTENT')
    expect(f.events.map(e => e.type)).toContain('RUN_FINISHED')
    expect(f.run.view({ marker: true })).toEqual({ marker: true })
  })
  it('accepts the complete existing editor and coding JSON schemas', async () => {
    sdk.query.mockImplementation(() => stream((async function* () { yield { type: 'result', subtype: 'success', is_error: false } })()))
    const f = fixture([codingExtension(), editorExtension({ project: () => undefined } as never, () => '/project')])
    await f.run.start('hello')
    expect(f.events.find(e => e.type === 'RUN_ERROR')?.message).toBeUndefined()
    expect(sdk.query).toHaveBeenCalledOnce()
    expect(sdk.tools.some(t => t.name === 'ffmpeg')).toBe(true)
    expect(f.events.some(e => e.type === 'RUN_ERROR')).toBe(false)
  })
  it('sends attachments as actual image blocks', async () => {
    sdk.query.mockImplementation(({ prompt }) => stream((async function* () {
      const messages = []
      for await (const m of prompt) messages.push(m)
      expect(messages[0].message.content).toContainEqual({ type: 'image', source: { type: 'base64', data: 'jpeg', media_type: 'image/jpeg' } })
      yield { type: 'result', subtype: 'success', is_error: false }
    })()))
    await fixture().run.start([{ type: 'text', text: 'Look' }, { type: 'image', data: 'jpeg', mimeType: 'image/jpeg' }])
  })
  it('records failed/incomplete inference without falling back to BYOK', async () => {
    sdk.query.mockImplementation(() => stream((async function* () {})()))
    const f = fixture()
    await f.run.start('hello')
    expect(f.events.find(e => e.type === 'RUN_ERROR')?.message).toContain('stopped before completing')
    expect(sdk.query).toHaveBeenCalledOnce()
  })
  it('cancels inference and closes its subprocess', async () => {
    let ready!: () => void
    const started = new Promise<void>(r => { ready = r })
    const close = vi.fn()
    sdk.query.mockImplementation(({ options }) => Object.assign((async function* () {
      ready()
      await new Promise<void>(r => options.abortController.signal.addEventListener('abort', () => r(), { once: true }))
    })(), { close }))
    const f = fixture()
    const done = f.run.start('hello')
    await started; await f.run.stop(); await done
    expect(close).toHaveBeenCalledOnce()
    expect(f.events.some(e => e.type === 'RUN_ERROR')).toBe(false)
  })
})

describe('Claude Code connection preferences', () => {
  it('handles a missing published binary without requesting credentials', async () => {
    const c = new ClaudeCodeConnection('/unused', '/missing/claude')
    const s = await c.status()
    expect(s.connected).toBe(false)
    expect(await c.models()).toEqual([])
  })
  it('stores only opt-in, never authentication, and disconnect does not logout Claude Code', async () => {
    const root = mkdtempSync(join(tmpdir(), 'agentshot-claude-'))
    const bin = join(root, 'claude'), prefs = join(root, 'prefs.json')
    writeFileSync(bin, '#!/bin/sh\necho \'{"loggedIn":true,"authMethod":"claude.ai","email":"user@example.test"}\'\n', { mode: 0o700 })
    const c = new ClaudeCodeConnection(prefs, bin)
    expect(await c.connect()).toMatchObject({ enabled: true, connected: true, subscription: true })
    expect(JSON.parse(readFileSync(prefs, 'utf8'))).toEqual({ enabled: true })
    expect(await c.disconnect()).toMatchObject({ enabled: false, connected: true })
  })
})
