// Independent outbound WSS router. TLS from phone to desktop remains opaque here.
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import { verifyRelayTicket, type RelayTicket } from '../src/shared/relay-ticket.ts'

export function createRelayServer(secret: string) {
  if (secret.length < 32) throw new Error('RELAY_SECRET must have at least 32 characters')
  const server = createServer((req, res) => {
    if (req.url === '/healthz') res.writeHead(200).end('ok')
    else res.writeHead(404).end()
  })
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false })
  type Worker = { socket: WebSocket; ticket: RelayTicket; streams: Set<string> }
  type Tunnel = { client: WebSocket; worker: Worker; peer?: WebSocket; timer: NodeJS.Timeout }
  const workers = new Map<string, Worker>()
  const tunnels = new Map<string, Tunnel>()
  const connections = new Set<WebSocket>()
  const alive = new WeakSet<WebSocket>()
  const expiry = new WeakMap<WebSocket, number>()
  const closeTunnel = (id: string) => {
    const t = tunnels.get(id)
    if (!t) return
    tunnels.delete(id); t.worker.streams.delete(id); clearTimeout(t.timer)
    t.client.close(1011, 'Tunnel closed'); t.peer?.close(1011, 'Tunnel closed')
  }
  const forward = (from: WebSocket, to: WebSocket, id: string) => {
    from.on('message', (data: RawData, binary: boolean) => {
      if (!binary || to.readyState !== WebSocket.OPEN || to.bufferedAmount > 1024 * 1024) { closeTunnel(id); return }
      from.pause()
      to.send(data, { binary: true }, error => {
        if (error) closeTunnel(id)
        else if (from.readyState === WebSocket.OPEN) from.resume()
      })
    })
    from.on('close', () => closeTunnel(id))
    from.on('error', () => closeTunnel(id))
  }
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', 'http://localhost')
    // Credentials only in headers, never URLs or proxy access logs.
    const ticket = verifyRelayTicket(secret, (req.headers.authorization || '').replace(/^Bearer /, ''))
    const reject = (status: number) => { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`) }
    if (!ticket) { reject(401); return }
    if (connections.size >= 12_288) { reject(429); return }
    if (req.headers.origin) { reject(403); return }
    const worker = workers.get(ticket.worker)
    if (url.pathname === '/worker' && ticket.role !== 'worker') { reject(403); return }
    if (url.pathname === '/client' && (ticket.role !== 'client' || !worker || worker.ticket.owner !== ticket.owner)) { reject(403); return }
    const id = url.searchParams.get('id') || ''
    const pending = tunnels.get(id)
    if (url.pathname === '/stream' && (ticket.role !== 'worker' || !pending || pending.worker !== worker || pending.peer || worker?.ticket.owner !== ticket.owner)) { reject(403); return }
    if (!['/worker', '/client', '/stream'].includes(url.pathname)) { reject(404); return }
    if (url.pathname === '/client' && (worker!.streams.size >= 64 || tunnels.size >= 4096)) { reject(429); return }
    wss.handleUpgrade(req, socket, head, ws => {
      connections.add(ws); alive.add(ws)
      // Tickets gate new tunnels. Established TLS streams survive client ticket
      // expiry, but remain bound to the live, renewed worker control connection.
      if (url.pathname === '/worker') expiry.set(ws, ticket.expires)
      ws.on('pong', () => alive.add(ws))
      ws.on('error', () => ws.terminate())
      ws.on('close', () => connections.delete(ws))
      if (url.pathname === '/worker') {
        const old = workers.get(ticket.worker)
        if (old) { for (const id of old.streams) closeTunnel(id); old.socket.close(4001, 'Replaced') }
        const current: Worker = { socket: ws, ticket, streams: new Set() }
        workers.set(ticket.worker, current)
        ws.send(JSON.stringify({ type: 'ready' }))
        ws.on('message', (data, binary) => {
          if (binary || Buffer.byteLength(data.toString()) > 4096) { ws.close(1008); return }
          try {
            const message = JSON.parse(data.toString())
            const next = message.type === 'renew' && typeof message.ticket === 'string'
              ? verifyRelayTicket(secret, message.ticket) : undefined
            if (!next || next.role !== 'worker' || next.worker !== current.ticket.worker) { ws.close(1008); return }
            if (next.owner !== current.ticket.owner) for (const id of [...current.streams]) closeTunnel(id)
            current.ticket = next; expiry.set(ws, next.expires)
            ws.send(JSON.stringify({ type: 'renewed' }))
          } catch { ws.close(1008) }
        })
        ws.on('close', () => {
          if (workers.get(ticket.worker) !== current) return
          workers.delete(ticket.worker)
          for (const id of current.streams) closeTunnel(id)
        })
      } else if (url.pathname === '/client') {
        const id = randomUUID()
        const t: Tunnel = { client: ws, worker: worker!, timer: setTimeout(() => closeTunnel(id), 15_000) }
        tunnels.set(id, t); worker!.streams.add(id)
        // No application data until the desktop attaches its outbound stream.
        ws.on('message', () => { if (!t.peer) closeTunnel(id) })
        ws.on('close', () => closeTunnel(id))
        worker!.socket.send(JSON.stringify({ type: 'open', id }))
      } else {
        // Recheck after upgrade: a control connection may have been replaced.
        if (!pending || tunnels.get(id) !== pending || pending.peer) { ws.close(1008); return }
        pending.peer = ws; clearTimeout(pending.timer)
        forward(ws, pending.client, id); forward(pending.client, ws, id)
        pending.client.send(JSON.stringify({ type: 'ready' }))
      }
    })
  })
  const timer = setInterval(() => {
    for (const ws of connections) {
      if (!alive.has(ws) || (expiry.get(ws) ?? Infinity) <= Date.now()) { ws.terminate(); continue }
      alive.delete(ws); ws.ping()
    }
  }, 15_000)
  timer.unref()
  server.on('close', () => { clearInterval(timer); for (const ws of connections) ws.terminate(); wss.close() })
  return { server, close: () => { clearInterval(timer); for (const id of [...tunnels.keys()]) closeTunnel(id); for (const ws of connections) ws.terminate(); server.close() } }
}
