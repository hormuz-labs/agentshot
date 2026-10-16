import { EventType, type BaseEvent } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'
import { AguiAdapter } from '../src/main/agui'
import { reduce, resultsOf, type AgentState } from '../src/shared/agui-state'

const empty = (): AgentState => ({ messages: [], streaming: null, pending: {}, running: [], busy: false, error: null, cost: 0 })
const view = (o: { entries?: unknown[]; live?: Record<string, unknown>; cost?: number }) => ({
  entries: o.entries || [],
  docs: { 'pi.live': o.live || {}, 'pi.usage': { models: o.cost ? { m: { cost: { total: o.cost } } } : {} } },
})
const user = (id: number, text: string) => ({ id, model: [{ role: 'user', content: text }] })

function harness() {
  const events: (BaseEvent & Record<string, any>)[] = []
  const a = new AguiAdapter('t1', e => events.push(e as BaseEvent & Record<string, any>))
  return { a, events, types: () => events.map(e => e.type) }
}

describe('AguiAdapter (pi-durable view → AG-UI events)', () => {
  it('emits a run lifecycle around busy views', () => {
    const { a, types } = harness()
    a.update(view({ live: { run: {} } }))
    a.update(view({}))
    expect(types()).toEqual([EventType.RUN_STARTED, EventType.RUN_FINISHED])
  })

  it('streams text as deltas and closes the message', () => {
    const { a, events } = harness()
    const gen = (t: string) => view({ live: { run: {}, generation: { message: { content: [{ type: 'text', text: t }] } } } })
    a.update(gen('Hel'))
    a.update(gen('Hello'))
    a.update(view({ live: { run: {} } }))
    const text = events.filter(e => e.type.startsWith('TEXT_MESSAGE'))
    expect(text.map(e => e.type)).toEqual([EventType.TEXT_MESSAGE_START, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_CONTENT, EventType.TEXT_MESSAGE_END])
    expect(text.filter(e => e.delta).map(e => e.delta).join('')).toBe('Hello')
    expect(new Set(text.map(e => e.messageId)).size).toBe(1)
  })

  it('streams tool-call arguments and ends the call', () => {
    const { a, events } = harness()
    const call = (args: object) => view({ live: { run: {}, generation: { message: { content: [{ type: 'toolCall', id: 'c1', name: 'ffmpeg', arguments: args }] } } } })
    a.update(call({}))
    a.update(call({ args: ['-i'] }))
    a.update(call({ args: ['-i', 'media/a b.mp4'] }))
    a.update(view({ live: { run: {} } }))
    expect(events.find(e => e.type === EventType.TOOL_CALL_START)).toMatchObject({ toolCallId: 'c1', toolCallName: 'ffmpeg' })
    const args = events.filter(e => e.type === EventType.TOOL_CALL_ARGS).map(e => e.delta).join('')
    expect(JSON.parse(args)).toEqual({ args: ['-i', 'media/a b.mp4'] })
    expect(events.some(e => e.type === EventType.TOOL_CALL_END && e.toolCallId === 'c1')).toBe(true)
  })

  it('turns committed entries into a messages snapshot with tool calls and results', () => {
    const { a, events } = harness()
    a.update(view({
      cost: 0.02,
      entries: [user(1, 'cut it'), { id: 2, model: [
        { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'toolCall', id: 'c1', name: 'probe', arguments: { path: 'a.mp4' } }] },
        { role: 'toolResult', toolCallId: 'c1', content: [{ type: 'text', text: '{"duration":3}' }] },
      ] }],
    }))
    const snap = events.find(e => e.type === EventType.MESSAGES_SNAPSHOT)!
    expect(snap.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'tool'])
    expect(snap.messages[1].toolCalls[0]).toMatchObject({ id: 'c1', function: { name: 'probe', arguments: '{"path":"a.mp4"}' } })
    expect(events.find(e => e.type === EventType.CUSTOM)).toMatchObject({ name: 'manul.usage', value: { cost: 0.02 } })
  })

  it('does not repeat an unchanged snapshot', () => {
    const { a, types } = harness()
    const v = view({ entries: [user(1, 'hi')] })
    a.update(v); a.update(v)
    expect(types().filter(t => t === EventType.MESSAGES_SNAPSHOT)).toHaveLength(1)
  })

  it('reports a model error once', () => {
    const { a, types } = harness()
    const v = view({ entries: [{ id: 1, model: [{ role: 'assistant', stopReason: 'error', errorMessage: 'quota', content: [] }] }] })
    a.update(v); a.update(v)
    expect(types().filter(t => t === EventType.RUN_ERROR)).toHaveLength(1)
  })

  it('replay resends the full state', () => {
    const { a, types } = harness()
    const v = view({ entries: [user(1, 'hi')] })
    a.update(v); a.replay(v)
    expect(types().filter(t => t === EventType.MESSAGES_SNAPSHOT)).toHaveLength(2)
  })
})

describe('renderer reducer', () => {
  const fold = (events: Record<string, any>[]) => events.reduce((s, e) => reduce(s, e as any), empty())

  it('folds a full run', () => {
    const s = fold([
      { type: EventType.RUN_STARTED },
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'Hi ' },
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm', delta: 'there' },
    ])
    expect(s).toMatchObject({ busy: true, streaming: { id: 'm', text: 'Hi there' } })
    const done = reduce(s, { type: EventType.RUN_FINISHED } as any)
    expect(done).toMatchObject({ busy: false, streaming: null })
  })

  it('tracks streaming tool args and running tools', () => {
    const s = fold([
      { type: EventType.TOOL_CALL_START, toolCallId: 'c', toolCallName: 'seek' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'c', delta: '{"t":' },
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 'c', delta: '3}' },
      { type: EventType.ACTIVITY_SNAPSHOT, activityType: 'tools', content: { running: ['c'] } },
    ])
    expect(s.pending.c).toEqual({ name: 'seek', args: '{"t":3}' })
    expect(s.running).toEqual(['c'])
    expect(reduce(s, { type: EventType.TOOL_CALL_END, toolCallId: 'c' } as any).pending).toEqual({})
  })

  it('maps tool results by call id', () => {
    expect(resultsOf([{ id: '1', role: 'tool', toolCallId: 'c', content: 'ok' } as any])).toEqual({ c: { content: 'ok', error: false } })
  })
})
