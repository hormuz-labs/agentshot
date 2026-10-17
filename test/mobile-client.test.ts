// The phone app's client (mobile/src/mac.ts) against the Mac's phone server (src/main/remote.ts), both for real over
// HTTP on 127.0.0.1, with a fake agent behind the server.
import type { BaseEvent } from '@ag-ui/core'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneServer, type Device } from '../src/main/remote'
import { MacClient, MacError, pair, reach, type Follow, type Source } from '../mobile/src/mac'

// fetch as a browser has it: called as some object's method, it throws
const f = function (this: unknown, url: string, init?: RequestInit) {
  if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
  return fetch(url, init)
} as never

function mac() {
  const devices = new Map<string, Device>()
  const sent: string[] = []
  const attached: string[][] = []
  const added: { name: string; bytes: Buffer }[] = []
  const subs = new Set<(e: BaseEvent) => void>()
  const server = new PhoneServer({
    store: { mac: { id: 'mac1', name: 'Studio Mac' }, get: id => devices.get(id), add: d => { devices.set(d.id, d) }, seen: () => {} },
    projects: () => [{ id: 'p1', title: 'Launch film', dir: '/films/launch', openedAt: 1 }],
    open: async () => {},
    send: async (_dir, m) => {
      sent.push(m.text)
      if (m.files) attached.push(m.files)
      if (m.text === 'no key') throw new Error('Add an API key first (Settings → Keys).')
    },
    stop: async () => {},
    subscribe: (_dir, emit) => { subs.add(emit); emit({ type: 'MESSAGES_SNAPSHOT', messages: [] } as BaseEvent); return () => subs.delete(emit) },
    uploads: mkdtempSync(join(tmpdir(), 'manul-uploads-')),
    addFile: async (_dir, abs) => { const name = abs.split('/').pop()!; added.push({ name, bytes: readFileSync(abs) }); return [`media/${name}`] },
  }, () => ['192.0.2.1', '127.0.0.1']) // the first never answers (TEST-NET), as a stale address wouldn't
  return { server, devices, sent, attached, added, subs, emit: (e: BaseEvent) => subs.forEach(s => s(e)) }
}

let running: PhoneServer | null = null
afterEach(async () => { await running?.stop(); running = null })

describe('the phone app’s client', () => {
  it('finds the Mac at whichever address answers, pairs, lists projects and sends', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const paired = await pair(m.server.pairingCode(), 'Ana’s iPhone', f)
    expect(paired).toMatchObject({ id: 'mac1', name: 'Studio Mac', hosts: ['127.0.0.1', '192.0.2.1'] })
    expect(m.devices.get(paired.device)?.name).toBe('Ana’s iPhone')

    const c = new MacClient(paired, f)
    expect(await c.projects()).toEqual([{ id: 'p1', title: 'Launch film', openedAt: 1 }])
    await c.send('p1', 'cut the intro')
    expect(m.sent).toEqual(['cut the intro'])
    await expect(c.send('p1', 'no key')).rejects.toThrow('Add an API key first (Settings → Keys).')
  })

  it('says plainly when a code is spent or the Mac is out of reach', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const code = m.server.pairingCode()
    await pair(code, 'a', f)
    await expect(pair(code, 'b', f)).rejects.toThrow(/expired or was already used/)
    await expect(reach(['192.0.2.1'], 1, 'Studio Mac', f, 300)).rejects.toThrow(/Can't reach Studio Mac/)
  })

  it('follows the conversation, reconnects with a replay after a drop, and stops when unpaired', async () => {
    const m = mac()
    running = m.server
    const port = await m.server.start(0, '127.0.0.1')
    const paired = await pair(m.server.pairingCode(), 'phone', f)
    const c = new MacClient(paired, f)
    const log: string[] = []
    const on: Follow = { open: () => log.push('open'), event: e => log.push(e.type), status: s => log.push(`status:${s}`) }
    const close = c.follow('p1', on)
    await expect.poll(() => log.includes('MESSAGES_SNAPSHOT')).toBe(true)
    m.emit({ type: 'RUN_STARTED' } as BaseEvent)
    await expect.poll(() => log.includes('RUN_STARTED')).toBe(true)

    // the Mac goes away and comes back on the same port: the phone reconnects and gets the conversation again
    await m.server.stop()
    await expect.poll(() => log.includes('status:offline')).toBe(true)
    await m.server.start(port, '127.0.0.1')
    await expect.poll(() => log.filter(x => x === 'open').length, { timeout: 10_000 }).toBe(2)
    await expect.poll(() => log.filter(x => x === 'MESSAGES_SNAPSHOT').length).toBe(2)

    // removed on the Mac: the phone hears it is unpaired and stops trying
    m.devices.delete(paired.device)
    m.server.drop(paired.device)
    await expect.poll(() => log.at(-1), { timeout: 10_000 }).toBe('status:unpaired')
    close()
    await expect(c.projects()).rejects.toBeInstanceOf(MacError)
  })
})

/** Footage in memory, read a piece at a time as the app reads a file. */
function clip(size: number, name = 'IMG_0042.MOV'): Source & { bytes: Uint8Array; reads: number[] } {
  const bytes = Uint8Array.from({ length: size }, (_, i) => (i * 31 + 7) & 255)
  const reads: number[] = []
  return { name, size, bytes, reads, read: async (o, n) => { reads.push(o); return bytes.slice(o, o + n) } }
}

/** fetch with a hand on the wire: `hook` sees each piece of an upload and can drop it or change it. */
function wire(hook: (piece: { offset: number; n: number; body: Uint8Array }) => 'drop-before' | 'drop-after' | Uint8Array | void) {
  let n = 0
  return function (url: string, init?: RequestInit) {
    const m = /\/v1\/uploads\/[^/]+\/(\d+)$/.exec(url)
    if (!m) return fetch(url, init)
    const what = hook({ offset: Number(m[1]), n: n++, body: init!.body as Uint8Array })
    if (what === 'drop-before') return Promise.reject(new TypeError('Network request failed'))
    const res = fetch(url, what instanceof Uint8Array ? { ...init, body: what } : init)
    // the Mac got the piece, but its answer never reaches the phone
    return what === 'drop-after' ? res.then(r => r.text()).then(() => { throw new TypeError('Network request failed') }) : res
  } as never
}

describe('sending footage from the phone', () => {
  it('sends a file in pieces into the project, and attaches it to a message', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const c = new MacClient(await pair(m.server.pairingCode(), 'phone', f), f)
    const src = clip(5000)
    const progress: number[] = []
    const started: string[] = []
    const done = await c.upload('p1', src, { chunk: 1024, onProgress: r => progress.push(r), onStart: id => started.push(id) })
    expect(done).toMatchObject({ name: 'IMG_0042.MOV', size: 5000, received: 5000, files: ['media/IMG_0042.MOV'], upload: started[0] })
    expect(progress).toEqual([0, 1024, 2048, 3072, 4096, 5000])
    expect(m.added).toHaveLength(1)
    expect(Buffer.compare(m.added[0].bytes, Buffer.from(src.bytes))).toBe(0)

    await c.send('p1', 'Use this as the opener', done.files)
    expect(m.attached).toEqual([['media/IMG_0042.MOV']])
  })

  it('carries on after drops from where the Mac got to, without sending twice what it has', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const paired = await pair(m.server.pairingCode(), 'phone', f)
    const sentAt: number[] = []
    // the 2nd piece never gets there; the 4th gets there but its answer is lost; so is the answer to the last one
    const c = new MacClient(paired, wire(p => {
      if (p.n === 1) return 'drop-before'
      sentAt.push(p.offset)
      if (p.n === 3 || p.offset === 4096) return 'drop-after'
    }))
    const src = clip(5000)
    const done = await c.upload('p1', src, { chunk: 1024, wait: 10 })
    expect(done.files).toEqual(['media/IMG_0042.MOV'])
    expect(sentAt).toEqual([0, 1024, 2048, 3072, 4096])
    expect(m.added).toHaveLength(1)
    expect(Buffer.compare(m.added[0].bytes, Buffer.from(src.bytes))).toBe(0)
  })

  it('carries on with an upload started before the app was closed, and with the Mac restarting', async () => {
    const m = mac()
    running = m.server
    const port = await m.server.start(0, '127.0.0.1')
    const c = new MacClient(await pair(m.server.pairingCode(), 'phone', f), f)
    const src = clip(4000)
    const stop = new AbortController()
    let id = ''
    await expect(c.upload('p1', src, { chunk: 1000, signal: stop.signal, onStart: u => { id = u }, onProgress: r => { if (r >= 2000) stop.abort() } })).rejects.toThrow()
    expect((await c.uploadState(id)).received).toBe(2000)

    await m.server.stop()
    await m.server.start(port, '127.0.0.1')
    src.reads.length = 0
    const done = await c.upload('p1', src, { chunk: 1000, upload: id })
    expect(done.upload).toBe(id)
    expect(src.reads).toEqual([2000, 3000])
    expect(Buffer.compare(m.added[0].bytes, Buffer.from(src.bytes))).toBe(0)

    // one the Mac no longer has starts over
    const again = await c.upload('p1', clip(10, 'b.mov'), { upload: 'gone-gone-gone' })
    expect(again.upload).not.toBe('gone-gone-gone')
    expect(again.files).toEqual(['media/b.mov'])
  })

  it('stops at a piece changed on the way, and the Mac keeps none of it', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const paired = await pair(m.server.pairingCode(), 'phone', f)
    let id = ''
    const c = new MacClient(paired, wire(p => {
      if (p.offset !== 1000) return
      const bent = p.body.slice()
      bent[bent.length - 20] ^= 0xff
      return bent
    }))
    const err = await c.upload('p1', clip(3000), { chunk: 1000, wait: 10, onStart: u => { id = u } }).catch(e => e)
    expect(err).toBeInstanceOf(MacError)
    expect(err.status).toBe(401)
    expect((await new MacClient(paired, f).uploadState(id)).received).toBe(1000)
    expect(m.added).toEqual([])
  })

  it('gives up when the Mac stays away', async () => {
    const m = mac()
    running = m.server
    await m.server.start(0, '127.0.0.1')
    const c = new MacClient(await pair(m.server.pairingCode(), 'phone', f), wire(() => 'drop-before'))
    await expect(c.upload('p1', clip(3000), { chunk: 1000, wait: 1, retries: 3 })).rejects.toThrow(/Can't reach Studio Mac/)
  })
})
