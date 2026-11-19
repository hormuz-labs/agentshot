import { afterEach, expect, it, vi } from 'vitest'
import { connect } from 'node:net'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { startMeshProxy } from '../src/main/mesh-proxy'

const clean: (() => void)[] = []
afterEach(() => { for (const close of clean.splice(0).reverse()) close(); vi.unstubAllEnvs() })

async function tunnel(url: string, target: string, authenticated = true) {
  const proxy = new URL(url)
  const socket = connect(Number(proxy.port), proxy.hostname)
  clean.push(() => socket.destroy())
  await once(socket, 'connect')
  const response = once(socket, 'data')
  const authorization = authenticated ? `Proxy-Authorization: Basic ${Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64')}\r\n` : ''
  socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n${authorization}\r\n`)
  return { socket, headers: (await response)[0].toString() }
}

it('passes native control/DERP CONNECT through the per-host system proxy with credentials and opaque bytes', async () => {
  for (const key of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'NO_PROXY', 'no_proxy']) vi.stubEnv(key, '')
  const received: string[] = []
  const proxySockets = new Set<import('node:net').Socket>()
  const proxy = createServer()
  proxy.on('connection', socket => { proxySockets.add(socket); socket.on('close', () => proxySockets.delete(socket)) })
  proxy.on('connect', (req, socket, head) => {
    expect(req.headers['proxy-authorization']).toBe(`Basic ${Buffer.from('alice:password').toString('base64')}`)
    received.push(req.url!)
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) socket.write(head)
    socket.pipe(socket)
  })
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  clean.push(() => { for (const socket of proxySockets) socket.destroy(); proxy.close() })
  vi.stubEnv('HTTPS_PROXY', `http://alice:password@127.0.0.1:${(proxy.address() as { port: number }).port}`)
  const resolve = vi.fn(async () => 'DIRECT')
  const adapter = await startMeshProxy(resolve, 'https://mesh.agentshot.si')
  clean.push(adapter.stop)
  for (const target of ['mesh.agentshot.si:443', 'derp1.tailscale.com:443']) {
    const { socket, headers } = await tunnel(adapter.url, target)
    expect(headers).toContain('200 Connection Established')
    const payload = Buffer.alloc(1024 * 1024, 0xa5)
    let length = 0
    const got = new Promise<Buffer>(resolve => {
      const chunks: Buffer[] = []
      socket.on('data', data => { chunks.push(data); length += data.length; if (length === payload.length) resolve(Buffer.concat(chunks)) })
    })
    socket.write(payload)
    expect(await got).toEqual(payload)
    socket.destroy()
  }
  expect(received).toEqual(['mesh.agentshot.si:443', 'derp1.tailscale.com:443'])
})

it('refuses unauthenticated, arbitrary internet, private and non-control ports', async () => {
  const adapter = await startMeshProxy(async () => 'DIRECT', 'https://mesh.agentshot.si')
  clean.push(adapter.stop)
  expect((await tunnel(adapter.url, 'mesh.agentshot.si:443', false)).headers).toContain('407')
  for (const target of ['example.com:443', '127.0.0.1:443', 'derp1.tailscale.com:22']) {
    expect((await tunnel(adapter.url, target)).headers).toContain('502')
  }
})
