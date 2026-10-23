// Account-scoped rendezvous and byte relay. Application TLS terminates on the desktop.
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { WebSocketServer, WebSocket, createWebSocketStream } from 'ws'

type Identity = { sub: string }
type Desktop = { user: string; id: string; name: string; fingerprint: string; socket: WebSocket }
type Tunnel = { desktop: Desktop; phone: WebSocket; timer: ReturnType<typeof setTimeout> }
export async function clerkIdentity(issuer: string, token: string): Promise<Identity> {
  if (!token || token.length > 8192) throw new Error('Sign in to Manul')
  const response = await fetch(`${issuer}/oauth/userinfo`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000), redirect: 'error' })
  if (!response.ok) throw new Error('Sign in to Manul')
  const body = await response.json() as Identity
  if (typeof body.sub !== 'string' || !body.sub) throw new Error('Invalid account')
  return { sub: body.sub }
}

export function createRelay(identity: (token: string) => Promise<Identity>) {
  const desktops = new Map<string, Desktop>()
  const tunnels = new Map<string, Tunnel>()
  const sessions = new Set<WebSocket>()
  const owners = new Map<WebSocket, string>()
  const attempts = new Map<string, { count: number; until: number }>()
  let authenticating = 0
  async function authenticate(token: string, ip: string) {
    if (authenticating >= 64) throw new Error('Busy')
    const now = Date.now(), entry = attempts.get(ip)
    if (entry && entry.until > now && entry.count >= 120) throw new Error('Rate limited')
    if (attempts.size > 10000) {
      for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key)
      if (attempts.size > 10000) throw new Error('Busy')
    }
    attempts.set(ip, { count: entry && entry.until > now ? entry.count + 1 : 1, until: entry && entry.until > now ? entry.until : now + 60_000 })
    authenticating++
    try { return await identity(token) } finally { authenticating-- }
  }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, perMessageDeflate: false })
  const bearer = (header?: string) => /^Bearer ([^\s]+)$/.exec(header || '')?.[1] || ''
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.url === '/healthz') { res.end('ok'); return }
    try {
      if (req.headers.origin || req.method !== 'GET' || req.url !== '/v1/desktops') { res.writeHead(404).end(); return }
      const user = await authenticate(bearer(req.headers.authorization), req.socket.remoteAddress || '')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify([...desktops.values()].filter(d => d.user === user.sub).map(({ id, name, fingerprint }) => ({ id, name, fingerprint }))))
    } catch { res.writeHead(401).end() }
  })
  server.headersTimeout = 15_000
  server.requestTimeout = 15_000
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy())
    void (async () => {
      const url = new URL(req.url || '/', 'http://relay')
      if (req.headers.origin || !['/v1/register', '/v1/tunnel', '/v1/accept'].includes(url.pathname)) throw new Error('Invalid route')
      const token = bearer(req.headers.authorization)
      const user = await authenticate(token, req.socket.remoteAddress || '')
      if (sessions.size >= 2000) throw new Error('Relay busy')
      if ([...owners.values()].filter(owner => owner === user.sub).length >= 64) throw new Error('Too many connections')
      let desktop: Desktop | undefined
      let pending: Tunnel | undefined
      if (url.pathname === '/v1/tunnel') {
        desktop = desktops.get(url.searchParams.get('desktop') || '')
        if (!desktop || desktop.user !== user.sub) throw new Error('Desktop offline')
        if ([...tunnels.values()].filter(t => t.desktop === desktop).length >= 16) throw new Error('Too many tunnels')
      } else if (url.pathname === '/v1/accept') {
        pending = tunnels.get(url.searchParams.get('id') || '')
        if (!pending || pending.desktop.user !== user.sub) throw new Error('Unknown tunnel')
        tunnels.delete(url.searchParams.get('id')!)
        clearTimeout(pending.timer)
      } else if ([...desktops.values()].filter(d => d.user === user.sub).length >= 10) throw new Error('Too many computers')
      wss.handleUpgrade(req, socket, head, ws => {
        sessions.add(ws)
        owners.set(ws, user.sub)
        ws.on('error', () => ws.terminate())
        let alive = true, checking = false
        ws.on('pong', () => { alive = true })
        const heartbeat = setInterval(() => {
          if (!alive) { ws.terminate(); return }
          alive = false; ws.ping()
          if (!checking) {
            checking = true
            void identity(token).then(who => { if (who.sub !== user.sub) ws.close(4001, 'Sign in again') }, () => ws.close(4001, 'Sign in again')).finally(() => { checking = false })
          }
        }, 60_000)
        ws.once('close', () => { clearInterval(heartbeat); sessions.delete(ws); owners.delete(ws) })
        if (pending) {
          const a = createWebSocketStream(pending.phone), b = createWebSocketStream(ws)
          const close = () => { a.destroy(); b.destroy(); pending!.phone.terminate(); ws.terminate() }
          a.on('error', close); b.on('error', close); a.on('close', close); b.on('close', close)
          a.pipe(b).pipe(a)
          pending.phone.resume()
          return
        }
        if (desktop) {
          ws.pause() // TLS bytes wait for the desktop; bounded by TCP backpressure.
          const id = randomBytes(32).toString('hex')
          const timer = setTimeout(() => { tunnels.delete(id); ws.close(4004, 'Desktop unavailable') }, 15_000)
          tunnels.set(id, { desktop, phone: ws, timer })
          ws.once('close', () => { clearTimeout(timer); tunnels.delete(id) })
          desktop.socket.send(JSON.stringify({ type: 'tunnel', id }))
          return
        }
        let registered: Desktop | undefined
        const deadline = setTimeout(() => ws.close(4000, 'Registration required'), 10_000)
        ws.on('message', (data, binary) => {
          try {
            if (registered || binary || data.toString().length > 1024) throw new Error()
            const body = JSON.parse(data.toString())
            if (!/^[a-f0-9]{64}$/.test(body.fingerprint) || !/^[a-f0-9]{32}$/.test(body.id) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80) throw new Error()
            // An ID collision must never evict a different account's desktop.
            const key = `${user.sub}:${body.id}`
            const old = desktops.get(key)
            old?.socket.close(4000, 'Reconnected')
            registered = { user: user.sub, id: key, name: body.name, fingerprint: body.fingerprint, socket: ws }
            desktops.set(key, registered); clearTimeout(deadline)
            ws.send(JSON.stringify({ type: 'ready', id: key }))
          } catch { ws.close(4000, 'Invalid registration') }
        })
        ws.once('close', () => {
          clearTimeout(deadline)
          if (registered && desktops.get(registered.id) === registered) desktops.delete(registered.id)
          for (const [id, t] of tunnels) if (t.desktop === registered) { clearTimeout(t.timer); t.phone.terminate(); tunnels.delete(id) }
        })
      })
    })().catch(() => { if (!socket.destroyed) socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n') })
  })
  return { server, close: async () => {
    for (const t of tunnels.values()) clearTimeout(t.timer)
    for (const ws of sessions) ws.terminate()
    wss.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}
