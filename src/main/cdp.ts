// A CDP connection to the page a walkthrough films. In Manul's own browser it is the tab's webContents.debugger (shared
// with the bsk extension, see Browser.film); in the user's Chrome it is Chrome's own remote debugging, which the user
// turns on at chrome://inspect/#remote-debugging and approves when Chrome asks. Manul connects to it alongside their
// bsk extension, only to film the tab their bsk session drives, and only while a take is recording.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

export type Cdp = {
  send<T = Any>(method: string, params?: Record<string, unknown>): Promise<T>
  /** Every event of this page; returns the unsubscribe. */
  on(fn: (method: string, params: Any) => void): () => void
  /** Called once when the page or the connection goes away. */
  onClose(fn: (why: string) => void): void
  close(): Promise<void>
}

/** The attribute the agent's bsk session sets on the page it drives, so Manul films that tab and no other. */
export const TAKE_ATTR = 'data-manul-take'
/** The page script reports what happens on the page through this CDP binding. */
export const BINDING = '__manulTake'
export const probeExpression = (nonce: string) => `document.documentElement.setAttribute(${JSON.stringify(TAKE_ATTR)}, ${JSON.stringify(nonce)}), location.href`
export const matchExpression = `document.documentElement.getAttribute(${JSON.stringify(TAKE_ATTR)})`

/** Where Chromium browsers keep DevToolsActivePort when remote debugging is on (default profiles). */
export function devToolsPortFiles(home = homedir(), platform = process.platform): string[] {
  const roots = platform === 'darwin'
    ? ['Google/Chrome', 'Google/Chrome Beta', 'Google/Chrome Dev', 'Google/Chrome Canary', 'Chromium', 'BraveSoftware/Brave-Browser', 'Microsoft Edge', 'Arc/User Data'].map(d => join(home, 'Library/Application Support', d))
    : ['google-chrome', 'google-chrome-beta', 'google-chrome-unstable', 'chromium', 'BraveSoftware/Brave-Browser', 'microsoft-edge'].map(d => join(home, '.config', d))
  return roots.map(r => join(r, 'DevToolsActivePort'))
}

/** port and browser endpoint path from a DevToolsActivePort file ("9222\n/devtools/browser/<id>"). */
export function parsePortFile(text: string): { port: number; path: string } | null {
  const [port, path] = text.trim().split(/\r?\n/)
  return Number(port) > 0 && path?.startsWith('/devtools/browser/') ? { port: Number(port), path } : null
}

/** One step for the user, said once (the agent asks it with a single Done). */
export const CHROME_HELP = 'To film in your Chrome, turn on remote debugging once: open chrome://inspect/#remote-debugging in Chrome and switch on ' +
  '“Allow remote debugging”. Then click Allow when Chrome asks. Manul films only the walkthrough\'s tab, only while it records.'

/** A browser-level CDP WebSocket with flattened sessions. */
class Wire {
  private next = 1
  private pending = new Map<number, { ok: (v: Any) => void; no: (e: Error) => void; method: string }>()
  private listeners = new Set<(method: string, params: Any, sessionId?: string) => void>()
  private closers = new Set<(why: string) => void>()
  constructor(private ws: WebSocket) {
    ws.addEventListener('message', ev => {
      const m = JSON.parse(String(ev.data))
      if (m.id != null) {
        const p = this.pending.get(m.id); this.pending.delete(m.id)
        if (p) m.error ? p.no(new Error(`${p.method}: ${m.error.message}`)) : p.ok(m.result)
      } else if (m.method) for (const l of this.listeners) l(m.method, m.params, m.sessionId)
    })
    ws.addEventListener('close', () => {
      for (const p of this.pending.values()) p.no(new Error('Chrome closed the debugging connection.'))
      this.pending.clear()
      for (const c of this.closers) c('Chrome closed the debugging connection.')
    })
  }
  call<T = Any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    const id = this.next++
    return new Promise((ok, no) => {
      this.pending.set(id, { ok, no, method })
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(fn: (method: string, params: Any, sessionId?: string) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  onClose(fn: (why: string) => void) { this.closers.add(fn) }
  close() { try { this.ws.close() } catch { /* gone */ } }
}

function connect(url: string, timeoutMs: number): Promise<WebSocket> {
  return new Promise((ok, no) => {
    const ws = new WebSocket(url)
    // Chrome holds the socket until the user answers its "Allow remote debugging?" prompt
    const timer = setTimeout(() => { try { ws.close() } catch { /* */ } no(new Error(`Chrome did not allow the connection in time. ${CHROME_HELP}`)) }, timeoutMs)
    ws.addEventListener('open', () => { clearTimeout(timer); ok(ws) })
    ws.addEventListener('error', () => { clearTimeout(timer); no(new Error(`Could not connect to Chrome's remote debugging. ${CHROME_HELP}`)) })
  })
}

/** The tab of the user's Chrome that carries the take's mark (see probeExpression), as a CDP connection to that page. */
export async function chromeCdp(nonce: string, o: { files?: string[]; timeoutMs?: number } = {}): Promise<Cdp> {
  const found = (o.files || devToolsPortFiles()).filter(f => existsSync(f)).map(f => parsePortFile(readFileSync(f, 'utf8'))).filter(x => !!x)
  if (!found.length) throw new Error(CHROME_HELP)
  let lastError: unknown
  for (const { port, path } of found) {
    let wire: Wire | null = null
    try {
      wire = new Wire(await connect(`ws://127.0.0.1:${port}${path}`, o.timeoutMs ?? 90_000))
      const { targetInfos } = await wire.call<{ targetInfos: { targetId: string; type: string; url: string }[] }>('Target.getTargets')
      for (const t of targetInfos.filter(t => t.type === 'page' && /^https?:|^file:/.test(t.url))) {
        const { sessionId } = await wire.call<{ sessionId: string }>('Target.attachToTarget', { targetId: t.targetId, flatten: true })
        const r = await wire.call('Runtime.evaluate', { expression: matchExpression, returnByValue: true }, sessionId).catch(() => null)
        if (r?.result?.value === nonce) return pageOf(wire, sessionId)
        await wire.call('Target.detachFromTarget', { sessionId }).catch(() => {})
      }
      wire.close()
    } catch (e) { lastError = e; wire?.close() }
  }
  throw lastError instanceof Error ? lastError : new Error('Manul could not find the walkthrough\'s tab in Chrome. Keep the bsk session\'s tab open and try again.')
}

function pageOf(wire: Wire, sessionId: string): Cdp {
  const closers: ((why: string) => void)[] = []
  let closed = false
  const end = (why: string) => { if (closed) return; closed = true; for (const c of closers) c(why) }
  wire.onClose(end)
  wire.on((method, params, sid) => { if (method === 'Target.detachedFromTarget' && params.sessionId === sessionId) end('The tab was closed.') })
  return {
    send: (method, params) => wire.call(method, params, sessionId),
    on: fn => wire.on((method, params, sid) => { if (sid === sessionId) fn(method, params) }),
    onClose: fn => { closers.push(fn) },
    async close() { closed = true; await wire.call('Target.detachFromTarget', { sessionId }).catch(() => {}); wire.close() },
  }
}
