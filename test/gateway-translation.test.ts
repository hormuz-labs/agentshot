// Bifrost's translation, end to end: pi-ai asks Bifrost's OpenAI Responses route for a routed model name, as the app does
// with "manul" (gateway.ts), and fake Gemini, Claude and GPT servers answer. A two-step tool call must come back
// to each vendor with its own state (Gemini's thought signature, Claude's thinking signature, GPT's encrypted reasoning),
// with images in tool results (frames, contact sheets) reaching it too.
// Needs Bifrost running with gateway/config.probe.json (see gateway/README.md); skipped otherwise.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { createModels, createProvider } from '@earendil-works/pi-ai/models'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { manulProvider } from '../src/main/gateway'

const GATEWAY = process.env.BIFROST_PROBE || ''
const KEY = 'sk-bf-dev-change-me'
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const bodies: any[] = []
type Fake = (body: any, url: string, second: boolean, res: ServerResponse) => void
const serve = (fake: Fake) => createServer((req: IncomingMessage, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => { const body = JSON.parse(b || '{}'); bodies.push(body); fake(body, req.url!, bodies.length > 1, res) })
})
const sse = (res: ServerResponse, events: any[], named = true) => {
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  res.end(events.map(e => `${named ? `event: ${e.type}\n` : ''}data: ${JSON.stringify(e)}\n\n`).join(''))
}

const gemini = serve((_b, _u, second, res) => sse(res, [{
  candidates: [second
    ? { content: { role: 'model', parts: [{ text: 'It is noon.' }] }, finishReason: 'STOP' }
    : { content: { role: 'model', parts: [{ thought: true, text: 'thinking' }, { functionCall: { name: 'get_time', args: { zone: 'UTC' } }, thoughtSignature: 'R0VNSU5JU0lH' }] }, finishReason: 'STOP' }],
  usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
}], false))

const claude = serve((_b, _u, second, res) => {
  const blocks: any[] = second ? [{ type: 'text', text: 'It is noon.' }] : [{ type: 'thinking', thinking: 'hmm', signature: 'Q0xBVURFU0lH' }, { type: 'tool_use', id: 'toolu_1', name: 'get_time', input: { zone: 'UTC' } }]
  const ev: any[] = [{ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', model: 'x', content: [], stop_reason: null, usage: { input_tokens: 5, output_tokens: 1 } } }]
  blocks.forEach((bl, index) => {
    if (bl.type === 'thinking') ev.push({ type: 'content_block_start', index, content_block: { type: 'thinking', thinking: '', signature: '' } }, { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking: bl.thinking } }, { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature: bl.signature } })
    if (bl.type === 'tool_use') ev.push({ type: 'content_block_start', index, content_block: { ...bl, input: {} } }, { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(bl.input) } })
    if (bl.type === 'text') ev.push({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index, delta: { type: 'text_delta', text: bl.text } })
    ev.push({ type: 'content_block_stop', index })
  })
  sse(res, [...ev, { type: 'message_delta', delta: { stop_reason: second ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 5 } }, { type: 'message_stop' }])
})

const gpt = serve((_b, _u, second, res) => {
  const items: any[] = second
    ? [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'It is noon.', annotations: [] }] }]
    : [{ type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'R1BUU0lH' }, { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'get_time', arguments: '{"zone":"UTC"}', status: 'completed' }]
  const resp = { id: 'resp_1', object: 'response', status: 'completed', model: 'x', output: items, usage: { input_tokens: 5, output_tokens: 5, total_tokens: 10 } }
  const ev: any[] = [{ type: 'response.created', response: { ...resp, status: 'in_progress', output: [] } }]
  items.forEach((it, output_index) => {
    ev.push({ type: 'response.output_item.added', output_index, item: it.type === 'function_call' ? { ...it, arguments: '' } : it.type === 'message' ? { ...it, content: [] } : it })
    if (it.type === 'function_call') ev.push({ type: 'response.function_call_arguments.delta', output_index, item_id: it.id, delta: it.arguments }, { type: 'response.function_call_arguments.done', output_index, item_id: it.id, arguments: it.arguments })
    if (it.type === 'message') ev.push({ type: 'response.content_part.added', output_index, item_id: it.id, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }, { type: 'response.output_text.delta', output_index, item_id: it.id, content_index: 0, delta: 'It is noon.' }, { type: 'response.output_text.done', output_index, item_id: it.id, content_index: 0, text: 'It is noon.' }, { type: 'response.content_part.done', output_index, item_id: it.id, content_index: 0, part: it.content[0] })
    ev.push({ type: 'response.output_item.done', output_index, item: it })
  })
  sse(res, [...ev, { type: 'response.completed', response: resp }])
})

describe.skipIf(!GATEWAY)("Bifrost's translation through the OpenAI Responses route", () => {
  beforeAll(async () => {
    for (const [s, port] of [[gemini, 9911], [claude, 9912], [gpt, 9913]] as const) await new Promise<void>(r => s.listen(port, '0.0.0.0', () => r()))
  })
  afterAll(() => { gemini.close(); claude.close(); gpt.close() })

  // each name is a routing rule in gateway/config.probe.json, as "manul" is in config.json
  it.each([['probe-gemini', 'R0VNSU5JU0lH'], ['probe-claude', 'Q0xBVURFU0lH'], ['probe-gpt', 'R1BUU0lH']])('%s: a tool call round trip keeps the vendor state and the image', async (name, state) => {
    bodies.length = 0
    const models = createModels({ authContext: { env: async (n: string) => (n === 'MANUL_KEY' ? KEY : undefined), fileExists: async () => false } })
    const base = (manulProvider(GATEWAY) as any).getModels()[0]   // the app's model, under the probe's routed name
    models.setProvider(createProvider({ id: 'manul', auth: { apiKey: { name: 'k', resolve: async () => ({ auth: { apiKey: KEY }, source: 'MANUL_KEY' }) } } as any, models: [{ ...base, id: name }] as any, api: openAIResponsesApi() }) as any)
    const model = models.getModel('manul', name)!
    const tools = [{ name: 'get_time', description: 'The time', parameters: Type.Object({ zone: Type.String() }) }]
    const messages: any[] = [{ role: 'user', content: 'what time is it', timestamp: Date.now() }]
    const first: any = await (models as any).completeSimple(model, { messages, tools }, { reasoning: 'low' })
    expect(first.stopReason).toBe('toolUse')
    const call = first.content.find((c: any) => c.type === 'toolCall')
    expect(call).toMatchObject({ name: 'get_time', arguments: { zone: 'UTC' } })
    messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: 'get_time', content: [{ type: 'text', text: '12:00' }, { type: 'image', data: PNG, mimeType: 'image/png' }], isError: false, timestamp: Date.now() })
    const second: any = await (models as any).completeSimple(model, { messages, tools }, { reasoning: 'low' })
    expect(second.stopReason).toBe('stop')
    expect(JSON.stringify(second.content)).toContain('It is noon.')
    const sent = JSON.stringify(bodies[1])
    expect(sent).toContain(state)              // the vendor gets its own state back
    expect(sent).toContain(PNG.slice(0, 40))   // and the tool result's image
  })
})
