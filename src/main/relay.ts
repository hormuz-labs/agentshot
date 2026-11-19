// Reverse tunnel: every connection is outbound WSS; only our own bridge is exposed.
import { connect } from 'node:net'
import { WebSocket } from 'ws'
import { outboundAgent } from './network'

export type RelayCredentials = { url: string; ticket: string; expiresAt: number }
export class DesktopRelay {
  private credentials?: RelayCredentials
  private control?: WebSocket
  private retry?: NodeJS.Timeout
  private generation = 0
  private lastPong = 0
  private health?: NodeJS.Timeout
  private replaced = false
  private streams = new Set<() => void>()
  constructor(private port: () => number | undefined) {}
  update(credentials: RelayCredentials) {
    const url = new URL(credentials.url)
    if (url.protocol !== 'wss:' && !(process.env.NODE_ENV === 'test' && url.protocol === 'ws:')) throw new Error('Relay requires WSS')
    if (!url.host || url.username || url.password || url.search || url.hash || !credentials.ticket || credentials.expiresAt <= Date.now()) throw new Error('Invalid relay credentials')
    const previous = this.credentials
    this.credentials = credentials
    // Renew in place: never cut downloads/SSE every ten minutes.
    if (this.control && previous?.url === credentials.url) {
      if (this.control.readyState === WebSocket.OPEN) this.control.send(JSON.stringify({ type: 'renew', ticket: credentials.ticket }))
      return
    }
    if (this.replaced && previous?.url === credentials.url) return
    this.replaced = false
    this.stopConnections(); this.open()
  }
  stop() { this.credentials = undefined; this.replaced = false; this.stopConnections() }
  private stopConnections() {
    this.generation++; clearTimeout(this.retry); this.retry = undefined
    clearInterval(this.health); this.health = undefined
    this.control?.terminate(); this.control = undefined
    for (const close of [...this.streams]) close()
  }
  private open(delay = 1000) {
    const credentials = this.credentials
    if (!credentials || credentials.expiresAt <= Date.now() || !this.port()) return
    const generation = this.generation
    const url = new URL('/worker', credentials.url)
    const ws = new WebSocket(url, { agent: outboundAgent, headers: { authorization: `Bearer ${credentials.ticket}` }, handshakeTimeout: 15_000, perMessageDeflate: false, maxPayload: 4096 })
    this.control = ws
    ws.on('open', () => {
      if (generation !== this.generation) { ws.terminate(); return }
      this.lastPong = Date.now()
      this.health = setInterval(() => {
        if (Date.now() - this.lastPong > 45_000) ws.terminate()
        else if (ws.readyState === WebSocket.OPEN) ws.ping()
      }, 15_000)
      this.health.unref()
      if (this.credentials !== credentials && this.credentials) ws.send(JSON.stringify({ type: 'renew', ticket: this.credentials.ticket }))
    })
    ws.on('pong', () => { this.lastPong = Date.now() })
    ws.on('message', data => {
      if (generation !== this.generation) return
      try {
        const message = JSON.parse(data.toString())
        if (message.type === 'ready') delay = 1000
        if (message.type === 'open' && typeof message.id === 'string' && /^[a-f0-9-]{36}$/.test(message.id) && this.credentials) this.stream(this.credentials, message.id)
      } catch { ws.close(1008) }
    })
    ws.on('error', () => {})
    ws.on('close', code => {
      if (generation !== this.generation) return
      this.control = undefined
      clearInterval(this.health); this.health = undefined
      for (const close of [...this.streams]) close()
      // Replacement is intentional; never fight another instance for its identity.
      if (code === 4001) { this.replaced = true; return }
      this.retry = setTimeout(() => this.open(Math.min(delay * 2, 30_000)), delay + Math.floor(Math.random() * 500))
    })
  }
  private stream(credentials: RelayCredentials, id: string) {
    const port = this.port()
    if (!port || this.streams.size >= 64) return
    const url = new URL('/stream', credentials.url); url.searchParams.set('id', id)
    const ws = new WebSocket(url, { agent: outboundAgent, headers: { authorization: `Bearer ${credentials.ticket}` }, handshakeTimeout: 10_000, perMessageDeflate: false, maxPayload: 256 * 1024 })
    const tcp = connect({ host: '127.0.0.1', port }); tcp.pause()
    const close = () => { this.streams.delete(close); tcp.destroy(); ws.terminate() }
    this.streams.add(close)
    const timer = setTimeout(close, 15_000)
    ws.on('open', () => { clearTimeout(timer); tcp.resume() })
    ws.on('message', (data, binary) => {
      if (!binary || tcp.writableLength > 1024 * 1024) { close(); return }
      if (!tcp.write(data as Buffer)) {
        ws.pause()
        tcp.once('drain', () => ws.resume())
      }
    })
    tcp.on('data', data => {
      if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 1024 * 1024) { close(); return }
      tcp.pause(); ws.send(data, { binary: true }, error => { if (error) close(); else tcp.resume() })
    })
    for (const event of ['error', 'close'] as const) { tcp.on(event, close); ws.on(event, close) }
    ws.on('close', () => clearTimeout(timer))
  }
}
