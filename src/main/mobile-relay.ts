import { connect } from 'node:net'
import { WebSocket, createWebSocketStream } from 'ws'

export class DesktopRelay {
  private stopped = false
  private control?: WebSocket
  private sockets = new Set<WebSocket>()
  private timer?: ReturnType<typeof setTimeout>
  private retry = 1000
  private heartbeat?: ReturnType<typeof setInterval>
  state = 'Connecting…'
  constructor(private options: { url: string; id: string; name: string; port: number; fingerprint: string; token(): Promise<string> }) {}
  start() { void this.open() }
  private async open() {
    try {
      const token = await this.options.token()
      if (this.stopped) return
      const base = new URL(this.options.url)
      if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Relay requires HTTPS')
      base.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:'
      const ws = new WebSocket(new URL('/v1/register', base), { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 15_000, maxPayload: 4096 })
      this.control = ws
      let alive = true
      ws.on('pong', () => { alive = true })
      this.heartbeat = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return
        if (!alive) { ws.terminate(); return }
        alive = false; ws.ping()
      }, 25_000)
      ws.on('open', () => ws.send(JSON.stringify({ id: this.options.id, name: this.options.name, fingerprint: this.options.fingerprint })))
      ws.on('error', () => { this.state = 'Relay unavailable. Retrying…' })
      ws.on('message', data => {
        try {
          const message = JSON.parse(data.toString())
          if (message.type === 'ready') { this.state = 'Available from anywhere'; this.retry = 1000 }
          if (message.type === 'tunnel' && /^[a-f0-9]{64}$/.test(message.id)) void this.tunnel(base, message.id)
        } catch { ws.close() }
      })
      ws.on('close', () => { clearInterval(this.heartbeat); this.again() })
    } catch { this.again('Sign in to Manul again to connect your phone') }
  }
  private again(message = 'Reconnecting to relay…') {
    if (this.stopped) return
    this.state = message
    this.timer = setTimeout(() => { void this.open() }, this.retry)
    this.retry = Math.min(this.retry * 2, 30_000)
  }
  private async tunnel(base: URL, id: string) {
    try {
      if (this.sockets.size >= 32) return
      const token = await this.options.token()
      if (this.stopped) return
      const url = new URL('/v1/accept', base); url.searchParams.set('id', id)
      const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 15_000, maxPayload: 256 * 1024, perMessageDeflate: false })
      this.sockets.add(ws)
      const stream = createWebSocketStream(ws)
      const local = connect(this.options.port, '127.0.0.1')
      const close = () => { stream.destroy(); local.destroy(); ws.terminate(); this.sockets.delete(ws) }
      stream.on('error', close); local.on('error', close); stream.on('close', close); local.on('close', close)
      stream.pipe(local).pipe(stream)
    } catch { /* Phone retries a failed connection. */ }
  }
  stop() {
    this.stopped = true; clearTimeout(this.timer)
    clearInterval(this.heartbeat)
    this.control?.terminate()
    for (const ws of this.sockets) ws.terminate()
    this.sockets.clear()
  }
}
