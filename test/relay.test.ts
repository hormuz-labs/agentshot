import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { createRelayServer } from '../relay/server'
import { signRelayTicket, verifyRelayTicket } from '../src/shared/relay-ticket'
import { DesktopRelay } from '../src/main/relay'

const secret = 's'.repeat(48)
const clean: (() => void)[] = []
afterEach(() => { for (const close of clean.splice(0).reverse()) close() })
const ticket = (role: 'worker' | 'client', worker = 'home', owner = 'user_1', expires = Date.now() + 60_000) => signRelayTicket(secret, { role, worker, owner, expires })
async function fixture() {
  const relay = createRelayServer(secret); clean.push(relay.close)
  relay.server.listen(0, '127.0.0.1'); await once(relay.server, 'listening')
  const url = `ws://127.0.0.1:${(relay.server.address() as { port: number }).port}`
  const open = (path: string, token: string) => {
    const ws = new WebSocket(url + path, { headers: { authorization: `Bearer ${token}` } })
    clean.push(() => ws.terminate()); return ws
  }
  return { relay, url, open }
}

describe('outbound relay authorization and encrypted byte routing', () => {
  it('rejects tampered, expired and malformed credentials', () => {
    const good = ticket('client')
    expect(verifyRelayTicket(secret, good)).toMatchObject({ worker: 'home', owner: 'user_1' })
    expect(verifyRelayTicket(secret, good + 'x')).toBeUndefined()
    expect(verifyRelayTicket(secret, ticket('client', 'home', 'user_1', Date.now() - 1))).toBeUndefined()
    expect(verifyRelayTicket(secret, ticket('client', '../bad'))).toBeUndefined()
    expect(verifyRelayTicket('different', good)).toBeUndefined()
  })

  it('refuses unauthenticated, wrong-role, wrong-owner and unknown-stream upgrades', async () => {
    const { open } = await fixture()
    const worker = open('/worker', ticket('worker')); await once(worker, 'message')
    for (const [path, token] of [['/client', 'bad'], ['/client', ticket('worker')], ['/client', ticket('client', 'home', 'other')], ['/stream?id=unknown', ticket('worker')]]) {
      const ws = open(path, token); ws.on('error', () => {})
      const [response] = await once(ws, 'unexpected-response')
      expect(response).toBeTruthy(); ws.terminate()
    }
  })

  it('routes large binary streams both ways without interpreting their contents', async () => {
    const { open } = await fixture()
    const worker = open('/worker', ticket('worker')); await once(worker, 'message')
    const request = once(worker, 'message')
    const phone = open('/client', ticket('client'))
    const ready = once(phone, 'message')
    const [notice] = await request
    const id = JSON.parse(notice.toString()).id
    const stream = open(`/stream?id=${id}`, ticket('worker')); await once(stream, 'open'); await ready
    const payload = Buffer.alloc(128 * 1024, 0xa5)
    const received = once(stream, 'message'); phone.send(payload)
    expect((await received)[0]).toEqual(payload)
    const reply = once(phone, 'message'); stream.send(Buffer.from('opaque TLS records'))
    expect((await reply)[0].toString()).toBe('opaque TLS records')
    phone.close(); await once(stream, 'close')
  })

  it('desktop connector uses only outbound sockets and returns loopback bytes', async () => {
    const { url, open } = await fixture()
    const tcp = createServer(socket => socket.pipe(socket)); tcp.listen(0, '127.0.0.1'); await once(tcp, 'listening'); clean.push(() => tcp.close())
    const desktop = new DesktopRelay(() => (tcp.address() as { port: number }).port); clean.push(() => desktop.stop())
    desktop.update({ url, ticket: ticket('worker'), expiresAt: Date.now() + 60_000 })
    // Wait for the outbound worker registration (the client is refused until it exists).
    await new Promise(resolve => setTimeout(resolve, 100))
    const phone = open('/client', ticket('client')); await once(phone, 'message')
    const echoed = once(phone, 'message'); phone.send(Buffer.from('end-to-end'))
    expect((await echoed)[0].toString()).toBe('end-to-end')
  })

  it('worker replacement closes its tunnels; old close cannot remove the successor', async () => {
    const { open } = await fixture()
    const first = open('/worker', ticket('worker')); await once(first, 'message')
    const closed = once(first, 'close')
    const next = open('/worker', ticket('worker')); await once(next, 'message'); await closed
    const notice = once(next, 'message')
    const phone = open('/client', ticket('client'))
    expect(JSON.parse((await notice)[0].toString()).type).toBe('open')
    phone.terminate()
  })

  it('credential renewal preserves streams; lessee changes revoke old tunnels', async () => {
    const { open } = await fixture()
    const worker = open('/worker', ticket('worker')); await once(worker, 'message')
    const notice = once(worker, 'message')
    const phone = open('/client', ticket('client')); const ready = once(phone, 'message')
    const id = JSON.parse((await notice)[0].toString()).id
    const stream = open(`/stream?id=${id}`, ticket('worker')); await once(stream, 'open'); await ready
    const renewed = once(worker, 'message')
    worker.send(JSON.stringify({ type: 'renew', ticket: ticket('worker') }))
    expect(JSON.parse((await renewed)[0].toString()).type).toBe('renewed')
    const bytes = once(stream, 'message'); phone.send(Buffer.from('still streaming'))
    expect((await bytes)[0].toString()).toBe('still streaming')
    const revoked = once(phone, 'close')
    worker.send(JSON.stringify({ type: 'renew', ticket: ticket('worker', 'home', 'user_2') }))
    await revoked
    const old = open('/client', ticket('client')); old.on('error', () => {})
    await once(old, 'unexpected-response'); old.terminate()
  })

  it('refuses text application frames, duplicate stream attachment and oversized frames', async () => {
    const { open } = await fixture()
    const worker = open('/worker', ticket('worker')); await once(worker, 'message')
    for (const payload of ['not binary', Buffer.alloc(256 * 1024 + 1)]) {
      const notice = once(worker, 'message')
      const phone = open('/client', ticket('client')); const ready = once(phone, 'message')
      const id = JSON.parse((await notice)[0].toString()).id
      const stream = open(`/stream?id=${id}`, ticket('worker')); await once(stream, 'open'); await ready
      const duplicate = open(`/stream?id=${id}`, ticket('worker')); duplicate.on('error', () => {})
      await once(duplicate, 'unexpected-response'); duplicate.terminate()
      const closed = once(stream, 'close'); phone.send(payload); await closed
    }
  })
})
