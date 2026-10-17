// The phone server over real HTTP on 127.0.0.1, with a fake agent and an in-memory device store.
import type { BaseEvent } from '@ag-ui/core'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneServer, reachableHosts, safeName, type Device, type PhoneDeps } from '../src/main/remote'
import {
  aad, b64url, CHUNK, CHUNK_OVERHEAD, DEVICE_HEADER, type Hello, newKey, routes, seal, SEAL_HEADER, sealBytes, unseal, type PairReply, type UploadState,
} from '../src/shared/remote'

function setup(over: Partial<PhoneDeps> = {}) {
  const devices = new Map<string, Device>()
  const sent: { dir: string; text: string }[] = []
  const opened: string[] = []
  const subs = new Map<string, Set<(e: BaseEvent) => void>>()
  const added: { dir: string; name: string; bytes: string; from: string }[] = []
  const deps: PhoneDeps = {
    store: { mac: { id: 'mac1', name: 'Studio Mac' }, get: id => devices.get(id), add: d => { devices.set(d.id, d) }, seen: () => {} },
    projects: () => [{ id: 'p1', title: 'Launch film', dir: '/films/launch', openedAt: 1 }],
    open: async dir => { opened.push(dir) },
    send: async (dir, m) => { sent.push({ dir, text: m.text }) },
    stop: async () => {},
    subscribe: (dir, emit) => {
      if (!subs.has(dir)) subs.set(dir, new Set())
      subs.get(dir)!.add(emit)
      emit({ type: 'MESSAGES_SNAPSHOT', messages: [] } as BaseEvent) // the replay
      return () => subs.get(dir)!.delete(emit)
    },
    uploads: mkdtempSync(join(tmpdir(), 'manul-uploads-')),
    addFile: async (dir, abs, from) => {
      const name = abs.split('/').pop()!
      added.push({ dir, name, bytes: readFileSync(abs, 'latin1'), from })
      return [`media/${name}`]
    },
    ...over,
  }
  const server = new PhoneServer(deps, () => ['127.0.0.1'])
  return { server, deps, devices, sent, opened, subs, added, emit: (dir: string, e: BaseEvent) => subs.get(dir)?.forEach(f => f(e)) }
}

let running: PhoneServer | null = null
afterEach(async () => { await running?.stop(); running = null })

async function start(s: ReturnType<typeof setup>) {
  running = s.server
  const port = await s.server.start(0, '127.0.0.1')
  return `http://127.0.0.1:${port}`
}

async function pair(base: string, s: ReturnType<typeof setup>, name = 'Ana’s iPhone') {
  const c = s.server.pairingCode()
  const res = await fetch(base + routes.pair, { method: 'POST', body: seal(c.secret, aad.pair, { name }) })
  expect(res.status).toBe(200)
  return unseal<PairReply>(c.secret, aad.paired, await res.text()).value
}

/** A sealed request as the phone makes it; returns the status and the opened reply. */
async function call(base: string, d: PairReply, method: 'GET' | 'POST', path: string, body?: unknown, sealed?: string) {
  const s = sealed ?? seal(d.key, aad.request(method, path), body ?? null)
  const nonce = s.split('.')[0]
  const res = await fetch(base + path, {
    method, headers: { [DEVICE_HEADER]: d.device, ...(method === 'GET' ? { [SEAL_HEADER]: s } : {}) }, body: method === 'POST' ? s : undefined,
  })
  const text = await res.text()
  return { status: res.status, value: text ? unseal(d.key, aad.reply(nonce), text).value : undefined }
}

/** A piece of an upload as the phone sends it: sealed bytes bound to the upload and offset. */
async function piece(base: string, d: PairReply, upload: string, offset: number, bytes: Uint8Array | string, sealed?: Uint8Array) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes
  const s = sealed ?? sealBytes(d.key, aad.chunk(upload, offset), data)
  const res = await fetch(base + routes.chunk(upload, offset), { method: 'POST', headers: { [DEVICE_HEADER]: d.device }, body: s })
  const text = await res.text()
  return { status: res.status, value: text ? unseal<UploadState & { error?: string }>(d.key, aad.reply(b64url(s.subarray(0, 24))), text).value : undefined }
}

async function startUpload(base: string, d: PairReply, name: string, size: number) {
  const r = await call(base, d, 'POST', routes.uploads('p1'), { name, size })
  expect(r.status).toBe(200)
  return (r.value as UploadState).upload
}

describe('PhoneServer', () => {
  it('pairs a phone once per code, and the phone lists projects without their folders', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    expect(d).toMatchObject({ mac: 'mac1', name: 'Studio Mac' })
    expect(s.devices.get(d.device)?.name).toBe('Ana’s iPhone')
    const r = await call(base, d, 'GET', routes.projects)
    expect(r).toEqual({ status: 200, value: [{ id: 'p1', title: 'Launch film', openedAt: 1 }] })
  })

  it('spends a code on its first phone, and on five wrong tries', async () => {
    const s = setup()
    const base = await start(s)
    const c = s.server.pairingCode()
    const ok = await fetch(base + routes.pair, { method: 'POST', body: seal(c.secret, aad.pair, { name: 'a' }) })
    expect(ok.status).toBe(200)
    const again = await fetch(base + routes.pair, { method: 'POST', body: seal(c.secret, aad.pair, { name: 'b' }) })
    expect(again.status).toBe(410)

    const c2 = s.server.pairingCode()
    for (let i = 0; i < 5; i++) {
      const bad = await fetch(base + routes.pair, { method: 'POST', body: seal(newKey(), aad.pair, { name: 'x' }) })
      expect(bad.status).toBe(401)
    }
    const late = await fetch(base + routes.pair, { method: 'POST', body: seal(c2.secret, aad.pair, { name: 'c' }) })
    expect(late.status).toBe(410)
    expect(s.devices.size).toBe(1)
  })

  it('tells strangers, wrong seals and replays nothing', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    const empty = async (r: Response) => ({ status: r.status, body: await r.text() })
    expect(await empty(await fetch(base + routes.projects))).toEqual({ status: 401, body: '' })
    expect(await empty(await fetch(base + routes.projects, { headers: { [DEVICE_HEADER]: 'nobody', [SEAL_HEADER]: 'x' } }))).toEqual({ status: 401, body: '' })
    // a seal for another path, or another device's key
    const other = seal(d.key, aad.request('GET', routes.events('p1')), null)
    expect((await call(base, d, 'GET', routes.projects, null, other)).status).toBe(401)
    expect((await call(base, d, 'GET', routes.projects, null, seal(newKey(), aad.request('GET', routes.projects), null))).status).toBe(401)
    // the same seal twice
    const once = seal(d.key, aad.request('GET', routes.projects), null)
    expect((await call(base, d, 'GET', routes.projects, null, once)).status).toBe(200)
    expect((await call(base, d, 'GET', routes.projects, null, once)).status).toBe(401)
  })

  it('sends a message to the agent, and says why when it cannot', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    expect(await call(base, d, 'POST', routes.messages('p1'), { text: 'cut the intro' })).toEqual({ status: 200, value: { ok: true } })
    expect(s.sent).toEqual([{ dir: '/films/launch', text: 'cut the intro' }])
    expect(s.opened).toEqual(['/films/launch'])
    expect(await call(base, d, 'POST', routes.messages('nope'), { text: 'hi' })).toEqual({ status: 404, value: { error: 'That project is not on this Mac any more.' } })
    expect((await call(base, d, 'POST', routes.messages('p1'), { text: '  ' })).status).toBe(400)

    s.deps.send = async () => { throw new Error('Add an API key first (Settings → Keys).') }
    expect(await call(base, d, 'POST', routes.messages('p1'), { text: 'hi' })).toEqual({ status: 500, value: { error: 'Add an API key first (Settings → Keys).' } })
  })

  it('streams the conversation sealed and in order, and lets go when the phone does', async () => {
    const changes: number[] = []
    const s = setup()
    s.deps.changed = () => changes.push(s.server.connected)
    const base = await start(s)
    const d = await pair(base, s)
    const path = routes.events('p1')
    const sealed = seal(d.key, aad.request('GET', path), null)
    const nonce = sealed.split('.')[0]
    const ctl = new AbortController()
    const res = await fetch(base + path, { headers: { [DEVICE_HEADER]: d.device, [SEAL_HEADER]: sealed }, signal: ctl.signal })
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    const reader = res.body!.getReader()
    const got: BaseEvent[] = []
    let buf = ''
    const next = async () => {
      while (!buf.includes('\n\n')) buf += new TextDecoder().decode((await reader.read()).value)
      const [frame] = buf.split('\n\n'); buf = buf.slice(frame.length + 2)
      got.push(unseal<BaseEvent>(d.key, aad.event(nonce, got.length), frame.replace(/^data: /, '')).value)
    }
    await next()
    expect(got[0].type).toBe('MESSAGES_SNAPSHOT')
    expect(s.opened).toEqual(['/films/launch'])
    expect(s.server.connected).toBe(1)
    s.emit('/films/launch', { type: 'RUN_STARTED' } as BaseEvent)
    s.emit('/films/launch', { type: 'RUN_FINISHED' } as BaseEvent)
    await next(); await next()
    expect(got.map(e => e.type)).toEqual(['MESSAGES_SNAPSHOT', 'RUN_STARTED', 'RUN_FINISHED'])

    ctl.abort()
    await expect.poll(() => s.server.connected).toBe(0)
    expect(s.subs.get('/films/launch')!.size).toBe(0)
    expect(changes).toContain(1)
  })

  it('ends a removed phone’s stream', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    const path = routes.events('p1')
    const res = await fetch(base + path, { headers: { [DEVICE_HEADER]: d.device, [SEAL_HEADER]: seal(d.key, aad.request('GET', path), null) } })
    const reader = res.body!.getReader()
    await reader.read()
    s.server.drop(d.device)
    await expect.poll(() => s.server.connected).toBe(0)
  })

  it('attaches files the phone sent to a message, and only files in media/', async () => {
    const s = setup()
    const sent: unknown[] = []
    s.deps.send = async (_dir, m) => { sent.push(m) }
    const base = await start(s)
    const d = await pair(base, s)
    expect((await call(base, d, 'POST', routes.messages('p1'), { text: '', files: ['media/a.mov', '../secret', 'media/../x', 3] })).status).toBe(200)
    expect(sent).toEqual([{ text: '', files: ['media/a.mov'] }])
  })
})

describe('uploads from the phone', () => {
  it('takes a file in sealed pieces and adds it to the project once whole', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    const r = await call(base, d, 'POST', routes.uploads('p1'), { name: '../../IMG 0042.MOV', size: 10 })
    expect(r).toMatchObject({ status: 200, value: { name: 'IMG 0042.MOV', size: 10, received: 0 } })
    const id = (r.value as UploadState).upload

    expect(await piece(base, d, id, 0, 'abcd')).toMatchObject({ status: 200, value: { received: 4 } })
    expect(s.added).toEqual([])
    expect(await call(base, d, 'GET', routes.upload(id))).toMatchObject({ status: 200, value: { received: 4, size: 10 } })
    expect(await piece(base, d, id, 4, 'efghij')).toEqual({ status: 200, value: { upload: id, name: 'IMG 0042.MOV', size: 10, received: 10, files: ['media/IMG 0042.MOV'] } })
    expect(s.added).toEqual([{ dir: '/films/launch', name: 'IMG 0042.MOV', bytes: 'abcdefghij', from: 'Ana’s iPhone' }])
    expect(s.opened).toEqual(['/films/launch'])

    // the bytes are gone from the Mac's waiting room, but it still knows where the file landed
    expect(readdirSync(s.deps.uploads)).toEqual([`${id}.json`])
    expect((await call(base, d, 'GET', routes.upload(id))).value).toMatchObject({ received: 10, files: ['media/IMG 0042.MOV'] })
    // and another piece changes nothing
    expect(await piece(base, d, id, 10, 'k')).toMatchObject({ status: 409, value: { files: ['media/IMG 0042.MOV'] } })
    expect(s.added).toHaveLength(1)
  })

  it('carries on after a drop: half a piece is not kept, and a piece anywhere else gets where the Mac is', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    const id = await startUpload(base, d, 'clip.mov', 12)
    expect((await piece(base, d, id, 0, 'abcd')).value?.received).toBe(4)

    // the Wi-Fi drops halfway through the next piece
    const sealed = sealBytes(d.key, aad.chunk(id, 4), new TextEncoder().encode('efgh'))
    await new Promise<void>(done => {
      const req = request(base + routes.chunk(id, 4), { method: 'POST', headers: { [DEVICE_HEADER]: d.device, 'content-length': sealed.length } })
      req.on('error', () => done())
      req.write(sealed.subarray(0, 20), () => setTimeout(() => { req.destroy(); done() }, 50))
    })
    expect((await call(base, d, 'GET', routes.upload(id))).value).toMatchObject({ received: 4 })

    // the phone, unsure what landed, sends a piece the Mac already has, or one ahead: it hears where the Mac is
    expect(await piece(base, d, id, 0, 'abcd')).toMatchObject({ status: 409, value: { received: 4 } })
    expect(await piece(base, d, id, 8, 'ijkl')).toMatchObject({ status: 409, value: { received: 4 } })
    expect((await piece(base, d, id, 4, 'efgh')).value?.received).toBe(8)
    expect((await piece(base, d, id, 8, 'ijkl')).value?.files).toEqual(['media/clip.mov'])
    expect(s.added.map(a => a.bytes)).toEqual(['abcdefghijkl'])
  })

  it('refuses tampered, moved, replayed and oversized pieces, and other phones’ uploads', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    const id = await startUpload(base, d, 'clip.mov', 8)
    const other = await startUpload(base, d, 'other.mov', 8)
    const bytes = new TextEncoder().encode('abcd')
    const empty = async (sealed: Uint8Array, path = routes.chunk(id, 0)) => {
      const res = await fetch(base + path, { method: 'POST', headers: { [DEVICE_HEADER]: d.device }, body: sealed })
      return { status: res.status, body: await res.text() }
    }

    // a byte changed on the way
    const tampered = sealBytes(d.key, aad.chunk(id, 0), bytes)
    tampered[40] ^= 1
    expect(await empty(tampered)).toEqual({ status: 401, body: '' })
    // a genuine piece moved to another offset or another upload, or sealed as something else
    expect(await empty(sealBytes(d.key, aad.chunk(id, 4), bytes))).toEqual({ status: 401, body: '' })
    expect(await empty(sealBytes(d.key, aad.chunk(other, 0), bytes))).toEqual({ status: 401, body: '' })
    expect(await empty(sealBytes(d.key, aad.request('POST', routes.chunk(id, 0)), bytes))).toEqual({ status: 401, body: '' })
    expect(await empty(sealBytes(newKey(), aad.chunk(id, 0), bytes))).toEqual({ status: 401, body: '' })
    expect(await empty(new Uint8Array(10))).toEqual({ status: 401, body: '' })
    expect((await call(base, d, 'GET', routes.upload(id))).value).toMatchObject({ received: 0 })

    // the same piece twice: the second is a replay
    const once = sealBytes(d.key, aad.chunk(id, 0), bytes)
    expect((await piece(base, d, id, 0, bytes, once)).value?.received).toBe(4)
    expect(await empty(once)).toEqual({ status: 401, body: '' })
    expect((await call(base, d, 'GET', routes.upload(id))).value).toMatchObject({ received: 4 })

    // more than the file holds, or more than a piece may be
    expect(await piece(base, d, id, 4, 'efghi')).toMatchObject({ status: 400 })
    expect((await empty(new Uint8Array(CHUNK + CHUNK_OVERHEAD + 1), routes.chunk(id, 4))).status).toBe(413)

    // another phone can't see, add to or cancel this one
    const e = await pair(base, s, 'Someone else')
    expect(await piece(base, e, id, 4, 'efgh')).toMatchObject({ status: 404 })
    expect((await call(base, e, 'GET', routes.upload(id))).status).toBe(404)
    expect((await call(base, e, 'POST', routes.cancel(id))).status).toBe(404)
    expect((await call(base, d, 'GET', routes.upload(id))).value).toMatchObject({ received: 4 })
    expect(s.added).toEqual([])
  })

  it('refuses empty, unknown-project and oversized uploads before any bytes', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    expect((await call(base, d, 'POST', routes.uploads('p1'), { name: 'a.mov', size: 0 })).status).toBe(400)
    expect((await call(base, d, 'POST', routes.uploads('p1'), { name: 'a.mov', size: 1.5 })).status).toBe(400)
    expect((await call(base, d, 'POST', routes.uploads('nope'), { name: 'a.mov', size: 5 })).status).toBe(404)
    expect((await call(base, d, 'POST', routes.uploads('p1'), { name: 'a.mov', size: 2 ** 40 })).status).toBe(413)
    expect(readdirSync(s.deps.uploads)).toEqual([])
  })

  it('lets go of a cancelled upload, one whose project went away, and stale ones on start', async () => {
    const s = setup()
    const uploads = s.deps.uploads
    writeFileSync(join(uploads, 'oldupload1.json'), JSON.stringify({ id: 'oldupload1', createdAt: Date.now() - 8 * 86_400_000 }))
    writeFileSync(join(uploads, 'stray'), 'x')
    const base = await start(s)
    expect(readdirSync(uploads)).toEqual([])
    const d = await pair(base, s)

    const id = await startUpload(base, d, 'clip.mov', 8)
    await piece(base, d, id, 0, 'abcd')
    expect(await call(base, d, 'POST', routes.cancel(id))).toEqual({ status: 200, value: { ok: true } })
    expect(readdirSync(uploads)).toEqual([])
    expect((await call(base, d, 'GET', routes.upload(id))).status).toBe(404)

    const id2 = await startUpload(base, d, 'clip.mov', 4)
    s.deps.projects = () => []
    expect(await piece(base, d, id2, 0, 'abcd')).toMatchObject({ status: 404, value: { error: 'That project is not on this Mac any more.' } })
    expect(existsSync(join(uploads, id2))).toBe(false)
    expect(s.added).toEqual([])
  })

  it('names files safely', () => {
    expect(safeName('../../etc/passwd')).toBe('passwd')
    expect(safeName('C:\\Users\\a\\IMG_1.MOV')).toBe('IMG_1.MOV')
    expect(safeName('.hidden')).toBe('hidden')
    expect(safeName('a\u0000b:c.mov')).toBe('abc.mov')
    expect(safeName('')).toBe('clip.mov')
    expect(safeName('x'.repeat(200) + '.mov')).toHaveLength(120)
    expect(safeName('x'.repeat(200) + '.mov').endsWith('.mov')).toBe(true)
  })
})

describe('where the phone can reach the Mac', () => {
  const iface = (address: string, internal = false) => ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null })
  it('offers the home network first, then the Bonjour name, then Tailscale', () => {
    const ifaces = { lo0: [iface('127.0.0.1', true)], en0: [iface('192.168.1.20')], utun4: [iface('100.101.102.103')], bridge0: [iface('169.254.3.4')] }
    expect(reachableHosts(ifaces as never, 'Studio')).toEqual(['192.168.1.20', 'Studio.local', '100.101.102.103'])
    expect(reachableHosts({ en0: [iface('10.0.0.5')] } as never, 'studio.local')).toEqual(['10.0.0.5', 'studio.local'])
  })

  it('tells a paired phone its name and current addresses', async () => {
    const s = setup()
    const base = await start(s)
    const d = await pair(base, s)
    expect(await call(base, d, 'GET', routes.hello)).toEqual({ status: 200, value: { mac: 'mac1', name: 'Studio Mac', hosts: ['127.0.0.1'], port: s.server.port } satisfies Hello })
    expect((await fetch(base + routes.hello)).status).toBe(401) // and a stranger nothing
  })
})
