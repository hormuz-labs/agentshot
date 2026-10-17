// The phone server over real HTTP on 127.0.0.1, with a fake agent and an in-memory device store.
import type { BaseEvent } from '@ag-ui/core'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneServer, type Device, type PhoneDeps } from '../src/main/remote'
import { aad, DEVICE_HEADER, newKey, routes, seal, SEAL_HEADER, unseal, type PairReply } from '../src/shared/remote'

function setup(over: Partial<PhoneDeps> = {}) {
  const devices = new Map<string, Device>()
  const sent: { dir: string; text: string }[] = []
  const opened: string[] = []
  const subs = new Map<string, Set<(e: BaseEvent) => void>>()
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
    ...over,
  }
  const server = new PhoneServer(deps, () => ['127.0.0.1'])
  return { server, deps, devices, sent, opened, subs, emit: (dir: string, e: BaseEvent) => subs.get(dir)?.forEach(f => f(e)) }
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
})
