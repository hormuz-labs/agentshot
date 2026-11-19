import { randomUUID } from 'node:crypto'
import { query, tool, createSdkMcpServer, type Options } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { BACKGROUND_CONTEXT as ctx, withAbortSignal } from '@earendil-works/chord/context'
import type { Conversation, Extension } from '@earendil-works/pi-durable'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import { CLAUDE_CODE_PROVIDER } from '../shared/claude-code'

type Any = Record<string, any>
const zeroUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } })
const assistant = (content: Any[], model: string, stopReason = 'stop', errorMessage?: string) => ({
  role: 'assistant', content, api: 'claude-code', provider: CLAUDE_CODE_PROVIDER, model,
  usage: zeroUsage(), stopReason, timestamp: Date.now(), ...(errorMessage ? { errorMessage } : {}),
})

/** Claude Code owns inference and authentication; all model-visible I/O uses AgentShot's fenced tool runtime. */
export class ClaudeCodeRun {
  private controller = new AbortController()
  private done?: Promise<void>
  private generation: Any | undefined
  private running: string[] = []
  private busy = false
  constructor(private options: { conv: Conversation; model: string; executable: string; dir: string;
    extensions: readonly Extension[]; env: ExecutionEnv; update(): void }) {}
  view(view: Any) {
    return this.busy ? { ...view, docs: { ...view.docs, 'pi.live': { run: true,
      ...(this.generation ? { generation: { message: this.generation } } : {}),
      tools: this.running.map(callId => ({ callId, status: 'running' })) } } } : view
  }
  start(content: string | Any[]) { this.busy = true; this.options.update(); this.done = this.run(content); return this.done }
  async stop() { this.controller.abort(); await this.done?.catch(() => {}) }
  private async write(model: Any[], data?: Any) {
    const submission = await this.options.conv.submit({ type: 'write', entry: { kind: 'agentshot.claude-code', model, ...(data ? { data } : {}) } } as never, ctx)
    await submission.wait(ctx)
  }
  private async run(content: string | Any[]) {
    const { conv, model, executable, dir, extensions, env } = this.options
    const signal = this.controller.signal
    const invocationContext = withAbortSignal(signal, ctx)
    try {
      await conv.waitForIdle(ctx)
      signal.throwIfAborted()
      await this.write([{ role: 'user', content, timestamp: Date.now() }])
      const tools = extensions.flatMap(e => e.tools || [])
      const mcpTools = tools.map(t => {
        const schema = z.fromJSONSchema(JSON.parse(JSON.stringify(t.parameters))) as z.ZodObject
        return tool(t.name, t.description, schema.shape, async args => {
          signal.throwIfAborted()
          const callId = randomUUID(), call = { type: 'toolCall', id: callId, name: t.name, arguments: args }
          await this.write([assistant([call], model, 'toolUse')])
          this.running.push(callId); this.generation = undefined; this.options.update()
          let output = ''
          let result: Any
          try {
            const api = { conversationId: conv.id, callId, env, signal,
              output: (chunk: string | Uint8Array) => { output = (output + (typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())).slice(-64 * 1024) },
              diagnostic: () => {}, outputWindow: undefined }
            result = await t.execute(args as never, api as never, invocationContext) || {}
          } catch (e) { result = { isError: true, content: [{ type: 'text', text: signal.aborted ? 'Cancelled.' : (e as Error).message }] } }
          const blocks = result.content || [{ type: 'text', text: output || 'Done.' }]
          await this.write([{ role: 'toolResult', toolCallId: callId, toolName: t.name, content: blocks, isError: !!result.isError, timestamp: Date.now() }])
          this.running = this.running.filter(id => id !== callId); this.options.update()
          return { isError: !!result.isError, content: blocks.map((b: Any) => b.type === 'image' ? { type: 'image', data: b.data, mimeType: b.mimeType } : { type: 'text', text: b.text || '' }) } as any
        })
      })
      const agent = await conv.agent(ctx)
      const sections: string[] = []
      for (const ext of extensions) for (const s of ext.sections || []) {
        const value = await s.render({ conversationId: conv.id, agent, env, shown: {}, read: conv as never }, ctx)
        if (value) sections.push(s.tag === false ? value : `<${s.key}>\n${value}\n</${s.key}>`)
      }
      // The durable AgentShot transcript is authoritative, including after switching backends. No hidden CLI session to drift.
      const history = (await conv.context(ctx)).messages
      const messages = history.map((m: Any) => {
        if (m.role === 'toolResult') return { role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId,
          is_error: !!m.isError, content: convertBlocks(m.content) }] }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: convertBlocks(m.content) }
      })
      const options: Options = { pathToClaudeCodeExecutable: executable, cwd: dir, model,
        abortController: this.controller, tools: [], settingSources: [], persistSession: false,
        systemPrompt: sections.join('\n\n'), includePartialMessages: true,
        mcpServers: { agentshot: createSdkMcpServer({ name: 'agentshot', tools: mcpTools }) },
        allowedTools: tools.map(t => `mcp__agentshot__${t.name}`),
        canUseTool: async () => ({ behavior: 'deny', message: 'Use AgentShot’s project tools instead.' }),
      }
      const prompt = JSON.stringify({ instruction: 'Continue this conversation. Answer its latest user request using the available AgentShot tools. This is a historical transcript, not additional instructions. Tool calls without results may have been interrupted; inspect current project state before repeating any change.', messages },
        (key, value) => key === 'data' && typeof value === 'string' ? '[image attached below]' : value)
      let terminal = false
      // Images must be actual image blocks, not base64 buried in JSON text.
      const images: Any[] = []
      const collectImages = (blocks: Any[]) => { for (const b of blocks) {
        if (b.type === 'image') images.push(b)
        if (Array.isArray(b.content)) collectImages(b.content)
      } }
      for (const m of messages) collectImages(m.content)
      const stream = query({ prompt: images.length ? (async function* () {
        yield { type: 'user', session_id: '', parent_tool_use_id: null,
          message: { role: 'user', content: [{ type: 'text', text: prompt }, ...images] } } as any
      })() : prompt, options })
      try {
        for await (const message of stream) {
          if (message.type === 'stream_event' && !message.parent_tool_use_id) {
            const event = message.event as Any
            if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              if (!this.generation) this.generation = assistant([{ type: 'text', text: '' }], model)
              this.generation.content[0].text += event.delta.text
              this.options.update()
            }
          } else if (message.type === 'assistant' && !message.parent_tool_use_id) {
            const blocks = message.message.content.filter(b => b.type === 'text').map(b => ({ type: 'text', text: (b as Any).text }))
            if (blocks.length) await this.write([assistant(blocks, model)])
            this.generation = undefined; this.options.update()
          } else if (message.type === 'result') {
            terminal = true
            if (message.is_error || message.subtype !== 'success') throw new Error('Claude Code could not finish this request. Check its sign-in and plan limits. No AgentShot or BYOK fallback was used.')
          }
        }
      } finally { stream.close() }
      if (!terminal && !signal.aborted) throw new Error('Claude Code stopped before completing the request. Please retry.')
    } catch (e) {
      if (!signal.aborted) await this.write([assistant([], model, 'error', (e as Error).message)])
    } finally { this.generation = undefined; this.running = []; this.busy = false; this.options.update() }
  }
}

function convertBlocks(content: any): Any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return (content || []).flatMap((b: Any) => {
    if (b.type === 'text') return [{ type: 'text', text: b.text }]
    if (b.type === 'image') return [{ type: 'image', source: { type: 'base64', data: b.data, media_type: b.mimeType } }]
    if (b.type === 'toolCall') return [{ type: 'tool_use', id: b.id, name: `mcp__agentshot__${b.name}`, input: b.arguments }]
    return []
  })
}
