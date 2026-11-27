// AgentShot for Claude and ChatGPT on the web (chat-host): an MCP client as the chat is, Clerk and the account service
// as they answer, and a real bridge in cloud-worker mode leased to the person (its tools stand in for AgentShot's).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, request, type Server as HttpServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { MobileBridge } from '../src/main/mobile-bridge'
import { signWorkerToken } from '../account/src/index'
import { People } from '../chat-host/src/people'
import { chatHost } from '../chat-host/src/host'
import { APP_MIME, EDITOR_URI } from '../src/shared/editor-view'

const cleanups: (() => Promise<unknown>)[] = []
afterEach(async () => { for (const c of cleanups.splice(0).reverse()) await c() })

async function setup(o: { projects?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chat-host-')); cleanups.push(() => rm(root, { recursive: true, force: true }))
  const projects = await Promise.all(Array.from({ length: o.projects ?? 2 }, async (_, i) => {
    const dir = join(root, `film-${i + 1}`)
    await mkdir(join(dir, 'media'), { recursive: true })
    await writeFile(join(dir, 'media', 'talk.mp4'), '0123456789')
    return { dir, title: `Film ${i + 1}` }
  }))
  const invoke = vi.fn(async (method: string, args: unknown[]) => {
    if (method === 'project:recent') return [...projects].reverse() // newest first
    if (method === 'outside:tools') return [
      { name: 'projects', description: 'p', inputSchema: { type: 'object' } },
      { name: 'add_files', description: 'from this computer', inputSchema: { type: 'object' } },
      { name: 'open_editor', description: 'the editor', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: EDITOR_URI } } },
      { name: 'project_state', description: 's', inputSchema: { type: 'object' } },
    ]
    if (method === 'outside:call') {
      const [dir, name] = args as [string, string]
      if (name === 'open_editor') return { content: [{ type: 'text', text: 'open' }], structuredContent: { folder: 'x', media: 'agentshot-worker-media:/', project: { dir } } }
      return { content: [{ type: 'text', text: `${name} on ${dir}` }] }
    }
    return null
  })
  // the worker: a real bridge, leased to Maya
  // a file sent in becomes a project (or goes into one), as AgentShot imports it
  const importFile = vi.fn(async (file: string, into?: string) => {
    const dir = into ?? join(root, `film-${projects.length + 1}`)
    await mkdir(join(dir, 'media'), { recursive: true })
    await writeFile(join(dir, 'media', basename(file)), await readFile(file))
    if (!into) projects.push({ dir, title: basename(file) })
    return { dir, title: basename(file) }
  })
  const bridge = new MobileBridge({ invoke, projects: () => projects, importFile, galleryFile: () => new Response(''), stateFile: join(root, 'bridge.json'), pool: true })
  cleanups.push(() => bridge.stop())
  const status = await bridge.start()
  const creds = bridge.workerCredentials() as { secret: string; fingerprint: string }
  const until = Date.now() + 60 * 60_000
  bridge.setLease({ userId: 'user_maya', until })
  // as if Maya made them (the bridge records that when a lessee creates a project)
  for (const p of projects) (bridge as unknown as { claim(r: unknown, who: string): void }).claim(p, 'user_maya')
  // Clerk and the account service
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url), bearer = /^Bearer (.+)$/.exec(new Headers(init?.headers).get('authorization') || '')?.[1]
    if (u.endsWith('/oauth/userinfo')) return bearer === 'maya-token' ? Response.json({ sub: 'user_maya', email: 'maya@example.com' }) : new Response('', { status: 401 })
    if (u.endsWith('/v1/key')) return Response.json({ key: 'sk-maya', key_id: 'vk-maya' })
    if (u.endsWith('/v1/workers/lease')) return Response.json({ worker: { id: 'w1', urls: status.addresses.slice(0, 1), fingerprint: creds.fingerprint, token: signWorkerToken(creds.secret, 'user_maya', true, until), expiresAt: until } })
    return new Response('', { status: 404 })
  })
  const people = new People({ clerk: 'https://clerk.test', account: 'https://account.test', fetch: f as typeof fetch })
  const server: HttpServer = createServer(chatHost({ publicUrl: 'http://127.0.0.1:0', clerk: 'https://clerk.test', people, secret: 'link-secret', page: () => '<!doctype html><title>editor</title>' }))
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok))
  cleanups.push(() => new Promise(ok => server.close(ok)))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  // the public address is where the server is: build it again knowing its port
  server.removeAllListeners('request')
  server.on('request', chatHost({ publicUrl: base, clerk: 'https://clerk.test', people, secret: 'link-secret', page: () => '<!doctype html><title>editor</title>' }))
  const chat = async (token = 'maya-token') => {
    const client = new Client({ name: 'claude.ai', version: '1' })
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }))
    cleanups.push(() => client.close())
    return client
  }
  return { base, chat, invoke, projects, importFile }
}

const send = (url: string, method: string, body?: Buffer, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((ok, fail) => {
  const req = request(url, { method, headers: { ...(body ? { 'content-length': String(body.length) } : {}), ...headers } }, res => { let out = ''; res.on('data', c => { out += c }); res.on('end', () => ok({ status: res.statusCode!, body: out, headers: res.headers })) })
  req.on('error', fail); req.end(body)
})
const get = (url: string, headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((ok, fail) => {
  const req = request(url, { headers }, res => { let body = ''; res.on('data', c => { body += c }); res.on('end', () => ok({ status: res.statusCode!, body, headers: res.headers })) })
  req.on('error', fail); req.end()
})

describe('AgentShot in a chat on the web', () => {
  it('says where to sign in (Clerk) to a chat that hasn’t, as MCP has it', async () => {
    const { base } = await setup()
    const r = await get(`${base}/mcp`)
    expect(r.status).toBe(401)
    expect(r.headers['www-authenticate']).toBe(`Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`)
    const meta = JSON.parse((await get(`${base}/.well-known/oauth-protected-resource/mcp`)).body)
    expect(meta).toMatchObject({ resource: `${base}/mcp`, authorization_servers: ['https://clerk.test'] })
    await expect(setup().then(s => s.chat('forged'))).rejects.toThrow()
  })

  it('offers AgentShot’s tools from the person’s worker, with add_video for files and not add_files', async () => {
    const { chat } = await setup()
    const names = (await (await chat()).listTools()).tools.map(t => t.name)
    expect(names).toEqual(['projects', 'open_editor', 'project_state', 'add_video', 'upload_start'])
  })

  it('lists their projects, newest first, and runs a tool on the newest or the one named', async () => {
    const { chat, invoke, projects } = await setup()
    const c = await chat()
    const listed = (await c.callTool({ name: 'projects', arguments: {} })) as { content: { text: string }[] }
    expect(listed.content[0].text).toMatch(/^film-2: "Film 2" \(used when no project is given\)\nfilm-1/)
    const newest = (await c.callTool({ name: 'project_state', arguments: {} })) as { content: { text: string }[] }
    expect(newest.content[0].text).toBe(`project_state on ${projects[1].dir}`)
    const named = (await c.callTool({ name: 'project_state', arguments: { project: 'Film 1' } })) as { content: { text: string }[] }
    expect(named.content[0].text).toBe(`project_state on ${projects[0].dir}`)
    expect(invoke).toHaveBeenCalledWith('outside:call', [projects[0].dir, 'project_state', {}])
    const nope = (await c.callTool({ name: 'project_state', arguments: { project: 'Nope' } })) as { isError: boolean; content: { text: string }[] }
    expect(nope.isError).toBe(true)
    expect(nope.content[0].text).toMatch(/No project is called "Nope"/)
  })

  it('says to bring a video in when there are no projects yet', async () => {
    const { chat } = await setup({ projects: 0 })
    const r = (await (await chat()).callTool({ name: 'project_state', arguments: {} })) as { isError: boolean; content: { text: string }[] }
    expect(r.isError).toBe(true)
    expect(r.content[0].text).toMatch(/add_video/)
  })

  it('serves the editor page, allowed to load from here only', async () => {
    const { chat, base } = await setup()
    const read = await (await chat()).readResource({ uri: EDITOR_URI })
    const page = read.contents[0] as { mimeType: string; text: string; _meta: { ui: { csp: unknown } } }
    expect(page).toMatchObject({ mimeType: APP_MIME, text: '<!doctype html><title>editor</title>' })
    expect(page._meta.ui.csp).toEqual({ resourceDomains: [base], frameDomains: [base], connectDomains: [base] })
  })

  it('gives the editor signed links that play the project’s files from the worker, in ranges, and nothing else', async () => {
    const { chat, base } = await setup()
    const opened = (await (await chat()).callTool({ name: 'open_editor', arguments: {} })) as { structuredContent: { media: string } }
    const media = opened.structuredContent.media
    expect(media).toMatch(new RegExp(`^${base}/media/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+/$`))
    expect(await get(`${media}media/talk.mp4`)).toMatchObject({ status: 200, body: '0123456789' })
    expect(await get(`${media}media/talk.mp4`, { range: 'bytes=2-4' })).toMatchObject({ status: 206, body: '234' })
    // another file outside the project, a changed link: nothing
    expect((await get(`${media}..%2F..%2Fetc%2Fpasswd`)).status).toBe(404)
    expect((await get(`${media.replace(/\.[^.]+\/$/, '.forged/')}media/talk.mp4`)).status).toBe(404)
  })
})

describe('bringing a video in from the editor page', () => {
  type Started = { isError?: boolean; content: { text: string }[]; structuredContent: { url: string } }

  it('gives the page a link to send one file to, which becomes a new project of theirs', async () => {
    const { chat, projects } = await setup({ projects: 1 })
    const c = await chat()
    const started = await c.callTool({ name: 'upload_start', arguments: { name: 'talk.mov', size: 5 } }) as Started
    expect(started.isError).toBeFalsy()
    const sent = await send(started.structuredContent.url, 'PUT', Buffer.from('hello'), { 'content-type': 'video/quicktime', origin: 'https://abc.claudemcpcontent.com' })
    expect(sent.status).toBe(200)
    expect(sent.headers['access-control-allow-origin']).toBe('*')
    expect(JSON.parse(sent.body)).toEqual({ folder: 'film-2', title: 'talk.mov' })
    expect(await readFile(join(projects[1].dir, 'media', 'talk.mov'), 'utf8')).toBe('hello')
    // it's theirs: the tools see it, newest first
    const listed = await c.callTool({ name: 'projects', arguments: {} }) as { content: { text: string }[] }
    expect(listed.content[0].text).toMatch(/^film-2/)
  })

  it('sends a file into the project named', async () => {
    const { chat, projects, importFile } = await setup({ projects: 1 })
    const started = await (await chat()).callTool({ name: 'upload_start', arguments: { name: 'song.mp3', size: 3, project: 'film-1' } }) as Started
    expect((await send(started.structuredContent.url, 'PUT', Buffer.from('abc'))).status).toBe(200)
    expect(importFile).toHaveBeenCalledWith(expect.stringMatching(/song\.mp3$/), projects[0].dir)
  })

  it('lets the chat’s frame ask first (CORS), and takes nothing else: another size, a changed link, a bad name', async () => {
    const { chat, base } = await setup({ projects: 1 })
    const c = await chat()
    const started = await c.callTool({ name: 'upload_start', arguments: { name: 'talk.mov', size: 5 } }) as Started
    const pre = await send(started.structuredContent.url, 'OPTIONS', undefined, { origin: 'https://abc.claudemcpcontent.com', 'access-control-request-method': 'PUT' })
    expect(pre.status).toBe(204)
    expect(pre.headers['access-control-allow-methods']).toMatch(/PUT/)
    expect((await send(started.structuredContent.url, 'PUT', Buffer.from('hello world'))).status).toBe(400)
    expect((await send(`${base}/upload/forged.link`, 'PUT', Buffer.from('hello'))).status).toBe(404)
    for (const name of ['../x.mp4', '.hidden', 'a:b.mp4', '']) {
      const r = await c.callTool({ name: 'upload_start', arguments: { name, size: 5 } }) as Started
      expect(r.isError, name).toBe(true)
    }
    const big = await c.callTool({ name: 'upload_start', arguments: { name: 'x.mp4', size: 5 * 1024 ** 3 } }) as Started
    expect(big.isError).toBe(true)
  })

  it('opens the editor on a start screen when there are no projects yet, and says the page can upload', async () => {
    const { chat } = await setup({ projects: 0 })
    const c = await chat()
    const opened = await c.callTool({ name: 'open_editor', arguments: {} }) as { isError?: boolean; structuredContent: { start?: boolean; upload?: boolean } }
    expect(opened.isError).toBeFalsy()
    expect(opened.structuredContent).toMatchObject({ start: true, upload: true })
  })

  it('tells an opened editor it can upload', async () => {
    const { chat } = await setup({ projects: 1 })
    const opened = await (await chat()).callTool({ name: 'open_editor', arguments: {} }) as { structuredContent: { upload?: boolean } }
    expect(opened.structuredContent.upload).toBe(true)
  })
})
