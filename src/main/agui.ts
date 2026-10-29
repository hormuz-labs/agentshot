// pi-durable → AG-UI. A conversation's durable view (committed entries + live generation) is turned into standard
// AG-UI events by diffing it against the previous view:
//   committed messages      → MESSAGES_SNAPSHOT (user / assistant with toolCalls / tool results)
//   streaming text          → TEXT_MESSAGE_START / CONTENT (deltas) / END
//   streaming tool calls    → TOOL_CALL_START / ARGS (deltas) / END
//   running tools           → ACTIVITY_SNAPSHOT (activityType "tools")
//   busy edges              → RUN_STARTED / RUN_FINISHED, model errors → RUN_ERROR
// pi-durable stays the store; these events are only the wire format to the renderer.
import { EventType, type BaseEvent, type Message } from '@ag-ui/core'
import { stepDetail, stepTitle } from '../shared/steps'
import { toolErrorHint } from '../shared/tool-errors'

type Any = Record<string, any> // pi-durable's view is plain JSON; only the fields below are read

const textOf = (c: unknown): string =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: Any) => (x.type === 'text' ? x.text : '')).join('') : ''

/** AgentShot's gateway's refusals, said so the person knows what to do. */
export function friendly(error: string) {
  if (/budget exceeded/i.test(error)) return 'You’re out of AgentShot credits. Get a plan or more credits in Settings → Keys → AgentShot key.'
  if (/model_blocked|is not allowed for virtual key/i.test(error)) return 'AgentShot Max and Ultra come with a Pro or Max plan. Get one in Settings → Keys → AgentShot key, or pick AgentShot High.'
  if (/access not found|virtual key is required/i.test(error)) return 'Your AgentShot key isn’t valid any more. Sign in again in Settings → Keys → AgentShot key.'
  return error
}

/** Committed conversation → AG-UI messages, plus usage cost and any model error. */
function messagesOf(view: Any): { messages: Message[]; cost: number; error?: string } {
  const messages: Message[] = []
  // which tool each call was, for the plain-words hint on a failed one
  const names = new Map<string, string>()
  let error: string | undefined
  for (const e of view.entries || []) {
    for (const [i, m] of ((e.model || []) as Any[]).entries()) {
      const id = `${e.id}:${i}`
      if (m.role === 'user') {
        // a new turn: an error before it was the last turn's, answered by asking again
        error = undefined
        // when it was said, for the phone's swipe-to-see-times
        messages.push({ id, role: 'user', content: textOf(m.content), ...(m.timestamp ? { at: m.timestamp } : {}) } as Message)
      } else if (m.role === 'assistant') {
        // the turn's error is its latest reply's: one that carried on after it (a retry that worked) clears it
        error = m.stopReason === 'error' ? friendly(m.errorMessage || 'The model returned an error.') : undefined
        const calls = ((m.content || []) as Any[]).filter(c => c.type === 'toolCall')
        messages.push({
          id, role: 'assistant', ...(m.timestamp ? { at: m.timestamp } : {}),
          content: ((m.content || []) as Any[]).filter(c => c.type === 'text').map(c => c.text).join('').trim() || undefined,
          // each step with its title in words, as the desktop shows it (the phone shows the same, no copy of its own)
          toolCalls: calls.length
            ? calls.map(c => {
              names.set(c.id, c.name)
              return { id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) }, title: stepTitle(c.name, c.arguments || {}), detail: stepDetail(c.name, c.arguments || {}) }
            })
            : undefined,
        })
      } else if (m.role === 'toolResult') {
        const content = textOf(m.content).slice(0, 8000)
        messages.push({ id, role: 'tool', toolCallId: m.toolCallId, content, ...(m.isError ? { error: 'tool error', hint: toolErrorHint(names.get(m.toolCallId) || '', content) } : {}) } as Message)
      }
    }
  }
  const usage = (view.docs?.['pi.usage']?.models || {}) as Record<string, Any>
  const cost = Object.values(usage).reduce((s, u) => s + (u.cost?.total || 0), 0)
  return { messages, cost, error }
}

/**
 * Arguments stream as text whose concatenation must be the final JSON. Re-serialising a growing object is not
 * prefix-stable (`{"a":"he"}` → `{"a":"hel"}`), but it is once its closing quotes and brackets are cut off.
 */
const open = (json: string) => json.replace(/["}\]]+$/, '')

type Call = { sent: string; full: string }
type Live = { busy: boolean; text: string; textId?: string; tools: Map<string, Call>; running: string[]; snapshot: string; error?: string }

export class AguiAdapter {
  private last: Live = { busy: false, text: '', tools: new Map(), running: [], snapshot: '[]' }
  private runId = 0

  constructor(private threadId: string, private emit: (e: BaseEvent) => void) {}

  /** Feed the latest durable view; emits whatever changed since the previous one. */
  update(view: Any) {
    const now = Date.now()
    const live = (view.docs?.['pi.live'] || {}) as Any
    const busy = !!live.run || !!live.generation || (live.tools || []).length > 0
    const prev = this.last
    const next: Live = { busy, text: '', tools: new Map(), running: [], snapshot: prev.snapshot, error: prev.error }

    if (busy && !prev.busy) this.emit({ type: EventType.RUN_STARTED, threadId: this.threadId, runId: `run-${++this.runId}`, timestamp: now } as BaseEvent)

    // streaming assistant text
    const gen = live.generation?.message as Any | undefined
    const genText = gen ? ((gen.content || []) as Any[]).filter(c => c.type === 'text').map(c => c.text).join('') : ''
    if (genText) {
      next.textId = prev.textId || `live-${now}`
      if (!prev.textId) this.emit({ type: EventType.TEXT_MESSAGE_START, messageId: next.textId, role: 'assistant', timestamp: now } as BaseEvent)
      const delta = genText.startsWith(prev.text) ? genText.slice(prev.text.length) : genText
      if (delta) this.emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId: next.textId, delta, timestamp: now } as BaseEvent)
      next.text = genText
    }
    if (prev.textId && !genText) this.emit({ type: EventType.TEXT_MESSAGE_END, messageId: prev.textId, timestamp: now } as BaseEvent)

    // streaming tool calls (arguments arrive as they are generated)
    for (const c of ((gen?.content || []) as Any[]).filter(c => c.type === 'toolCall' && c.id)) {
      const full = JSON.stringify(c.arguments || {})
      const before = prev.tools.get(c.id)
      if (!before) this.emit({ type: EventType.TOOL_CALL_START, toolCallId: c.id, toolCallName: c.name, timestamp: now } as BaseEvent)
      let sent = before?.sent || ''
      const cand = open(full)
      if (cand.startsWith(sent) && cand.length > sent.length) {
        this.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: c.id, delta: cand.slice(sent.length), timestamp: now } as BaseEvent)
        sent = cand
      }
      next.tools.set(c.id, { sent, full })
    }
    for (const [id, call] of prev.tools) {
      if (next.tools.has(id)) continue
      // close the JSON: whatever of the final arguments has not been sent yet
      if (call.full.startsWith(call.sent) && call.full.length > call.sent.length) {
        this.emit({ type: EventType.TOOL_CALL_ARGS, toolCallId: id, delta: call.full.slice(call.sent.length), timestamp: now } as BaseEvent)
      }
      this.emit({ type: EventType.TOOL_CALL_END, toolCallId: id, timestamp: now } as BaseEvent)
    }

    // tools executing right now
    next.running = ((live.tools || []) as Any[]).filter(s => s.status !== 'done').map(s => s.callId)
    if (next.running.join() !== prev.running.join()) {
      this.emit({ type: EventType.ACTIVITY_SNAPSHOT, messageId: 'tools', activityType: 'tools', content: { running: next.running }, timestamp: now } as BaseEvent)
    }

    // committed history
    const { messages, cost, error } = messagesOf(view)
    const snap = JSON.stringify(messages)
    if (snap !== prev.snapshot) {
      this.emit({ type: EventType.MESSAGES_SNAPSHOT, messages, timestamp: now } as BaseEvent)
      this.emit({ type: EventType.CUSTOM, name: 'manul.usage', value: { cost }, timestamp: now } as BaseEvent)
      next.snapshot = snap
    }
    if (error && error !== prev.error) this.emit({ type: EventType.RUN_ERROR, message: error, timestamp: now } as BaseEvent)
    next.error = error

    if (!busy && prev.busy) this.emit({ type: EventType.RUN_FINISHED, threadId: this.threadId, runId: `run-${this.runId}`, timestamp: now } as BaseEvent)
    this.last = next
  }

  /** Full resync for a renderer that just (re)attached. */
  replay(view: Any) {
    this.last = { busy: false, text: '', tools: new Map(), running: [], snapshot: '' }
    this.update(view)
  }
}
