import { afterEach, expect, it } from 'vitest'
import { once } from 'node:events'
import { request, Agent } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import { WebSocket, createWebSocketStream } from 'ws'
import { createRelay } from '../relay/server'
import { MobileBridge } from '../src/main/mobile-bridge'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0 })
const identity = async (token: string) => {
  if (!['alice', 'bob'].includes(token)) throw new Error('Invalid token')
  return { sub: token }
}

async function fixture() {
  const relay = createRelay(identity)
  await new Promise<void>(r => relay.server.listen(0, '127.0.0.1', r))
  cleanup.push(() => relay.close())
  const base = `http://127.0.0.1:${(relay.server.address() as { port: number }).port}`
  process.env.MANUL_RELAY = base
  const bridge = new MobileBridge({
    account: { current: () => ({ sub: 'alice', email: 'alice@test', id: 'a'.repeat(32) }), token: async () => 'alice', identity },
    projects: () => [], invoke: async (method, args) => ({ method, args }),
    importFile: async () => null, galleryFile: () => new Response('gallery bytes'),
  })
  cleanup.push(async () => { await bridge.stop(); delete process.env.MANUL_RELAY })
  await bridge.start()
  // Wait for an observable registration, with a bounded deadline.
  let computers: { id: string; fingerprint: string }[] = []
  const deadline = Date.now() + 5000
  while (!computers.length && Date.now() < deadline) {
    computers = await (await fetch(`${base}/v1/desktops`, { headers: { authorization: 'Bearer alice' } })).json()
    if (!computers.length) await new Promise(r => setTimeout(r, 10))
  }
  expect(computers).toHaveLength(1)
  return { base, bridge, computer: computers[0] }
}

it('discovers only the account’s computers and rejects foreign/anonymous tunnels', async () => {
  const f = await fixture()
  expect((await fetch(`${f.base}/v1/desktops`)).status).toBe(401)
  expect(await (await fetch(`${f.base}/v1/desktops`, { headers: { authorization: 'Bearer bob' } })).json()).toEqual([])
  const url = `${f.base.replace('http:', 'ws:')}/v1/tunnel?desktop=${encodeURIComponent(f.computer.id)}`
  const ws = new WebSocket(url, { headers: { authorization: 'Bearer bob' } })
  await expect(once(ws, 'open')).rejects.toThrow(/401/)
})

it('lists two computers on one account and removes only the disconnected computer', async () => {
  const f = await fixture()
  const ws = new WebSocket(`${f.base.replace('http:', 'ws:')}/v1/register`, { headers: { authorization: 'Bearer alice' } })
  cleanup.push(async () => { ws.terminate() })
  await once(ws, 'open')
  const ready = once(ws, 'message')
  ws.send(JSON.stringify({ id: 'b'.repeat(32), name: 'Second computer', fingerprint: 'f'.repeat(64) }))
  await ready
  const list = () => fetch(`${f.base}/v1/desktops`, { headers: { authorization: 'Bearer alice' } }).then(r => r.json())
  expect(await list()).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: f.computer.id }),
    expect.objectContaining({ id: `alice:${'b'.repeat(32)}`, name: 'Second computer' }),
  ]))
  const closed = once(ws, 'close'); ws.close(); await closed
  expect(await list()).toEqual([expect.objectContaining({ id: f.computer.id })])
})

it('carries real TLS, account pairing, RPC and gallery bytes through an outbound-only desktop tunnel', async () => {
  const f = await fixture()
  const call = (path: string, token: string, body?: unknown) => new Promise<{ status: number; body: string }>((resolve, reject) => {
    const ws = new WebSocket(`${f.base.replace('http:', 'ws:')}/v1/tunnel?desktop=${encodeURIComponent(f.computer.id)}`, { headers: { authorization: 'Bearer alice' } })
    const stream = createWebSocketStream(ws)
    stream.on('error', reject)
    const socket = tlsConnect({ socket: stream as any, rejectUnauthorized: false })
    socket.on('error', reject)
    socket.once('secureConnect', () => {
      expect(socket.getPeerCertificate().fingerprint256.replaceAll(':', '').toLowerCase()).toBe(f.computer.fingerprint)
      const data = body === undefined ? undefined : JSON.stringify(body)
      const agent = new Agent()
      agent.createConnection = () => socket
      const req = request({ host: 'desktop.manul.invalid', path, method: data ? 'POST' : 'GET', agent,
        headers: { authorization: `Bearer ${token}`, ...(data ? { 'content-length': Buffer.byteLength(data) } : {}) },
      }, res => {
        const parts: Buffer[] = []
        res.on('data', chunk => parts.push(chunk))
        res.on('end', () => { agent.destroy(); socket.destroy(); ws.terminate(); resolve({ status: res.statusCode!, body: Buffer.concat(parts).toString() }) })
      })
      req.on('error', reject); req.end(data)
    })
  })
  expect((await call('/account/pair', 'bob', { id: 'b'.repeat(32) })).status).toBe(403)
  const paired = await call('/account/pair', 'alice', { id: 'c'.repeat(32), name: 'Phone' })
  expect(paired.status).toBe(200)
  const token = JSON.parse(paired.body).token
  expect(JSON.parse((await call('/rpc', token, { method: 'project:recent', args: [] })).body)).toEqual({ method: 'project:recent', args: [] })
  expect((await call('/gallery?url=manul%3A%2F%2Fgallery%2Ftest', token)).body).toBe('gallery bytes')
  f.bridge.revoke('c'.repeat(32))
  expect((await call('/rpc', token, { method: 'project:recent', args: [] })).status).toBe(401)
  expect((await call('/account/pair', 'alice', { id: 'c'.repeat(32) })).status).toBe(403)
})
