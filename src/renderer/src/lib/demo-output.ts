import type { Message } from '@ag-ui/core'
import type { Version } from '../../../shared/types'

/** Locate the reply belonging to a rendered version, stopping at the next user turn. Recomputed from durable chat. */
export function demoOutputMessage(messages: Message[], version?: Pick<Version, 'id' | 'path'>): string | undefined {
  if (!version) return undefined
  const results = new Map(messages.filter(m => m.role === 'tool').map(m => [m.toolCallId, String(m.content || '')]))
  let output = -1
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== 'assistant') continue
    for (const call of m.toolCalls || []) {
      if (!['compose_demo', 'rerender_timeline', 'propose_version'].includes(call.function.name)) continue
      const result = results.get(call.id)
      if (!result) continue
      let matched = false
      try { matched = JSON.parse(result).version === version.id } catch { /* older text tool results */ }
      if (matched || result.includes(`version ${version.id}.`) || result.includes(`version ${version.id}:`)) output = i
    }
  }
  if (output < 0) return undefined
  let anchor = messages[output].id
  for (let i = output + 1; i < messages.length && messages[i].role !== 'user'; i++) {
    const m = messages[i]
    if (m.role === 'assistant' && String(m.content || '').trim()) anchor = m.id
  }
  return anchor
}
