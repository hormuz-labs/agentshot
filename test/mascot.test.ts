import { describe, expect, it } from 'vitest'
import { EventType } from '@ag-ui/core'
import { reduce, type AgentState } from '../src/renderer/src/lib/agui'
import { mascotActivity } from '../src/renderer/src/lib/mascot'

const empty = (): AgentState => ({ messages: [], streaming: null, pending: {}, running: [], busy: false, error: null, cost: 0 })
const event = (s: AgentState, type: string, content: Record<string, unknown> = {}) => reduce(s, { type, ...content } as any)

describe('the companion follows the actual agent lifecycle', () => {
  it('thinks, speaks, runs a tool, then returns to idle even with old tool cards present', () => {
    let s = event(empty(), EventType.RUN_STARTED)
    expect(mascotActivity(s).state).toBe('thinking')
    s = event(s, EventType.TEXT_MESSAGE_CONTENT, { messageId: 'reply', delta: 'On it.' })
    expect(mascotActivity(s).state).toBe('speaking')
    s = event(s, EventType.TEXT_MESSAGE_END)
    s = event(s, EventType.TOOL_CALL_START, { toolCallId: 'render', toolCallName: 'ffmpeg' })
    expect(mascotActivity(s).state).toBe('thinking')
    s = event(s, EventType.MESSAGES_SNAPSHOT, { messages: [{ id: 'm', role: 'assistant', toolCalls: [{ id: 'render', function: { name: 'ffmpeg', arguments: '{}' } }] }] })
    s = event(s, EventType.ACTIVITY_SNAPSHOT, { activityType: 'tools', content: { running: ['render'] } })
    expect(mascotActivity(s)).toMatchObject({ state: 'working', label: 'Rendering your edit' })
    s = event(s, EventType.ACTIVITY_SNAPSHOT, { activityType: 'tools', content: { running: [] } })
    s = event(s, EventType.RUN_FINISHED)
    expect(mascotActivity(s).state).toBe('idle')
  })

  it('waits for questions and permissions rather than pretending to keep working', () => {
    const s: AgentState = { ...empty(), busy: true, running: ['question'], messages: [{ id: 'm', role: 'assistant', toolCalls: [{ id: 'question', type: 'function', function: { name: 'ask_user', arguments: '{}' } }] }] }
    expect(mascotActivity(s).state).toBe('waiting')
    expect(mascotActivity({ ...empty(), busy: true }, true).state).toBe('waiting')
    expect(mascotActivity({ ...s, running: [] }).state).toBe('thinking')
  })

  it('makes errors visible even before the run-finished event and clears on retry', () => {
    const failed = event({ ...empty(), busy: true }, EventType.RUN_ERROR, { message: 'quota' })
    expect(mascotActivity(failed).state).toBe('error')
    expect(mascotActivity(event(failed, EventType.RUN_STARTED)).state).toBe('thinking')
  })
})
