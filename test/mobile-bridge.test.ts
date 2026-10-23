import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:https'
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { MobileBridge } from '../src/main/mobile-bridge'
import { mobileArgs } from '../src/main/mobile-contract'

const bridges: MobileBridge[] = []
const folders: string[] = []
afterEach(async () => { await Promise.all(bridges.splice(0).map(b => b.stop())); await Promise.all(folders.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'manul-bridge-test-')); folders.push(dir)
  await writeFile(join(dir, 'film.mp4'), '0123456789')
  const invoke = vi.fn(async (method: string, args: unknown[]) => ({ method, args }))
  const importFile = vi.fn(async (file: string) => ({ name: file.split('/').pop(), content: await readFile(file, 'utf8') }))
  const bridge = new MobileBridge({ invoke, projects: () => [{ dir }], importFile, galleryFile: () => new Response('gallery') }); bridges.push(bridge)
  const status = await bridge.start()
  const base = status.addresses[0] || ''
  expect(base).toMatch(/^https:/)
  const port = new URL(base).port
  const call = (path: string, options: { body?: unknown; raw?: string; token?: string; headers?: Record<string, string>; method?: string } = {}) => new Promise<{ status: number; body: string; headers: import('node:http').IncomingHttpHeaders }>((ok, fail) => {
    const data = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    const req = request(`https://127.0.0.1:${port}${path}`, { rejectUnauthorized: false, method: options.method || (data === undefined ? 'GET' : 'POST'), headers: { ...(data === undefined ? {} : { 'content-length': String(Buffer.byteLength(data)) }), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}), ...options.headers } }, res => {
      const chunks: Buffer[] = []; res.on('data', part => chunks.push(part)); res.on('end', () => ok({ status: res.statusCode!, body: Buffer.concat(chunks).toString(), headers: res.headers })); res.on('error', fail)
    }); req.on('error', fail); req.end(data)
  })
  const pair = await call('/pair', { body: { code: status.code, name: 'Test phone' } })
  expect(pair.status).toBe(200)
  const token = JSON.parse(pair.body).token as string
  return { dir, bridge, status, call, token, invoke, importFile, port }
}

describe('mobile TLS bridge', () => {
  it('requires a one-use pairing code and authenticates every route', async () => {
    const f = await fixture()
    expect(f.status.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect((await f.call('/pair', { body: { code: f.status.code } })).status).toBe(401)
    expect((await f.call('/rpc', { body: { method: 'project:recent', args: [] } })).status).toBe(401)
    expect((await f.call('/media?project=x&file=x')).status).toBe(401)
    expect((await f.call('/events')).status).toBe(401)
    expect((await f.call('/rpc', { token: f.token, body: { method: 'project:recent', args: [] } })).status).toBe(200)
    expect((await f.call('/rpc', { token: f.token, headers: { origin: 'https://evil.test' }, body: { method: 'project:recent', args: [] } })).status).toBe(403)
    f.bridge.revoke(f.bridge.status().devices[0].id)
    expect((await f.call('/rpc', { token: f.token, body: { method: 'project:recent', args: [] } })).status).toBe(401)
  })
  it('denies unknown projects, arbitrary IPC, traversal and symlink escapes', async () => {
    const f = await fixture()
    expect((await f.call('/rpc', { token: f.token, body: { method: 'project:open', args: ['/etc'] } })).status).toBe(403)
    expect((await f.call('/rpc', { token: f.token, body: { method: 'project:import', args: [f.dir, '/etc/passwd'] } })).status).toBe(400)
    expect((await f.call('/rpc', { token: f.token, body: { method: 'transcript:get', args: [f.dir, '../../etc/passwd', true] } })).status).toBe(400)
    await symlink('/etc/passwd', join(f.dir, 'escape.txt'))
    for (const file of ['../secret', 'escape.txt', '.hidden']) {
      expect((await f.call(`/media?${new URLSearchParams({ project: f.dir, file })}`, { token: f.token })).status).toBe(400)
    }
    expect(f.invoke).not.toHaveBeenCalled()
  })
  it('streams media with ranges and uploads bytes through the import adapter', async () => {
    const f = await fixture(); const path = `/media?${new URLSearchParams({ project: f.dir, file: 'film.mp4' })}`
    const range = await f.call(path, { token: f.token, headers: { range: 'bytes=2-5' } })
    expect(range.status).toBe(206); expect(range.body).toBe('2345'); expect(range.headers['content-range']).toBe('bytes 2-5/10')
    expect((await f.call(path, { token: f.token, headers: { range: 'bytes=-3' } })).body).toBe('789')
    expect((await f.call(path, { token: f.token, headers: { range: 'bytes=20-' } })).status).toBe(416)
    const upload = await f.call(`/upload?${new URLSearchParams({ project: f.dir, name: 'phone.mp4' })}`, { token: f.token, raw: 'real footage bytes' })
    expect(upload.status).toBe(200); expect(JSON.parse(upload.body)).toEqual({ name: 'phone.mp4', content: 'real footage bytes' })
    const file = f.importFile.mock.calls[0][0]
    await expect(readFile(file)).rejects.toThrow()
  })
  it('replays complete agent state when a phone reconnects', async () => {
    const f = await fixture()
    f.bridge.publish('agui', f.dir, { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'm1', role: 'user', content: 'Cut the ums' }] })
    f.bridge.publish('agui', f.dir, { type: 'RUN_STARTED' })
    f.bridge.publish('agui', f.dir, { type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'Working' })
    const event = await new Promise<Record<string, any>>((ok, fail) => {
      const req = request(`https://127.0.0.1:${f.port}/events`, { rejectUnauthorized: false, headers: { authorization: `Bearer ${f.token}` } }, res => {
        let content = ''
        res.on('data', chunk => { content += chunk; const line = content.split('\n').find(line => line.startsWith('data: ')); if (line && content.includes('\n\n')) { ok(JSON.parse(line.slice(6))); res.destroy(); req.destroy() } })
      }); req.on('error', fail); req.end()
    })
    expect(event.channel).toBe('agent:state'); expect(event.args[1].messages[0].content).toBe('Cut the ums'); expect(event.args[1].streaming.text).toBe('Working'); expect(event.args[1].busy).toBe(true)
  })
})

it('validates anchors and rejects path-bearing or unknown fields', () => {
  expect(() => mobileArgs('agent:send', ['/project', { text: 'Blur', anchor: { t0: 2, t1: 1 } }])).toThrow()
  expect(() => mobileArgs('agent:send', ['/project', { text: 'Blur', anchor: { t0: 2, box: { x: .8, y: 0, w: .5, h: .2 } } }])).toThrow()
  expect(() => mobileArgs('project:createMotion', [{ aspect: '16:9', files: ['/etc/passwd'] }])).toThrow()
  expect(() => mobileArgs('browser:navigate', ['file:///etc/passwd'])).toThrow()
  expect(() => mobileArgs('__proto__', [])).toThrow()
})
