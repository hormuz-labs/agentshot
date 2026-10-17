// The real pi-durable harness: conversations per project, switching, surviving a restart, and (with a model on
// 127.0.0.1) what happens to a message sent while a run fails.
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { joinInputs, startAgent, stranded, type Bridge } from '../src/main/agent'
import type { CustomProvider } from '../src/shared/providers'
import { Memory } from '../src/main/memory'
import { Skills } from '../src/main/skills'

// custom providers come from the Mac's settings: here, a model on 127.0.0.1 when a test sets one
const providers = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('../src/main/providers', async orig => {
  const real = await orig<typeof import('../src/main/providers')>()
  return { ...real, buildProviders: () => real.buildProviders(providers.list as CustomProvider[]), listProviders: () => providers.list }
})

const root = mkdtempSync(join(tmpdir(), 'manul-agent-'))
const dir = join(root, 'project')
const bridge = { project: () => undefined } as unknown as Bridge
const deps = () => ({
  dbPath: join(root, 'agent.sqlite'), bridge,
  memory: new Memory(join(root, 'memory')),
  skills: new Skills({ bundled: join(root, 'none'), user: join(root, 'skills'), profiles: join(root, 'profiles') }),
})

describe('conversations', () => {
  it('opens, starts new ones, switches, and keeps them across a restart', async () => {
    const threads: string[] = []
    let agent = await startAgent({ ...deps(), onEvent: (_d, e) => { if ((e as { threadId?: string }).threadId) threads.push((e as { threadId: string }).threadId) } })
    const a = await agent.open(dir)
    const b = await agent.newConversation(dir)
    expect(b).not.toBe(a)
    expect(agent.current(dir)).toBe(b)
    expect(await agent.open(dir, a)).toBe(a)
    expect(agent.current(dir)).toBe(a)
    await agent.shutdown()

    agent = await startAgent({ ...deps(), onEvent: () => {} })
    expect(await agent.open(dir, b)).toBe(b) // the same durable conversation after a restart
    await agent.shutdown()
  })
})

describe('viewers (the phone)', () => {
  it('replay to themselves only, follow conversation switches, and stop when unsubscribed', async () => {
    const main: string[] = []
    const agent = await startAgent({ ...deps(), dbPath: join(root, 'viewers.sqlite'), onEvent: (_d, e) => main.push(e.type) })
    const a: string[] = [], b: string[] = []
    const offA = agent.subscribe(dir, e => a.push(e.type))
    expect(a).toEqual([]) // not open yet

    await agent.open(dir)
    expect(a).toContain('MESSAGES_SNAPSHOT') // replayed once it opened
    const mainAfterOpen = main.length, aAfterOpen = a.length

    const offB = agent.subscribe(dir, e => b.push(e.type))
    expect(b).toContain('MESSAGES_SNAPSHOT') // already open: replayed at once
    expect(a.length).toBe(aAfterOpen) // …to the new viewer only
    expect(main.length).toBe(mainAfterOpen) // and not to the window

    await agent.newConversation(dir)
    expect(a.length).toBeGreaterThan(aAfterOpen) // followed the switch
    const bAfterSwitch = b.length

    offB()
    await agent.newConversation(dir)
    expect(b.length).toBe(bAfterSwitch)
    offA()
    await agent.shutdown()
  })
})

describe('a message sent while a run fails', () => {
  it('still reaches the agent (the phone, right after an upload, while the agent was answering)', async () => {
    // a model on 127.0.0.1: the first request waits, then fails; later ones answer "ok"
    const asked: string[][] = []
    let fail: (() => void) | null = null
    const server = createServer(async (req, res) => {
      let body = ''
      for await (const c of req) body += c
      const said = (JSON.parse(body).messages as { role: string; content: unknown }[])
        .filter(m => m.role === 'user').map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
      asked.push(said)
      if (asked.length === 1) {
        await new Promise<void>(r => { fail = r })
        res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'no such key', type: 'invalid_request_error' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      const chunk = (delta: object, finish: string | null) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'fake', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
      res.end(chunk({ role: 'assistant', content: 'ok' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n')
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    providers.list = [{ id: 'local', name: 'Local', baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, api: 'openai-completions', models: [{ id: 'fake', reasoning: false, images: false }] }]
    process.env.MANUL_PROVIDER_LOCAL_KEY = 'test'
    const project = { model: { provider: 'local', modelId: 'fake' } }
    const agent = await startAgent({ ...deps(), dbPath: join(root, 'stranded.sqlite'), bridge: { project: () => project } as unknown as Bridge, onEvent: () => {} })
    try {
      await agent.open(dir)
      const users: string[][] = []
      agent.subscribe(dir, e => { if (e.type === 'MESSAGES_SNAPSHOT') users.push((e as unknown as { messages: { role: string; content: string }[] }).messages.filter(m => m.role === 'user').map(m => m.content)) })

      await agent.send(dir, 'Cut the intro')
      await expect.poll(() => asked.length).toBe(1) // the agent is answering…
      await agent.send(dir, 'Open with this\n\n[attached files]\n- media/IMG_0042.MOV') // …when the phone's clip lands and it says so
      fail!() // and that answer fails

      await expect.poll(() => users.at(-1), { timeout: 10_000 }).toEqual(['Cut the intro', 'Open with this\n\n[attached files]\n- media/IMG_0042.MOV'])
      await expect.poll(() => asked.length, { timeout: 10_000 }).toBe(2) // asked again, with it, without anything else being sent
      expect(asked[1]).toEqual(['Cut the intro', 'Open with this\n\n[attached files]\n- media/IMG_0042.MOV'])
    } finally {
      await agent.shutdown()
      server.close()
      providers.list = []
      delete process.env.MANUL_PROVIDER_LOCAL_KEY
    }
  })

  it('takes several queued messages back as one, in order', () => {
    expect(joinInputs(['a', 'b'])).toBe('a\n\nb')
    expect(joinInputs(['a', [{ type: 'image', data: 'x', mimeType: 'image/jpeg' }]])).toEqual([{ type: 'text', text: 'a' }, { type: 'image', data: 'x', mimeType: 'image/jpeg' }])
    const view = (live: object, items: object[]) => ({ docs: { 'pi.live': live, 'pi.inbox': { items } } })
    const steer = { id: 1, mode: 'steer', content: 'a' }, write = { id: 2, mode: 'write', entry: {} }
    expect(stranded(view({ run: {} }, [steer]))).toEqual([]) // still running: it will be placed
    expect(stranded(view({}, [steer, write]))).toEqual([steer])
    expect(stranded(view({}, []))).toEqual([])
  })
})
