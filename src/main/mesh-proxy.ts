// Local adapter for tsnet's HTTP CONNECT support. Resolves system/PAC settings
// per destination instead of guessing one proxy for both Headscale and DERP.
import { createServer } from 'node:http'
import { connect, type Socket } from 'node:net'
import { EventEmitter } from 'node:events'
import { randomBytes } from 'node:crypto'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { SocksProxyAgent } from 'socks-proxy-agent'
import { localNetworkUrl, outboundProxy } from './network'

export async function startMeshProxy(resolveSystem: (url: string) => Promise<string>, controlUrl: string) {
  const password = randomBytes(32).toString('hex')
  const expected = `Basic ${Buffer.from(`mesh:${password}`).toString('base64')}`
  const sockets = new Set<Socket>()
  const server = createServer((_req, res) => res.writeHead(405).end())
  server.maxConnections = 128
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  server.on('connect', async (req, client, head) => {
    let upstream: Socket | undefined
    const timer = setTimeout(() => { client.destroy(); upstream?.destroy() }, 15_000)
    client.on('close', () => { clearTimeout(timer); upstream?.destroy() })
    try {
      if (req.headers['proxy-authorization'] !== expected) { client.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n'); return }
      const url = new URL(`https://${req.url}`)
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || ![80, 443].includes(Number(url.port || 443))) throw new Error('Invalid mesh destination')
      const control = new URL(controlUrl)
      // Only control and the configured public Tailscale DERP map's hosts.
      if (url.hostname !== control.hostname && !(url.hostname.endsWith('.tailscale.com') && url.hostname.startsWith('derp'))) throw new Error('Unapproved mesh destination')
      if (localNetworkUrl(url.toString())) throw new Error('Private mesh destination')
      const port = Number(url.port || 443)
      if (port === 80) url.protocol = 'http:'
      const proxy = await outboundProxy(url.toString(), resolveSystem)
      if (client.destroyed) return
      if (proxy) {
        const agent = proxy.startsWith('socks') ? new SocksProxyAgent(proxy) : new HttpsProxyAgent(proxy)
        const request = new EventEmitter()
        let status = 200
        request.on('proxyConnect', result => { status = result.statusCode })
        const connecting = agent.connect(request as import('node:http').ClientRequest, {
          host: url.hostname, port, secureEndpoint: false,
          timeout: 15_000,
        })
        connecting.then(late => { if (client.destroyed) late.destroy() }, () => {})
        upstream = await connecting as Socket
        if (status !== 200) throw new Error('Proxy refused mesh connection')
        request.emit('socket', upstream)
      } else {
        upstream = await new Promise<Socket>((resolve, reject) => {
          const socket = connect({ host: url.hostname, port })
          upstream = socket
          socket.once('connect', () => resolve(socket)); socket.once('error', reject)
        })
      }
      if (client.destroyed) { upstream.destroy(); return }
      clearTimeout(timer)
      upstream.on('error', () => client.destroy())
      client.on('error', () => upstream?.destroy())
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      if (head.length) upstream.write(head)
      client.pipe(upstream).pipe(client)
    } catch {
      upstream?.destroy()
      if (!client.destroyed) client.end('HTTP/1.1 502 Bad Gateway\r\n\r\n')
    } finally {
      if (!upstream || upstream.destroyed) clearTimeout(timer)
    }
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve()) })
  const url = `http://mesh:${password}@127.0.0.1:${(server.address() as { port: number }).port}`
  return { url, stop: () => { for (const socket of sockets) socket.destroy(); server.close() } }
}
