// How the editor page talks to the chat it's shown in (Claude, ChatGPT): JSON-RPC over postMessage, as MCP Apps
// (io.modelcontextprotocol/ui) has it. src/mcp-app/host.ts is that conversation, with nothing of the page in it.
import { describe, expect, it, vi } from 'vitest'
import { Host, PROTOCOL } from '../src/mcp-app/host'

type Msg = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: any; error?: any }
/** A chat that answers the page's handshake the way Claude does, and records everything the page sends. */
function chat(context: Record<string, unknown> = { theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline', 'fullscreen'] }) {
  const sent: Msg[] = []
  const host = new Host(m => {
    sent.push(m as Msg)
    const msg = m as Msg
    if (msg.method === 'ui/initialize') queueMicrotask(() => host.receive({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: PROTOCOL, hostInfo: { name: 'Claude', version: '1' }, hostCapabilities: {}, hostContext: context } }))
  })
  return { host, sent }
}

describe('the editor page’s side of MCP Apps', () => {
  it('introduces itself, then says it is ready', async () => {
    const { host, sent } = chat()
    const ready = await host.connect({ name: 'AgentShot editor', version: '1' }, { availableDisplayModes: ['inline', 'fullscreen'] })
    expect(sent[0]).toMatchObject({ jsonrpc: '2.0', method: 'ui/initialize', params: { protocolVersion: PROTOCOL, appInfo: { name: 'AgentShot editor' }, appCapabilities: { availableDisplayModes: ['inline', 'fullscreen'] } } })
    expect(sent[1]).toEqual({ jsonrpc: '2.0', method: 'ui/notifications/initialized', params: {} })
    expect(ready.hostInfo.name).toBe('Claude')
    expect(host.context).toMatchObject({ theme: 'dark', displayMode: 'inline' })
  })

  it('calls the server’s tools through the chat and gets each answer back to the right call', async () => {
    const { host, sent } = chat()
    await host.connect({ name: 'a', version: '1' }, {})
    const one = host.callTool('editor_view', {}), two = host.callTool('edit_timeline', { edits: [] })
    const [a, b] = sent.slice(-2)
    expect(a).toMatchObject({ method: 'tools/call', params: { name: 'editor_view', arguments: {} } })
    expect(a.id).not.toBe(b.id)
    host.receive({ jsonrpc: '2.0', id: b.id, result: { content: [{ type: 'text', text: 'two' }] } })
    host.receive({ jsonrpc: '2.0', id: a.id, result: { content: [{ type: 'text', text: 'one' }] } })
    expect((await one).content[0].text).toBe('one')
    expect((await two).content[0].text).toBe('two')
  })

  it('turns a refusal into an error the page can show', async () => {
    const { host, sent } = chat()
    await host.connect({ name: 'a', version: '1' }, {})
    const asked = host.request('ui/request-display-mode', { mode: 'pip' })
    host.receive({ jsonrpc: '2.0', id: sent.at(-1)!.id, error: { code: -32000, message: 'Not here.' } })
    await expect(asked).rejects.toThrow('Not here.')
  })

  it('hands the tool’s result and context changes to the page, keeping what didn’t change', async () => {
    const { host } = chat()
    await host.connect({ name: 'a', version: '1' }, {})
    const result = vi.fn(), changed = vi.fn()
    host.on('ui/notifications/tool-result', result)
    host.on('ui/notifications/host-context-changed', changed)
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/tool-result', params: { content: [], structuredContent: { title: 'Talk' } } })
    host.receive({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { displayMode: 'fullscreen' } })
    expect(result).toHaveBeenCalledWith({ content: [], structuredContent: { title: 'Talk' } })
    expect(changed).toHaveBeenCalled()
    expect(host.context).toMatchObject({ theme: 'dark', displayMode: 'fullscreen' })
  })

  it('answers the chat’s own requests: teardown and ping, and says when it doesn’t know one', async () => {
    const { host, sent } = chat()
    await host.connect({ name: 'a', version: '1' }, {})
    const gone = vi.fn()
    host.on('ui/resource-teardown', gone)
    host.receive({ jsonrpc: '2.0', id: 'x1', method: 'ui/resource-teardown', params: {} })
    host.receive({ jsonrpc: '2.0', id: 'x2', method: 'ping' })
    host.receive({ jsonrpc: '2.0', id: 'x3', method: 'ui/something-new', params: {} })
    await Promise.resolve()
    expect(gone).toHaveBeenCalled()
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 'x1', result: {} })
    expect(sent).toContainEqual({ jsonrpc: '2.0', id: 'x2', result: {} })
    expect(sent).toContainEqual(expect.objectContaining({ id: 'x3', error: expect.objectContaining({ code: -32601 }) }))
  })

  it('ignores what isn’t JSON-RPC, and answers it never asked for', async () => {
    const { host, sent } = chat()
    await host.connect({ name: 'a', version: '1' }, {})
    const n = sent.length
    for (const junk of [null, 'hello', { foo: 1 }, { jsonrpc: '2.0', id: 999, result: {} }]) host.receive(junk)
    expect(sent.length).toBe(n)
  })
})
