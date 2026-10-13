import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'
import { demoOutputMessage } from '../src/renderer/src/lib/demo-output'

const history = (): Message[] => [
  { id: 'u1', role: 'user', content: 'Make a demo' },
  { id: 'compose', role: 'assistant', toolCalls: [{ id: 'call1', type: 'function', function: { name: 'compose_demo', arguments: '{}' } }] },
  { id: 'result', role: 'tool', toolCallId: 'call1', content: JSON.stringify({ version: 'v2' }) },
  { id: 'output', role: 'assistant', content: 'Your video is ready.' },
]
describe('output-anchored face-layout follow-up', () => {
  it('stays below its output when new messages arrive', () => {
    const messages = history(), v = { id: 'v2', path: 'renders/demo.mp4' }
    expect(demoOutputMessage(messages, v)).toBe('output')
    messages.push({ id: 'u2', role: 'user', content: 'Trim tighter' }, { id: 'a2', role: 'assistant', content: 'Measuring pauses.' })
    expect(demoOutputMessage(messages, v)).toBe('output')
    expect(demoOutputMessage(JSON.parse(JSON.stringify(messages)), v)).toBe('output') // restored durable history
  })
  it('anchors a new rendered version to its own final reply', () => {
    const messages = history()
    messages.push({ id: 'u2', role: 'user', content: 'Render adjustments' },
      { id: 'render', role: 'assistant', toolCalls: [{ id: 'call2', type: 'function', function: { name: 'rerender_timeline', arguments: '{}' } }] },
      { id: 'render-result', role: 'tool', toolCallId: 'call2', content: 'Proposed as version v3.' },
      { id: 'new-output', role: 'assistant', content: 'Updated video ready.' })
    expect(demoOutputMessage(messages, { id: 'v3', path: 'renders/new.mp4' })).toBe('new-output')
    expect(demoOutputMessage(messages, { id: 'v2', path: 'renders/demo.mp4' })).toBe('output')
  })
  it('does not attach a follow-up to an unrelated conversation or failed render', () => {
    expect(demoOutputMessage(history(), { id: 'v9', path: 'missing.mp4' })).toBeUndefined()
    expect(demoOutputMessage([])).toBeUndefined()
  })
})
