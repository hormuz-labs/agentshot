// The phone app's client (mobile/src/mac.ts) against the Mac's phone server (src/main/remote.ts), both for real over
// HTTP on 127.0.0.1, with a fake agent behind the server.
import type { BaseEvent } from '@ag-ui/core'
import { afterEach, describe, expect, it } from 'vitest'
import { PhoneServer, type Device } from '../src/main/remote'
import { MacClient, MacError, pair, reach, type Follow } from '../mobile/src/mac'

// fetch as a browser has it: called as some object's method, it throws
const f = function (this: unknown, url: string, init?: RequestInit) {
  if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation')
  return fetch(url, init)
} as never

function mac() {
  const devices = new Map<string, Device>()
  const sent: string[] = []
  const subs = new Set<(e: BaseEvent) => void>()
  const server = new PhoneServer({
    store: { mac: { id: 'mac1', name: 'Studio Mac' }, get: id => devices.get(id), add: d => { devices.set(d.id, d) }, seen: () => {} },
    projects: () => [{ id: 'p1', title: 'Launch film', dir: '/films/launch', openedAt: 1 }],
    open: async () => {},
    send: async (_dir, m) => { sent.push(m.text); if (m.text === 'no key') throw new Error('Add an API key first (Settings → Keys).') },
    stop: async () => {},
    subscribe: (_dir, emit) => { subs.add(emit); emit({ type: 'MESSAGES_SNAPSHOT', messages: [] } as BaseEvent); return () => subs.delete(emit) },
  }, () => ['192.0.2.1', '127.0.0.1']) // the first never answers (TEST-NET), as a stale address wouldn't
  return { server, devices, sent, subs, emit: (e: BaseEvent) => subs.forEach(s => s(e)) }
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
