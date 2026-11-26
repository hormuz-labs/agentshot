// The editor page's side of MCP Apps (io.modelcontextprotocol/ui, which Claude and ChatGPT both speak): JSON-RPC 2.0
// over postMessage with the chat that shows the page. The page calls the server's tools through the chat, asks to be
// shown bigger, and hears the tool's result and changes of theme or size. Nothing of the editor is in here.

/** The MCP Apps version this page speaks. */
export const PROTOCOL = '2026-01-26'

type Any = Record<string, any>
type Msg = { jsonrpc: '2.0'; id?: number | string; method?: string; params?: Any; result?: Any; error?: { code: number; message: string } }
export type ToolResult = { content: { type: string; text?: string }[]; structuredContent?: Any; isError?: boolean }

const isMsg = (m: unknown): m is Msg => !!m && typeof m === 'object' && (m as Msg).jsonrpc === '2.0'

export class Host {
  private next = 1
  private waiting = new Map<number | string, { ok: (v: any) => void; fail: (e: Error) => void }>()
  private handlers = new Map<string, ((params: any) => void)[]>()
  /** What the chat told the page about where it is (theme, display mode, size…), kept up to date. */
  context: Any = {}

  /** [post] sends a message to the chat (window.parent.postMessage(m, '*') in a page). */
  constructor(private post: (m: Msg) => void) {}

  /** A message from the chat (the data of a message event from window.parent). */
  receive(m: unknown) {
    if (!isMsg(m)) return
    if (m.method === undefined) {
      const w = m.id !== undefined ? this.waiting.get(m.id) : undefined
      if (!w) return
      this.waiting.delete(m.id!)
      if (m.error) w.fail(new Error(m.error.message || 'The chat refused.'))
      else w.ok(m.result)
      return
    }
    if (m.method === 'ui/notifications/host-context-changed') this.context = { ...this.context, ...m.params }
    for (const fn of this.handlers.get(m.method) || []) fn(m.params)
    if (m.id === undefined) return
    // a request from the chat: say we heard it (teardown, ping), or that we don't know it
    if (m.method === 'ui/resource-teardown' || m.method === 'ping') this.post({ jsonrpc: '2.0', id: m.id, result: {} })
    else this.post({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: `The page doesn't handle ${m.method}.` } })
  }

  on(method: string, fn: (params: any) => void) { this.handlers.set(method, [...(this.handlers.get(method) || []), fn]) }

  request<T = any>(method: string, params: Any = {}): Promise<T> {
    const id = this.next++
    return new Promise<T>((ok, fail) => {
      this.waiting.set(id, { ok, fail })
      this.post({ jsonrpc: '2.0', id, method, params })
    })
  }
  notify(method: string, params: Any = {}) { this.post({ jsonrpc: '2.0', method, params }) }

  /** The handshake: who the page is and what it can do; the chat answers with where it is. */
  async connect(appInfo: { name: string; version: string }, appCapabilities: Any) {
    const r = await this.request<{ protocolVersion: string; hostInfo: { name: string; version: string }; hostCapabilities: Any; hostContext?: Any }>('ui/initialize', { appInfo, appCapabilities, protocolVersion: PROTOCOL })
    this.context = r.hostContext || {}
    this.notify('ui/notifications/initialized')
    return r
  }

  callTool(name: string, args: Any = {}) { return this.request<ToolResult>('tools/call', { name, arguments: args }) }
}
