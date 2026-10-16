// The real pi-durable harness (no model needed): conversations per project, switching, and surviving a restart.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startAgent, type Bridge } from '../src/main/agent'
import { Memory } from '../src/main/memory'
import { Skills } from '../src/main/skills'

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
