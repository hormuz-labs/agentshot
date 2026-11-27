// AgentShot in Claude and ChatGPT (on the web, on a phone, anywhere): an MCP server on the internet. A person connects
// AgentShot in the chat and signs in on Clerk (OAuth, as MCP has it: this server names Clerk as where its tokens come
// from). Their tools run on their own cloud worker, the same tools AgentShot's MCP server on a computer has
// (src/main/mcp.ts, through the bridge's outside:tools / outside:call); the editor is the same page
// (scripts/build-mcp-app.mjs), its video streamed from their worker through signed links here.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { APP_MIME, EDITOR_URI } from '../../src/shared/editor-view.ts'
import { AccountError, type People, type Person } from './people.ts'
import { media, rpc, upload, WorkerError, type Worker } from './worker.ts'
import { readLink, readUpload, signLink, signUpload } from './links.ts'

/** What a cloud worker puts where the page's files are (src/main/mcp.ts WORKER_MEDIA). */
const WORKER_MEDIA = 'agentshot-worker-media:/'

const INSTRUCTIONS =
  'AgentShot is a video editor. Its tools edit the user\'s AgentShot projects, which live in their AgentShot cloud space.\n' +
  '- projects lists them, newest first. Every other tool takes "project" (a name from that list); without it, the newest is used.\n' +
  '- When the user wants to see, play or review a film, or edit it by hand, call open_editor: it shows AgentShot\'s editor in the chat.\n' +
  '- Start with project_state. Know the footage before deciding: transcript, analyze_video, speakers, look.\n' +
  '- Plain cuts, trims, reordering and volume: edit_timeline. Anything else: ffmpeg, then propose_version; the user keeps it or sends it back in the editor.\n' +
  '- A video the user gives as a link (or a file the chat gives a link to): add_video brings it in, as a new project or into one.'

type Any = Record<string, any>
type Tool = { name: string; description?: string; inputSchema: Any; _meta?: Any }
type Options = {
  /** where this server is on the internet, e.g. https://mcp.agentshot.si */
  publicUrl: string
  /** Clerk's address, which gives the tokens */
  clerk: string
  people: People
  /** signs video links */
  secret: string
  /** the editor page (one HTML file) */
  page(): string
  /** how long a video link plays (ms) */
  linkMs?: number
  /** brings a video in from a link (add_video): see intake.ts */
  addVideo?(worker: Worker, url: string, dir?: string): Promise<{ dir: string; title?: string }>
}

const ADD_VIDEO: Tool = {
  name: 'add_video',
  description: 'Bring a video (or a picture or sound) into AgentShot from a link: an https address the user gave, or a file the chat attached. Without project it becomes a new project; with project it is added to that one. Returns the project.',
  inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'https address of the file' }, project: { type: 'string', description: 'add it to this project (a name from projects)' } }, required: ['url'] },
}

// The editor page sends a file it was given (dropped, or picked on this device) straight here: a link for that one
// file, then the bytes, which go on to the person's worker as they arrive. For the page only.
const UPLOAD_START: Tool = {
  name: 'upload_start',
  description: 'For the editor page only: where to send a file the user chose, as a new project or into one.',
  inputSchema: { type: 'object', properties: { name: { type: 'string' }, size: { type: 'number' }, project: { type: 'string' } }, required: ['name', 'size'] },
  _meta: { ui: { resourceUri: EDITOR_URI, visibility: ['app'] } },
}
const MAX_UPLOAD = 4 * 1024 ** 3
/** A name the worker takes (the bridge's rule). */
const fileName = (name: unknown) => typeof name === 'string' && /^[^/\\\x00-\x1f]{1,180}$/.test(name) && !name.startsWith('.') && !name.includes(':')

export function chatHost(o: Options) {
  const base = o.publicUrl.replace(/\/+$/, '')
  const resource = `${base}/mcp`
  const metadata = `${base}/.well-known/oauth-protected-resource/mcp`
  const linkMs = o.linkMs ?? 6 * 60 * 60_000
  // every worker runs the same AgentShot: its tools, as one gave them, for an hour
  let tools: { list: Tool[]; until: number } | undefined

  const json = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) =>
    res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body))

  /** The worker answers for the person, leasing again once if the one held is gone or no longer theirs. Only when it
   *  took nothing of the request (it couldn't be reached, or it refused the lease before doing anything): a call that
   *  broke off halfway may have run, and is never run again. [whole]: the request can be sent again after a refusal
   *  (not a file that arrives as it is sent). */
  async function onWorker<T>(person: Person, token: string | undefined, run: (w: Worker) => Promise<T>, whole = true): Promise<T> {
    const w = await o.people.worker(person, token)
    try { return await run(w) } catch (e) {
      if (!(e instanceof WorkerError) || !(e.unsent || (whole && e.status === 401))) throw e
      return run(await o.people.worker(person, token, true))
    }
  }

  async function toolList(person: Person, token: string) {
    if (!tools || tools.until < Date.now()) {
      const list = await onWorker(person, token, w => rpc(w, 'outside:tools', [])) as Tool[]
      tools = { list: [...list.filter(t => t.name !== 'add_files'), ADD_VIDEO, UPLOAD_START], until: Date.now() + 60 * 60_000 }
    }
    return tools.list
  }

  type Recent = { dir: string; title?: string }[]
  /** Which of their projects a call is about: named (folder, its name, or title), else the newest. */
  function pick(recent: Recent, name?: string) {
    if (!recent.length) throw new Error('There are no projects yet. Ask the user for a video: a link, or a file attached here, then add_video.')
    if (!name) return recent[0]
    const same = (a?: string) => !!a && a.toLowerCase() === name.toLowerCase()
    const found = recent.filter(p => p.dir === name || same(basename(p.dir)) || same(p.title))
    if (found.length === 1) return found[0]
    const names = recent.slice(0, 20).map(p => `"${basename(p.dir)}"${p.title ? ` (${p.title})` : ''}`).join(', ')
    throw new Error(found.length ? `More than one project is called "${name}". Use the folder name: ${names}.` : `No project is called "${name}". There are: ${names}.`)
  }

  async function call(person: Person, token: string, name: string, input: Any) {
    const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) })
    try {
      const { project, ...args } = input || {}
      const recent = await onWorker(person, token, w => rpc(w, 'project:recent', [])) as Recent
      if (name === 'projects') {
        return text(recent.length ? recent.map((p, i) => `${basename(p.dir)}: "${p.title || basename(p.dir)}"${i === 0 ? ' (used when no project is given)' : ''}`).join('\n') : 'No projects yet.')
      }
      if (name === 'upload_start') {
        if (!fileName(args.name)) throw new Error('That file name can’t be used. Rename the file and try again.')
        const size = Number(args.size)
        if (!Number.isSafeInteger(size) || size <= 0) throw new Error('The file is empty.')
        if (size > MAX_UPLOAD) throw new Error('The file is over 4 GB, more than AgentShot takes at once.')
        const dir = typeof project === 'string' && project ? pick(recent, project).dir : undefined
        const url = `${base}/upload/${signUpload(o.secret, { sub: person.sub, name: args.name, size, ...(dir ? { dir } : {}), exp: Date.now() + 60 * 60_000, key: o.people.keyOf(person.sub) })}`
        return { content: [{ type: 'text', text: 'Send the file there.' }], structuredContent: { url } }
      }
      // no projects yet: the editor opens on its start screen, to bring a video in
      if ((name === 'open_editor' || name === 'editor_view') && !recent.length) {
        return { content: [{ type: 'text', text: 'The editor is open on its start screen: there are no projects yet. The user can drop a video there, or give a link (add_video).' }], structuredContent: { start: true, upload: true, ...(name === 'open_editor' ? { openedAt: Date.now() } : {}) } }
      }
      if (name === 'add_video') {
        if (!o.addVideo) throw new Error('Adding videos isn’t available here.')
        if (typeof args.url !== 'string') throw new Error('Give the video’s https address.')
        const dir = typeof project === 'string' && project ? pick(recent, project).dir : undefined
        const made = await onWorker(person, token, w => o.addVideo!(w, args.url, dir))
        return text(`Added to "${basename(made.dir)}"${made.title ? ` (${made.title})` : ''}. Use project "${basename(made.dir)}".`)
      }
      const p = pick(recent, typeof project === 'string' && project ? project : undefined)
      const result = await onWorker(person, token, w => rpc(w, 'outside:call', [p.dir, name, args])) as Any
      // the page's files: through links signed here for this person and project
      if (result?.structuredContent?.media === WORKER_MEDIA) {
        result.structuredContent.media = `${base}/media/${signLink(o.secret, { sub: person.sub, dir: p.dir, exp: Date.now() + linkMs, key: o.people.keyOf(person.sub) })}/`
        result.structuredContent.upload = true
      }
      return result
    } catch (e) {
      return text((e as Error).message || 'That didn’t work.', true)
    }
  }

  function page() {
    // the page plays and shows files from here, and sends nothing anywhere else; Voiceover asks for the microphone
    const csp = { resourceDomains: [base], frameDomains: [base], connectDomains: [base] }
    return { contents: [{ uri: EDITOR_URI, mimeType: APP_MIME, text: o.page(), _meta: { ui: { csp, permissions: { microphone: {} }, prefersBorder: false } } }] }
  }

  async function mcp(req: IncomingMessage, res: ServerResponse) {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    let person: Person | undefined
    // Clerk not answering isn't "signed out": the chat would drop the connection and make them sign in again
    try { person = token ? await o.people.who(token) : undefined } catch {
      return json(res, 503, { error: 'AgentShot can’t check who is signed in just now. Try again in a moment.' }, { 'retry-after': '5' })
    }
    // not signed in (or no longer): where to sign in, as MCP has it
    if (!token || !person) return json(res, 401, { error: 'Connect AgentShot to sign in.' }, { 'www-authenticate': `Bearer resource_metadata="${metadata}"` })
    if (req.method !== 'POST') return json(res, 405, { error: 'Use POST.' }, { allow: 'POST' })
    const server = new Server({ name: 'agentshot', version: '1' }, { capabilities: { tools: {}, resources: {} }, instructions: INSTRUCTIONS })
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try { return { tools: await toolList(person, token) } } catch (e) { throw new McpError(-32000, e instanceof AccountError || e instanceof WorkerError ? e.message : 'AgentShot couldn’t list its tools.') }
    })
    server.setRequestHandler(CallToolRequestSchema, async r => call(person, token, r.params.name, r.params.arguments || {}) as never)
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: EDITOR_URI, name: 'AgentShot editor', mimeType: APP_MIME }] }))
    server.setRequestHandler(ReadResourceRequestSchema, async r => {
      if (r.params.uri !== EDITOR_URI) throw new McpError(-32002, `No resource ${r.params.uri}.`)
      return page()
    })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on('close', () => { void transport.close(); void server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res)
  }

  async function file(req: IncomingMessage, res: ServerResponse, path: string) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { allow: 'GET, HEAD' }).end()
    const m = /^\/media\/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\/(.+)$/.exec(path)
    const link = m && readLink(o.secret, m[1])
    if (!m || !link) return res.writeHead(404).end()
    let rel: string
    try { rel = decodeURIComponent(m[2]) } catch { return res.writeHead(404).end() }
    if (rel.split('/').some(s => !s || s === '..' || s.startsWith('.'))) return res.writeHead(404).end()
    const pass = ['range', 'if-range', 'if-none-match', 'if-match']
    const headers = Object.fromEntries(pass.filter(h => typeof req.headers[h] === 'string').map(h => [h, req.headers[h] as string]))
    if (link.key) o.people.know(link.sub, link.key)
    try {
      const up = await onWorker({ sub: link.sub }, undefined, async w => {
        const r = await media(w, link.dir, rel, headers, req.method)
        if (r.statusCode === 401) { r.resume(); throw new WorkerError(401, 'lease moved') }
        return r
      })
      const keep = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']
      res.writeHead(up.statusCode || 502, { ...Object.fromEntries(keep.filter(h => up.headers[h] != null).map(h => [h, String(up.headers[h])])), 'cache-control': 'private, max-age=300', 'access-control-allow-origin': '*' })
      up.pipe(res)
      res.on('close', () => up.destroy())
      // the worker went away halfway: the player hears of it and asks again from where it was, instead of waiting
      up.on('error', () => res.destroy())
      up.on('close', () => { if (!up.complete) res.destroy() })
    } catch { if (!res.headersSent) res.writeHead(502).end(); else res.destroy() }
  }

  /** PUT /upload/<link>: the file a page was given a link for, on to the person's worker as it arrives. */
  async function take(req: IncomingMessage, res: ServerResponse, path: string) {
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'PUT, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600' }
    if (req.method === 'OPTIONS') return res.writeHead(204, cors).end()
    if (req.method !== 'PUT') return json(res, 405, { error: 'Use PUT.' }, { ...cors, allow: 'PUT, OPTIONS' })
    const u = readUpload(o.secret, path.slice('/upload/'.length))
    if (!u) return json(res, 404, { error: 'This upload link has run out. Choose the file again.' }, cors)
    if (Number(req.headers['content-length']) !== u.size) return json(res, 400, { error: 'The file isn’t the size the page said.' }, cors)
    try {
      if (u.key) o.people.know(u.sub, u.key)
      // the bytes go on as they come, so another worker is leased only while none have been sent
      const made = await onWorker({ sub: u.sub }, undefined, w => upload(w, u.name, u.size, req, u.dir), false) as { dir?: string; title?: string } | null
      if (!made?.dir) throw new Error('AgentShot didn’t take the file.')
      json(res, 200, { folder: basename(made.dir), ...(made.title ? { title: made.title } : {}) }, cors)
    } catch (e) {
      req.resume()
      json(res, e instanceof WorkerError && e.status === 413 ? 413 : 502, { error: (e as Error).message || 'The file didn’t arrive. Try again.' }, cors)
    }
  }

  return async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url || '/', 'http://x').pathname
    try {
      if (path === '/healthz') return res.writeHead(200).end('ok')
      if (path === '/.well-known/oauth-protected-resource' || path === '/.well-known/oauth-protected-resource/mcp') {
        return json(res, 200, { resource, authorization_servers: [o.clerk.replace(/\/+$/, '')], bearer_methods_supported: ['header'], scopes_supported: ['openid', 'email', 'profile'], resource_name: 'AgentShot' }, { 'access-control-allow-origin': '*' })
      }
      if (path === '/mcp') return await mcp(req, res)
      if (path.startsWith('/media/')) return await file(req, res, path)
      if (path.startsWith('/upload/')) return await take(req, res, path)
      json(res, 404, { error: 'Not found.' })
    } catch (e) {
      console.error(e)
      if (!res.headersSent) json(res, 500, { error: 'AgentShot couldn’t answer. Try again in a moment.' })
    }
  }
}
