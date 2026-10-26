import { afterEach, describe, expect, it, vi } from 'vitest'
import { request } from 'node:https'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { isTailscale, MobileBridge, reachableIps } from '../src/main/mobile-bridge'
import { mobileArgs } from '../src/main/mobile-contract'
import { WorkerClient } from '../src/main/worker-client'
import { signWorkerToken } from '../account/src/index'
const bridges: MobileBridge[] = []
const folders: string[] = []
afterEach(async () => { await Promise.all(bridges.splice(0).map(b => b.stop())); await Promise.all(folders.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'agentshot-bridge-test-')); folders.push(dir)
  await writeFile(join(dir, 'film.mp4'), '0123456789')
  const invoke = vi.fn(async (method: string, args: unknown[]) => ({ method, args }))
  const importFile = vi.fn(async (file: string) => ({ name: basename(file), content: await readFile(file, 'utf8') }))
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
  it('reports the Headscale mesh IP apart from Tailscale and the port it bound', async () => {
    let mesh: string | undefined = '100.64.0.9'
    const bridge = new MobileBridge({ invoke: async () => null, projects: () => [], importFile: async () => null, galleryFile: () => new Response(''), meshIp: () => mesh }, () => ['192.168.1.4', '100.64.0.9']); bridges.push(bridge)
    expect(bridge.listenPort()).toBeUndefined()
    const st = await bridge.start()
    expect(st.mesh).toBe('100.64.0.9')
    expect(st.tailscale).toBeUndefined()
    expect(st.addresses).toContain('https://100.64.0.9:47821')
    mesh = undefined
    expect(bridge.status().tailscale).toBe('100.64.0.9')
    await bridge.stop()
    expect(bridge.listenPort()).toBeUndefined()
  })
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
  it('lets a phone unpair itself, and only itself', async () => {
    const f = await fixture()
    expect((await f.call('/unpair', { method: 'POST' })).status).toBe(401)
    await f.bridge.start() // a second phone pairs with a fresh code
    const other = JSON.parse((await f.call('/pair', { body: { code: f.bridge.status().code, name: 'Other phone' } })).body).token as string
    expect(f.bridge.status().devices.map(d => d.name)).toEqual(['Test phone', 'Other phone'])
    expect((await f.call('/unpair', { token: f.token, method: 'POST' })).status).toBe(200)
    expect(f.bridge.status().devices.map(d => d.name)).toEqual(['Other phone'])
    expect((await f.call('/rpc', { token: f.token, body: { method: 'project:recent', args: [] } })).status).toBe(401)
    expect((await f.call('/rpc', { token: other, body: { method: 'project:recent', args: [] } })).status).toBe(200)
  })
  it('tells the phone when the computer has no AI set up yet, instead of a generic failure', async () => {
    const f = await fixture()
    f.invoke.mockRejectedValueOnce(Object.assign(new Error('Add an API key first (Settings → Keys).'), { code: 'needs-key' }))
    const r = await f.call('/rpc', { token: f.token, body: { method: 'agent:send', args: [f.dir, { text: 'hi' }] } })
    expect(r.status).toBe(409)
    expect(JSON.parse(r.body)).toEqual({ error: 'AgentShot on your computer has no AI to edit with yet.', code: 'needs-key' })
    f.invoke.mockRejectedValueOnce(new Error('something internal'))
    expect(JSON.parse((await f.call('/rpc', { token: f.token, body: { method: 'project:recent', args: [] } })).body)).toEqual({ error: 'Request failed. Check the desktop and try again.' })
  })
  it('lists phones signed in to the same account (account tokens), by the name they give', async () => {
    const f = await fixture()
    expect(f.bridge.status().signedIn).toEqual([])
    const lease = signWorkerToken(f.bridge.workerCredentials().secret, 'user_1', false, Date.now() + 60_000)
    expect((await f.call('/hello', { token: lease, headers: { 'x-agentshot-device': 'Android phone' } })).status).toBe(200)
    expect(f.bridge.status().signedIn.map(d => d.name)).toEqual(['Android phone'])
    // a paired phone (a pairing, not an account token) is not one of them
    await f.call('/hello', { token: f.token, headers: { 'x-agentshot-device': 'Paired phone' } })
    expect(f.bridge.status().signedIn.map(d => d.name)).toEqual(['Android phone'])
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
        res.on('data', chunk => { content += chunk; if (content.includes('\n\n')) { ok(JSON.parse(content.split('\n')[0].slice(6))); res.destroy(); req.destroy() } })
      }); req.on('error', fail); req.end()
    })
    expect(event.channel).toBe('agent:state'); expect(event.args[1].messages[0].content).toBe('Cut the ums'); expect(event.args[1].streaming.text).toBe('Working'); expect(event.args[1].busy).toBe(true)
  })
})
  it('orders LAN addresses before Tailscale and reports Tailscale status and /hello urls', async () => {
    expect(isTailscale('100.64.0.1')).toBe(true)
    expect(isTailscale('100.127.255.254')).toBe(true)
    expect(isTailscale('100.63.255.255')).toBe(false)
    expect(isTailscale('100.128.0.1')).toBe(false)
    expect(isTailscale('192.168.1.20')).toBe(false)
    const list = reachableIps({
      lo0: [{ address: '127.0.0.1', netmask: '255.0.0.0', family: 'IPv4', mac: '', internal: true, cidr: '127.0.0.1/8' }],
      utun4: [{ address: '100.101.102.103', netmask: '255.192.0.0', family: 'IPv4', mac: '', internal: false, cidr: '100.101.102.103/10' }],
      en0: [{ address: '192.168.1.42', netmask: '255.255.255.0', family: 'IPv4', mac: '', internal: false, cidr: '192.168.1.42/24' }],
    })
    expect(list).toEqual(['192.168.1.42', '100.101.102.103'])
    const f = await fixture()
    const hello = await f.call('/hello', { token: f.token })
    expect(hello.status).toBe(200)
    expect(JSON.parse(hello.body).urls).toEqual(f.status.addresses)
  })

it('validates anchors and rejects path-bearing or unknown fields', () => {
  expect(() => mobileArgs('agent:send', ['/project', { text: 'Blur', anchor: { t0: 2, t1: 1 } }])).toThrow()
  expect(() => mobileArgs('agent:send', ['/project', { text: 'Blur', anchor: { t0: 2, box: { x: .8, y: 0, w: .5, h: .2 } } }])).toThrow()
  expect(() => mobileArgs('project:createMotion', [{ aspect: '16:9', files: ['/etc/passwd'] }])).toThrow()
  expect(() => mobileArgs('browser:navigate', ['file:///etc/passwd'])).toThrow()
  expect(() => mobileArgs('__proto__', [])).toThrow()
  expect(mobileArgs('clip:save', ['/project', 'intro', 'Title', '<div></div>', 4, true])).toEqual(['/project', 'intro', 'Title', '<div></div>', 4, true])
  expect(mobileArgs('clip:move', ['/project', 'intro', 'el-1', 10, -5])).toEqual(['/project', 'intro', 'el-1', 10, -5])
  expect(mobileArgs('media:thumbnails', ['/project', 'media/a.mp4', 8, 0, 10])).toEqual(['/project', 'media/a.mp4', 8, 0, 10])
  expect(mobileArgs('export:run', ['/project', { preset: 'landscape', fit: 'crop', captions: 'burn', captionColor: '#ffffff' }])).toHaveLength(2)
  expect(() => mobileArgs('media:thumbnails', ['/project', '../secret.mp4', 8])).toThrow()
})

describe('cloud & home worker extensions', () => {
  it('persists TLS cert, workerSecret and paired devices across restarts when stateFile is set', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentshot-worker-persist-')); folders.push(root)
    const stateFile = join(root, 'bridge.json')
    const opts = {
      stateFile,
      invoke: async (method: string) => ({ method }),
      projects: () => [{ dir: root }],
      importFile: async () => ({}),
      galleryFile: () => new Response('ok'),
    }
    const b1 = new MobileBridge(opts, () => ['127.0.0.1']); bridges.push(b1)
    const st1 = await b1.start()
    const creds1 = b1.workerCredentials()
    const client = new WorkerClient({ projectsRoot: () => root, onEvent: () => {} })
    const paired = await client.pair({ url: st1.addresses[0], code: st1.code!, name: 'MacBook' })
    expect(paired.connected).toBe(true)
    await b1.stop()

    // Restart a new bridge instance with the same stateFile: fingerprint, secret and paired token survive
    const b2 = new MobileBridge(opts, () => ['127.0.0.1']); bridges.push(b2)
    const st2 = await b2.start()
    expect(st2.fingerprint).toBe(st1.fingerprint)
    expect(b2.workerCredentials().secret).toBe(creds1.secret)
    await client.connect({ ...paired.active!, urls: st2.addresses, activeUrl: st2.addresses[0] })
    expect(await client.rpc('app:info', [])).toEqual({ method: 'app:info' })
    client.disconnect()
  })

  it('authenticates stateless HMAC worker lease tokens, resumable uploads, and Mac <-> Worker delta project sync', async () => {
    const workerRoot = await mkdtemp(join(tmpdir(), 'agentshot-worker-projects-')); folders.push(workerRoot)
    const macRoot = await mkdtemp(join(tmpdir(), 'agentshot-mac-projects-')); folders.push(macRoot)
    const knownProjects = new Set<string>()
    const syncedDirs: string[] = []

    const bridge = new MobileBridge(
      {
        projectsRoot: () => workerRoot,
        onProjectSynced: dir => { knownProjects.add(dir); syncedDirs.push(dir) },
        invoke: async (method, args) => {
          if (method === 'project:recent') return [...knownProjects].map(dir => ({ dir }))
          return { method, args }
        },
        projects: () => [...knownProjects].map(dir => ({ dir })),
        importFile: async (file, dir) => {
          const target = dir || join(workerRoot, 'imported')
          await mkdir(target, { recursive: true })
          const content = await readFile(file, 'utf8')
          await writeFile(join(target, basename(file)), content)
          knownProjects.add(target)
          return { dir: target, size: content.length }
        },
        galleryFile: () => new Response('ok'),
        pool: true,
      },
      () => ['127.0.0.1'],
    )
    bridges.push(bridge)
    await bridge.start()
    const creds = bridge.workerCredentials()
    // a cloud worker, leased to this person (what the account tells it with each heartbeat)
    bridge.setLease({ userId: 'user_42', until: Date.now() + 60_000 })
    const leaseToken = signWorkerToken(creds.secret, 'user_42', true, Date.now() + 60_000)

    const pulledDirs: string[] = []
    const client = new WorkerClient({
      projectsRoot: () => macRoot,
      onEvent: () => {},
      onProjectPulled: dir => { pulledDirs.push(dir) },
    })
    await client.connect({
      id: 'pool-worker-1',
      name: 'Home Pool Worker',
      urls: creds.urls,
      fingerprint: creds.fingerprint!,
      token: leaseToken,
      pool: true,
    })

    // 1. Resumable chunked upload from client to worker
    const sampleVideo = join(macRoot, 'source.mp4')
    const payload = '0123456789abcdefghijklmnopqrstuvwxyz'
    await writeFile(sampleVideo, payload)
    const imported = (await client.uploadFile(sampleVideo, undefined, 10)) as { dir: string; size: number }
    expect(imported.size).toBe(payload.length)

    // 2. Byte-range media streaming from worker to Desktop client
    const rangeRes = await client.fetchMedia(imported.dir, 'source.mp4', 'bytes=10-15')
    expect(rangeRes.status).toBe(206)
    expect(await rangeRes.text()).toBe('abcdef')

    // 3. Push a self-contained Mac project (with .agent.sqlite, .git, media, and project.json) to Worker
    const localProj = join(macRoot, 'my-edit')
    await mkdir(join(localProj, 'media'), { recursive: true })
    await mkdir(join(localProj, '.git'), { recursive: true })
    await writeFile(join(localProj, 'media', 'clip.mp4'), 'video-bytes-12345')
    await writeFile(join(localProj, '.agent.sqlite'), 'sqlite-conversation-state')
    await writeFile(join(localProj, '.git', 'HEAD'), 'ref: refs/heads/main\n')
    await writeFile(join(localProj, 'project.json'), JSON.stringify({ id: 'p1', title: 'My Edit', dir: localProj }))

    const push1 = await client.pushProject(localProj)
    expect(push1.uploaded).toBe(4)
    expect(push1.skipped).toBe(0)
    expect(syncedDirs).toContain(push1.remoteDir)

    // Second push skips unchanged media/clip.mp4
    const push2 = await client.pushProject(localProj)
    expect(push2.skipped).toBe(1)

    // 4. Pull the project from Worker to a fresh local folder on another machine
    const freshMacDir = join(macRoot, 'pulled-edit')
    const pull1 = await client.pullProject(push1.remoteDir, freshMacDir)
    expect(pull1.downloaded).toBe(4)
    expect(pull1.skipped).toBe(0)
    expect(pulledDirs).toContain(freshMacDir)
    expect(await readFile(join(freshMacDir, '.agent.sqlite'), 'utf8')).toBe('sqlite-conversation-state')
    const pulledJson = JSON.parse(await readFile(join(freshMacDir, 'project.json'), 'utf8')) as { dir: string }
    expect(pulledJson.dir).toBe(freshMacDir)

    // Second pull skips unchanged media/clip.mp4
    const pull2 = await client.pullProject(push1.remoteDir, freshMacDir)
    expect(pull2.skipped).toBe(1)

    client.disconnect()
  })

  it('rejects expired, tampered, or wrong-secret HMAC lease tokens and enforces upload & sync security boundaries', async () => {
    const f = await fixture()
    const creds = f.bridge.workerCredentials()

    // Expired token rejected
    const expired = signWorkerToken(creds.secret, 'user_1', false, Date.now() - 1_000)
    expect((await f.call('/hello', { token: expired })).status).toBe(401)

    // Wrong workerSecret rejected
    const wrongSecret = signWorkerToken('x'.repeat(48), 'user_1', false, Date.now() + 60_000)
    expect((await f.call('/hello', { token: wrongSecret })).status).toBe(401)

    // Tampered payload rejected
    const valid = signWorkerToken(creds.secret, 'user_1', false, Date.now() + 60_000)
    const parts = valid.split('.')
    const tampered = `${parts[0]}.${Number(parts[1]) + 1000}.${parts[2]}.${parts[3]}`
    expect((await f.call('/hello', { token: tampered })).status).toBe(401)

    // Resumable upload validation: bad filenames, bad sizes, wrong offsets, and unknown upload IDs
    expect((await f.call('/upload/init?name=../evil.mp4&size=10', { token: valid, body: {} })).status).toBe(400)
    expect((await f.call('/upload/init?name=.hidden.mp4&size=10', { token: valid, body: {} })).status).toBe(400)
    expect((await f.call('/upload/init?name=ok.mp4&size=0', { token: valid, body: {} })).status).toBe(413)
    expect((await f.call('/upload?id=nonexistent', { token: valid })).status).toBe(404)
    expect((await f.call('/upload?id=nonexistent&offset=0', { token: valid, method: 'PATCH', raw: 'abc' })).status).toBe(404)

    const initRes = await f.call(`/upload/init?${new URLSearchParams({ project: f.dir, name: 'chunked.mp4', size: '6' })}`, { token: valid, body: {} })
    expect(initRes.status).toBe(200)
    const { id: upId } = JSON.parse(initRes.body) as { id: string }
    // Wrong offset returns 409
    expect((await f.call(`/upload?id=${upId}&offset=3`, { token: valid, method: 'PATCH', raw: 'abc' })).status).toBe(409)
    // Valid first chunk (3 bytes)
    const p1 = await f.call(`/upload?id=${upId}&offset=0`, { token: valid, method: 'PATCH', raw: 'abc' })
    expect(p1.status).toBe(200)
    expect(JSON.parse(p1.body)).toMatchObject({ done: false, offset: 3 })
    // Valid second chunk completes and imports
    const p2 = await f.call(`/upload?id=${upId}&offset=3`, { token: valid, method: 'PATCH', raw: 'def' })
    expect(p2.status).toBe(200)
    expect(JSON.parse(p2.body)).toMatchObject({ done: true, offset: 6, result: { name: 'chunked.mp4', content: 'abcdef' } })

    // Project sync traversal & symlink escape checks
    for (const badFile of ['../secret', 'a/../../etc/passwd', 'file.tmp', 'back\\slash']) {
      expect((await f.call(`/project/file?${new URLSearchParams({ project: f.dir, file: badFile })}`, { token: valid })).status).toBe(400)
      expect((await f.call(`/project/file?${new URLSearchParams({ project: f.dir, file: badFile })}`, { token: valid, raw: 'x' })).status).toBe(400)
    }
    await symlink('/etc/passwd', join(f.dir, 'sym.txt'))
    expect((await f.call(`/project/file?${new URLSearchParams({ project: f.dir, file: 'sym.txt' })}`, { token: valid })).status).toBe(404)
  })

  it('falls back across multiple worker URLs, rejects TLS fingerprint spoofing, and streams live SSE events to WorkerClient', async () => {
    const f = await fixture()
    f.bridge.publish('agui', f.dir, { type: 'RUN_STARTED' })
    const creds = f.bridge.workerCredentials()
    const token = signWorkerToken(creds.secret, 'user_9', false, Date.now() + 60_000)
    const { promise: jobEvent, resolve: onJobEvent } = Promise.withResolvers<unknown[]>()
    const client = new WorkerClient({
      projectsRoot: () => f.dir,
      onEvent: (channel, ...args) => {
        if (channel === 'agent:state') {
          f.bridge.publish('jobs', [{ id: 'j1', title: 'Rendering on cloud worker' }])
        } else if (channel === 'jobs') {
          onJobEvent(args)
        }
      },
    })

    // Rejects wrong TLS certificate fingerprint
    await expect(
      client.connect({ id: 'w-spoof', name: 'Spoofed', urls: creds.urls, fingerprint: 'f'.repeat(64), token }),
    ).rejects.toThrow(/Could not reach worker/)

    // Falls back past dead primary address (127.0.0.1:1) to the working address
    const st = await client.connect({
      id: 'w-multi',
      name: 'Multi-Address Worker',
      urls: ['https://127.0.0.1:1', ...creds.urls],
      fingerprint: creds.fingerprint!,
      token,
    })
    expect(st.connected).toBe(true)
    expect(st.active?.activeUrl).toBe(creds.urls[0])

    expect(await jobEvent).toEqual([[{ id: 'j1', title: 'Rendering on cloud worker' }]])
    client.disconnect()
  })

  it('on a cloud worker: a cloud token works only while its holder leases it, and each lessee sees only what they made', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentshot-pool-')); folders.push(root)
    const projects: { dir: string }[] = [{ dir: join(root, 'operators-own') }]
    let made = 0
    const invoke = vi.fn(async (method: string) => {
      if (method === 'project:recent') return projects
      if (method === 'project:createMotion') { const p = { dir: join(root, `made-${++made}`) }; projects.push(p); return p }
      return { method }
    })
    const bridge = new MobileBridge({ invoke, projects: () => projects, importFile: async () => null, galleryFile: () => new Response(''), stateFile: join(root, 'bridge.json'), pool: true }); bridges.push(bridge)
    const status = await bridge.start()
    const port = new URL(status.addresses[0]).port
    const secretOf = () => (bridge.workerCredentials() as { secret: string }).secret
    const rpc = (token: string, method: string, args: unknown[] = []) => new Promise<{ status: number; body: unknown }>((ok, fail) => {
      const data = JSON.stringify({ method, args })
      const req = request(`https://127.0.0.1:${port}/rpc`, { rejectUnauthorized: false, method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-length': String(Buffer.byteLength(data)) } }, res => {
        const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode!, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') })); res.on('error', fail)
      }); req.on('error', fail); req.end(data)
    })
    const until = Date.now() + 60 * 60_000
    const maya = signWorkerToken(secretOf(), 'user_maya', true, until)
    const sam = signWorkerToken(secretOf(), 'user_sam', true, until)

    // not leased to anyone yet: a cloud token is refused
    expect((await rpc(maya, 'project:recent')).status).toBe(401)

    // leased to Maya: she works, makes a project, and sees only that one (not the operator's)
    bridge.setLease({ userId: 'user_maya', until })
    expect((await rpc(sam, 'project:recent')).status).toBe(401)
    const mine = (await rpc(maya, 'project:createMotion', [{ title: 'Maya', aspect: '16:9' }])).body as { dir: string }
    expect((await rpc(maya, 'project:recent')).body).toEqual([mine])
    expect((await rpc(maya, 'project:open', [projects[0].dir])).status).toBe(403)
    // the worker's own settings stay the worker's
    expect((await rpc(maya, 'memory:list')).status).toBe(403)
    expect((await rpc(maya, 'keys:set', ['OPENAI_API_KEY', 'x'])).status).toBe(403)

    // the lease moves to Sam: Maya's token stops at once; Sam doesn't see Maya's project
    bridge.setLease({ userId: 'user_sam', until })
    expect((await rpc(maya, 'project:recent')).status).toBe(401)
    expect((await rpc(sam, 'project:recent')).body).toEqual([])
    expect((await rpc(sam, 'project:open', [mine.dir])).status).toBe(403)

    // released: nobody's cloud token works; who made what survives a restart
    bridge.setLease(undefined)
    expect((await rpc(sam, 'project:recent')).status).toBe(401)
    expect(JSON.parse(await readFile(join(root, 'bridge.json'), 'utf8')).owners).toEqual([[mine.dir, 'user_maya']])
  })

  it('on a cloud worker: reports how long its lessee has been away and whether anything still runs for them', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentshot-idle-')); folders.push(root)
    let jobRunning = false
    const bridge = new MobileBridge({
      invoke: async () => [], projects: () => [], importFile: async () => null, galleryFile: () => new Response(''),
      stateFile: join(root, 'bridge.json'), pool: true, busy: () => jobRunning,
    }); bridges.push(bridge)
    const port = new URL((await bridge.start()).addresses[0]).port
    const until = Date.now() + 60 * 60_000
    const maya = signWorkerToken((bridge.workerCredentials() as { secret: string }).secret, 'user_maya', true, until)
    const ask = () => new Promise<number>((ok, fail) => {
      const data = JSON.stringify({ method: 'project:recent', args: [] })
      const req = request(`https://127.0.0.1:${port}/rpc`, { rejectUnauthorized: false, method: 'POST', headers: { authorization: `Bearer ${maya}`, 'content-length': String(Buffer.byteLength(data)) } }, res => { res.resume(); res.on('end', () => ok(res.statusCode!)) })
      req.on('error', fail); req.end(data)
    })
    const away = (ms: number) => { (bridge as unknown as { lastActive: number }).lastActive = Date.now() - ms }

    expect(bridge.activity()).toBeUndefined() // not leased: nothing to report
    bridge.setLease({ userId: 'user_maya', until })
    expect(bridge.activity()).toMatchObject({ user: 'user_maya', busy: false })
    expect(bridge.activity()!.idleMs).toBeLessThan(1_000) // a new lease starts fresh

    away(20 * 60_000)
    expect(bridge.activity()!.idleMs).toBeGreaterThanOrEqual(20 * 60_000)
    expect(await ask()).toBe(200) // asking anything counts as using it
    expect(bridge.activity()!.idleMs).toBeLessThan(1_000)

    // the agent working on a project keeps it busy until its run ends
    away(20 * 60_000)
    bridge.publish('agui', '/p', { type: 'RUN_STARTED', threadId: 't', runId: 'r' })
    expect(bridge.activity()!.busy).toBe(true)
    bridge.publish('agui', '/p', { type: 'RUN_FINISHED', threadId: 't', runId: 'r' })
    expect(bridge.activity()!.busy).toBe(false)
    // and so does any job (a render, a transcription)
    jobRunning = true
    expect(bridge.activity()!.busy).toBe(true)

    // the lease moves on: a fresh start for the next person, nothing for nobody
    bridge.setLease({ userId: 'user_sam', until })
    expect(bridge.activity()).toMatchObject({ user: 'user_sam' })
    expect(bridge.activity()!.idleMs).toBeLessThan(1_000)
    bridge.setLease(undefined)
    expect(bridge.activity()).toBeUndefined()
  })

  it('refuses cloud tokens on a computer that is not a cloud worker', async () => {
    const f = await fixture()
    const token = signWorkerToken((f.bridge.workerCredentials() as { secret: string }).secret, 'user_maya', true, Date.now() + 60_000)
    f.bridge.setLease({ userId: 'user_maya', until: Date.now() + 60_000 })
    expect((await f.call('/rpc', { token, body: { method: 'project:recent', args: [] } })).status).toBe(401)
  })

  it('on a cloud worker, accepts a lease that began since the last heartbeat by asking the account then', async () => {
    let leasedTo: string | undefined
    const bridge: MobileBridge = new MobileBridge({
      invoke: async () => [], projects: () => [], importFile: async () => null, galleryFile: () => new Response(''), pool: true,
      refreshLease: async () => { bridge.setLease(leasedTo ? { userId: leasedTo, until: Date.now() + 60_000 } : undefined) },
    }); bridges.push(bridge)
    const port = new URL((await bridge.start()).addresses[0]).port
    const token = signWorkerToken((bridge.workerCredentials() as { secret: string }).secret, 'user_maya', true, Date.now() + 60_000)
    const hello = () => new Promise<number>((ok, fail) => {
      const req = request(`https://127.0.0.1:${port}/hello`, { rejectUnauthorized: false, headers: { authorization: `Bearer ${token}` } }, res => { res.resume(); ok(res.statusCode!) }); req.on('error', fail); req.end()
    })
    leasedTo = 'user_maya' // leased just now: the worker's last heartbeat didn't know
    expect(await hello()).toBe(200)
  })

  it('on a stateless worker: serves a lessee only once their space is open, within their quota, inside their space', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agentshot-stateless-')); folders.push(root)
    const projectsRoot = join(root, 'users', 'user_maya', 'projects'), elsewhere = join(root, 'elsewhere')
    await mkdir(join(projectsRoot, 'film'), { recursive: true }); await mkdir(elsewhere, { recursive: true })
    await symlink(elsewhere, join(projectsRoot, 'sneaky'))
    const projects = [{ dir: join(projectsRoot, 'film') }, { dir: join(projectsRoot, 'sneaky') }, { dir: elsewhere }]
    let open: string | undefined
    const used = { bytes: 0 }
    const { SpaceError } = await import('../src/main/user-space')
    const quota = {
      ensureRoom: (n: number) => { if (used.bytes + n > 1000) throw new SpaceError(507, 'Your AgentShot space is full') },
      add: (n: number) => { used.bytes += n },
    }
    const bridge = new MobileBridge({
      invoke: async () => ({ ok: true }), projects: () => projects, projectsRoot: () => projectsRoot,
      importFile: async () => ({ dir: join(projectsRoot, 'film') }), galleryFile: () => new Response(''), pool: true,
      session: () => open, quota,
    }); bridges.push(bridge)
    const port = new URL((await bridge.start()).addresses[0]).port
    const until = Date.now() + 60_000
    bridge.setLease({ userId: 'user_maya', until })
    const token = signWorkerToken((bridge.workerCredentials() as { secret: string }).secret, 'user_maya', true, until)
    const ask = (path: string, body?: unknown, method?: string) => new Promise<{ status: number; body: string }>((ok, fail) => {
      const data = body === undefined ? undefined : JSON.stringify(body)
      const req = request(`https://127.0.0.1:${port}${path}`, { rejectUnauthorized: false, method: method || (data ? 'POST' : 'GET'), headers: { authorization: `Bearer ${token}`, ...(data ? { 'content-length': String(Buffer.byteLength(data)) } : {}) } }, res => {
        const chunks: Buffer[] = []; res.on('data', c => chunks.push(c)); res.on('end', () => ok({ status: res.statusCode!, body: Buffer.concat(chunks).toString() })); res.on('error', fail)
      }); req.on('error', fail); req.end(data)
    })

    // leased, but the worker hasn't opened Maya's space yet: wait (503), not "reconnect" (401)
    const opening = await ask('/hello')
    expect(opening.status).toBe(503)
    expect(opening.body).toContain('Opening your space')
    open = 'user_maya'
    expect((await ask('/hello')).status).toBe(200)

    // the claim of a project made here, then inside the space only: not a link out of it, not another folder
    bridge['owners'].set(join(projectsRoot, 'film'), 'user_maya')
    bridge['owners'].set(join(projectsRoot, 'sneaky'), 'user_maya')
    bridge['owners'].set(elsewhere, 'user_maya')
    expect((await ask('/rpc', { method: 'project:open', args: [join(projectsRoot, 'film')] })).status).toBe(200)
    expect((await ask('/rpc', { method: 'project:open', args: [join(projectsRoot, 'sneaky')] })).status).toBe(403)
    expect((await ask('/rpc', { method: 'project:open', args: [elsewhere] })).status).toBe(403)

    // the quota: an upload that fits starts; one that doesn't is refused with why
    expect((await ask(`/upload/init?name=a.mp4&size=600`, {}, 'POST')).status).toBe(200)
    used.bytes = 900
    const full = await ask(`/upload/init?name=b.mp4&size=200`, {}, 'POST')
    expect(full.status).toBe(507)
    expect(full.body).toContain('space is full')
  })
})
