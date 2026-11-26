// AgentShot as an MCP server: Claude Code, Codex or any other agent on this computer can edit a project that is open
// in AgentShot, with the editor's own tools. What it changes shows up in the app as it would from AgentShot's own
// agent: a new cut arrives as a before/after to keep or send back.
//
// It is off until switched on (Settings → Keys). It listens on this computer only (127.0.0.1) and every request must
// carry the token AgentShot made. A web page can't use it: a request that names an Origin, or asks for another Host
// (DNS rebinding), is refused before the token is looked at.
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { open as openFile, readFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, sep } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, McpError, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { OutsideStatus } from '../shared/outside'
import type { Project } from '../shared/types'
import { APP_MIME, EDITOR_CALLS, EDITOR_URI, editorView, servable } from '../shared/editor-view'
import { mobileArgs, mobileSchemas, projectArgument } from './mobile-contract'
import { z } from 'zod'
import { serveMobileMedia } from './mobile-media'

type Any = Record<string, any>
type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: Block[]; isError?: boolean; structuredContent?: Any }
export type OutsideTool = { name: string; description: string; parameters: Any; _meta?: Any }

/** What the server needs from the app. */
export type Editor = {
  /** The editor's tools an outside agent may use, or nothing while the agent hasn't started. */
  tools(): OutsideTool[]
  call(dir: string, name: string, args: Any, signal: AbortSignal): Promise<ToolResult>
  /** The projects open in AgentShot, the one opened last at the end. */
  projects(): { dir: string; title: string }[]
  /** Copy a file, folder or .zip from anywhere on this computer into the project; a line per new file. */
  addFiles(dir: string, absPath: string): Promise<string[]>
  /** An outside agent is using a tool on a project: who it says it is, for showing in the app. */
  seen?(who: string, dir: string, tool: string): void
  /** An open project as it is now, and whether its film changed since the current version was rendered: what the
   *  editor page inside Claude or ChatGPT shows. Without it there is no editor page. */
  snapshot?(dir: string): { project: Project; edited: boolean } | undefined
  /** The editor page (src/mcp-app, built into one HTML file). */
  page?(): string
  /** A light copy of a project file for the editor page to play (small, H.264), made once: its absolute path. */
  preview?(dir: string, rel: string, signal: AbortSignal): Promise<string>
  /** Runs one of the app's own calls (as the phone's bridge does) for the editor page: see EDITOR_CALLS. */
  invoke?(method: string, args: unknown[]): Promise<unknown>
}

/** Where the editor page's files are, as a cloud worker says it: the hosted server (chat-host) puts its own address there. */
export const WORKER_MEDIA = 'agentshot-worker-media:/'

/** The name the server goes by in an agent's list of MCP servers. */
export const SERVER_NAME = 'agentshot'
/** Where it listens unless that port is taken (then any free one, which is remembered). */
export const DEFAULT_PORT = 48620

const INSTRUCTIONS =
  `AgentShot is a video editor running on this computer. These tools edit the project the user has open in it; the user ` +
  `watches the result there.\n` +
  `- Start with project_state: the versions, the current one, the edit's pieces, open notes and the files in media/.\n` +
  `- Know the footage before deciding: transcript (words with times), analyze_video (shots, shake, exposure, loudness, ` +
  `silence), speakers (who speaks when), find_subjects (faces and objects), look (frames at chosen times).\n` +
  `- Plain cuts, trims, reordering and volume: edit_timeline. It changes the edit at once, without rendering, and the ` +
  `user can undo it. Cut speech on the transcript's word times.\n` +
  `- Anything else: the ffmpeg tool (read the current version, write to renders/, never overwrite media/), then ` +
  `propose_version. The user sees a before/after and keeps it or sends it back; make one proposal per request.\n` +
  `- Titles, lower thirds and captions are motion clips: create_clip, then insert_clip or overlay_clip.\n` +
  `- To use a file from elsewhere on this computer, add it with add_files first.\n` +
  `- Every tool takes an optional "project" (a name from the projects tool) when more than one is open.\n` +
  `The project folder is yours to read; change the film only through these tools.`

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) })

/** The open project a call is about: the one named (by title or folder), else the one opened last. */
export function pickProject(open: { dir: string; title: string }[], name?: string) {
  if (!open.length) throw new Error('No project is open in AgentShot. Ask the user to open one.')
  if (!name) return open[open.length - 1]
  const same = (a: string) => a.toLowerCase() === name.toLowerCase()
  const found = open.filter(p => p.dir === name || same(basename(p.dir)) || same(p.title))
  if (found.length === 1) return found[0]
  const names = open.map(p => `"${basename(p.dir)}" (${p.title})`).join(', ')
  throw new Error(found.length ? `More than one open project is called "${name}". Use the folder name: ${names}.` : `No open project is called "${name}". Open: ${names}.`)
}

const PROJECT = { type: 'string', description: 'Which open project (a name from the projects tool). Leave out for the one opened last.' }
const OWN: OutsideTool[] = [
  { name: 'projects', description: 'The projects open in AgentShot now: folder name, title and folder. The last one is used when a tool is given no project.',
    parameters: { type: 'object', properties: {} } },
  { name: 'add_files', description: 'Copy a file, folder or .zip from anywhere on this computer into the project\'s media, so it can be used in the edit. Returns each new path in media/ and what the file is.',
    parameters: { type: 'object', properties: { path: { type: 'string', description: 'absolute path on this computer' } }, required: ['path'] } },
]

// The editor inside the chat (an MCP App, which Claude and ChatGPT both show): open_editor brings it up; the page then
// keeps itself up to date with editor_view and edits with the tools the model has (edit_timeline, decide_version…).
// The old key is what ChatGPT read before MCP Apps; it does no harm elsewhere.
const EDITOR: OutsideTool[] = [
  { name: 'open_editor', description: 'Show the user AgentShot\'s editor right here in the chat: the film to play, its pieces on a timeline, and the cut waiting for review to keep or send back. Use it when the user wants to see, play or review the film, or edit it by hand.',
    parameters: { type: 'object', properties: {} }, _meta: { ui: { resourceUri: EDITOR_URI }, 'openai/outputTemplate': EDITOR_URI } },
  { name: 'editor_view', description: 'For the editor page only: the project as the page shows it.',
    parameters: { type: 'object', properties: {} }, _meta: { ui: { resourceUri: EDITOR_URI, visibility: ['app'] } } },
]
// A chat's frame may not load video from this computer (a page on the internet reaching 127.0.0.1). Then the page gets
// a light copy of each file through MCP itself, a piece at a time: base64 of whole 3-byte groups, so pieces join.
const MEDIA_TOOL: OutsideTool = {
  name: 'editor_media', description: 'For the editor page only: a light copy of a film file, a piece at a time.',
  parameters: { type: 'object', properties: { src: { type: 'string' }, offset: { type: 'number' } }, required: ['src'] },
  _meta: { ui: { resourceUri: EDITOR_URI, visibility: ['app'] } },
}
export const MEDIA_PIECE = 3 * 512 * 1024
const VIDEO = /\.(mp4|mov|m4v|webm|mkv|avi|mts|m2ts|mpg|mpeg|3gp)$/i
const MIME: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}
// The film panel's own calls to the app, from the page (the same ones the window makes; checked as the phone's are)
const CALL_TOOL: OutsideTool = {
  name: 'editor_call', description: 'For the editor page only: one of the film panel\'s calls to AgentShot.',
  parameters: { type: 'object', properties: { method: { type: 'string' }, args: { type: 'array' } }, required: ['method', 'args'] },
  _meta: { ui: { resourceUri: EDITOR_URI, visibility: ['app'] } },
}
// The panel's calls the phone doesn't make (voiceover, revealing and downloading on this computer, export for another
// editor, the loudness choice of export) are checked here; the rest as the phone's are.
const DIR = z.string().min(1).max(4096)
const REL = z.string().min(1).max(4096).refine(s => !s.startsWith('/') && !s.includes('\\') && !s.split('/').some(x => x === '..' || x === '') && !s.includes('\0'))
const ownSchemas: Record<string, z.ZodType<unknown[]>> = {
  'export:run': z.tuple([DIR, z.object({ preset: z.enum(['original', 'landscape', 'vertical', 'square']), fit: z.enum(['pad', 'crop']).optional(), captions: z.enum(['none', 'burn', 'srt']), captionColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), loudness: z.enum(['none', 'online', 'podcast']).optional() }).strict()]),
  'export:editors': z.tuple([DIR]),
  'export:reveal': z.tuple([z.string().min(1).max(4096)]),
  'project:reveal': z.tuple([DIR]),
  'project:revealFile': z.tuple([DIR, REL]),
  'project:downloadFile': z.tuple([DIR, REL]),
  'voiceover:access': z.tuple([]),
  'voiceover:begin': z.tuple([z.string().min(1).max(4096), z.number().finite().min(0).max(86400)]),
  'voiceover:cancel': z.tuple([z.string().min(1).max(200)]),
  'voiceover:save': z.tuple([z.string().min(1).max(200), z.string().max(200 * 1024 * 1024).regex(/^[A-Za-z0-9+/]*={0,2}$/), z.array(z.number().finite()).max(100_000)]),
}
/** The call's arguments, checked; the project it is about must be the page's own. */
function editorArgs(method: string, args: unknown, dir: string): unknown[] {
  if (!(EDITOR_CALLS as readonly string[]).includes(method)) throw new Error(`The editor can’t ask AgentShot for ${method}.`)
  const checked = Object.hasOwn(ownSchemas, method) ? ownSchemas[method].parse(args) : Object.hasOwn(mobileSchemas, method) ? mobileArgs(method, args) : []
  const about = projectArgument(method) || /^(voiceover:begin|export:editors|project:(reveal|revealFile|downloadFile))$/.test(method)
  if (about && checked[0] !== dir) throw new Error('The editor can only change the project it shows.')
  // what's shown in the file manager is an export of this project
  if (method === 'export:reveal' && !String(checked[0]).startsWith(dir + sep)) throw new Error('The editor can only show this project’s files.')
  return method === 'voiceover:save' ? [checked[0], new Uint8Array(Buffer.from(checked[1] as string, 'base64')), checked[2]] : checked
}
const hasEditor = (editor: Editor) => !!editor.snapshot && !!editor.page

/** Every tool an outside agent sees, each taking an optional project. */
export function toolList(editor: Editor) {
  return [...OWN, ...(hasEditor(editor) ? [...EDITOR, ...(editor.preview ? [MEDIA_TOOL] : []), ...(editor.invoke ? [CALL_TOOL] : [])] : []), ...editor.tools()].map(t => ({
    name: t.name, description: t.description,
    inputSchema: { ...t.parameters, type: 'object', properties: { ...(t.name === 'projects' ? {} : { project: PROJECT }), ...t.parameters.properties } },
    ...(t._meta ? { _meta: t._meta } : {}),
  }))
}

/** Who is calling, for showing in the app: what the launcher was told, else what the client calls itself. Never trusted for anything. */
export function whoOf(headers: { [name: string]: string | string[] | undefined }) {
  const from = String(headers['x-agentshot-from'] || '').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 40)
  if (from) return from
  const agent = String(headers['user-agent'] || '')
  return /claude/i.test(agent) ? 'Claude Code' : /codex/i.test(agent) ? 'Codex' : /cursor/i.test(agent) ? 'Cursor' : 'Another agent'
}

/** Runs one tool call. A failure is an answer the agent can read and act on, never a broken connection. */
export async function callTool(editor: Editor, name: string, input: Any | undefined, signal: AbortSignal, who = 'Another agent', media?: (dir: string) => string): Promise<ToolResult> {
  try {
    const { project, ...args } = input || {}
    const open = editor.projects()
    if (name === 'projects') {
      return text(open.length ? open.map((p, i) => `${basename(p.dir)}: "${p.title}" in ${p.dir}${i === open.length - 1 ? ' (used when no project is given)' : ''}`).join('\n') : 'No project is open in AgentShot.')
    }
    const p = pickProject(open, typeof project === 'string' && project ? project : undefined)
    editor.seen?.(who, p.dir, name)
    if (name === 'add_files') {
      if (typeof args.path !== 'string' || !isAbsolute(args.path)) throw new Error('Give the absolute path of a file or folder on this computer.')
      if (!existsSync(args.path)) throw new Error(`No file at ${args.path}.`)
      return text(`Added:\n${(await editor.addFiles(p.dir, args.path)).join('\n')}`)
    }
    if ((name === 'open_editor' || name === 'editor_view') && hasEditor(editor)) {
      const now = editor.snapshot!(p.dir)
      if (!now || !media) throw new Error('AgentShot can’t show this project here.')
      const view = editorView(now.project, { base: media(p.dir), folder: basename(p.dir), edited: now.edited })
      const pr = now.project, waiting = pr.proposal && pr.versions.find(v => v.id === pr.proposal)
      const said = `The editor is open on "${pr.title}" (${pr.timeline?.items.length ?? 0} pieces${now.edited ? ', edited since the last version' : ''}).` +
        (waiting ? ` A cut is waiting for review: "${waiting.title}". The user can keep it or send it back there.` : '')
      // opening it (not looking again): when, so the page asks to go beside the chat only now, never when the chat
      // draws this card again later
      return { content: [{ type: 'text', text: said }], structuredContent: { ...view, ...(name === 'open_editor' ? { openedAt: Date.now() } : {}) } as unknown as Any }
    }
    if (name === 'editor_call' && hasEditor(editor) && editor.invoke) {
      const method = String(args.method)
      const checked = editorArgs(method, args.args, p.dir)
      let value = await editor.invoke(method, checked)
      // thumbnails are files in the project's cache: as pictures, they show whichever way the page gets its video
      if (method === 'media:thumbnails' && Array.isArray(value)) {
        value = await Promise.all(value.map(async f => typeof f === 'string' && f.startsWith(p.dir) ? `data:image/jpeg;base64,${(await readFile(f)).toString('base64')}` : ''))
      }
      return { content: [{ type: 'text', text: `${method} done.` }], structuredContent: { value: value ?? null } }
    }
    if (name === 'editor_media' && hasEditor(editor) && editor.preview) {
      const now = editor.snapshot!(p.dir)
      const offset = Number(args.offset ?? 0)
      if (!now || typeof args.src !== 'string' || !servable(now.project, args.src)) throw new Error('That file isn’t part of the film.')
      if (!Number.isSafeInteger(offset) || offset < 0 || offset % 3) throw new Error('offset must be where a previous piece ended.')
      // video as a light copy; a picture, a sound or a clip's page as it is
      const video = VIDEO.test(args.src)
      const file = video ? await editor.preview(p.dir, args.src, signal) : join(p.dir, args.src)
      const mime = video ? 'video/mp4' : MIME[extname(args.src).toLowerCase()] || 'application/octet-stream'
      const handle = await openFile(file, 'r')
      try {
        const size = (await handle.stat()).size
        const { bytesRead, buffer } = await handle.read(Buffer.alloc(Math.max(0, Math.min(MEDIA_PIECE, size - offset))), 0, Math.max(0, Math.min(MEDIA_PIECE, size - offset)), offset)
        return { content: [{ type: 'text', text: `${bytesRead} bytes of ${size}` }], structuredContent: { mime, size, offset, base64: buffer.subarray(0, bytesRead).toString('base64') } }
      } finally { await handle.close() }
    }
    if (!editor.tools().some(t => t.name === name)) throw new Error(`AgentShot has no tool called ${name}.`)
    return await editor.call(p.dir, name, args, signal)
  } catch (e) {
    return text(signal.aborted ? 'Cancelled.' : (e as Error).message || 'That didn’t work.', true)
  }
}

type Saved = { enabled: boolean; port?: number; token?: string }
const sameToken = (a: string, b: string) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())

export class OutsideAccess {
  private saved: Saved = { enabled: false }
  private http?: HttpServer
  private problem?: string
  /** The editor page's media addresses: a random key per project, made afresh every time it's switched on. Holding
   *  one lets a page play that project's film (and nothing else); nobody gets one without the token. */
  private keys = new Map<string, string>()
  private mediaBase(dir: string) {
    let key = [...this.keys].find(([, d]) => d === dir)?.[0]
    if (!key) { key = randomBytes(24).toString('base64url'); this.keys.set(key, dir) }
    return `http://127.0.0.1:${this.saved.port}/media/${key}/`
  }
  /** `file` remembers the switch, the port and the token (readable by this user only). */
  constructor(private file: string, private editor: Editor, private port = DEFAULT_PORT) {
    try { const s = JSON.parse(readFileSync(file, 'utf8')); this.saved = { enabled: s.enabled === true, port: Number(s.port) || undefined, token: typeof s.token === 'string' ? s.token : undefined } } catch { /* never switched on */ }
  }
  private save() { writeFileSync(this.file, JSON.stringify(this.saved), { mode: 0o600 }) }
  /** The state file the launcher (scripts/launcher) reads for the port and the token. */
  get stateFile() { return this.file }
  private listed = ''
  /** The tools as last listed, kept beside the state file: the launcher answers with them while AgentShot is closed. */
  private tools() {
    const tools = toolList(this.editor)
    const json = JSON.stringify(tools)
    if (this.editor.tools().length && json !== this.listed) {
      this.listed = json
      try { writeFileSync(join(dirname(this.file), 'outside-tools.json'), json) } catch { /* the launcher then asks AgentShot itself */ }
    }
    this.keepPage()
    return tools
  }
  private kept = ''
  /** The editor page as last served, kept beside the tools: the launcher answers with it while AgentShot is closed,
   *  so a chat getting ready doesn't open AgentShot just to look at the page. */
  private keepPage() {
    if (!hasEditor(this.editor)) return
    let json: string
    try { json = JSON.stringify({ resources: this.resources(), read: { [EDITOR_URI]: this.readPage() } }) } catch { return }
    if (json === this.kept) return
    this.kept = json
    try { writeFileSync(join(dirname(this.file), 'outside-resources.json'), json) } catch { /* the launcher then asks AgentShot itself */ }
  }
  private resources() { return [{ uri: EDITOR_URI, name: 'AgentShot editor', mimeType: APP_MIME }] }
  private readPage() {
    // the page may load video and pictures from this server, show a clip's page from it, and reach nothing else; it
    // asks for the microphone for Voiceover
    const here = `http://127.0.0.1:${this.saved.port}`
    const csp = { resourceDomains: [here], frameDomains: [here], connectDomains: [] }
    return { contents: [{ uri: EDITOR_URI, mimeType: APP_MIME, text: this.editor.page!(), _meta: { ui: { csp, permissions: { microphone: {} }, prefersBorder: false } } }] }
  }

  get url() { return `http://127.0.0.1:${this.saved.port}/mcp` }
  status(): OutsideStatus {
    return { enabled: this.saved.enabled, running: !!this.http?.listening, ...(this.http?.listening ? { url: this.url } : {}), ...(this.problem ? { problem: this.problem } : {}) }
  }
  /** How another agent is told about this server: Claude Code's own command, and the entry most others read. Both
   *  carry the token, so they go to the clipboard and nowhere else. */
  setup() {
    if (!this.saved.enabled || !this.saved.token) throw new Error('Switch it on first.')
    const header = `Authorization: Bearer ${this.saved.token}`
    return {
      url: this.url, token: this.saved.token,
      command: `claude mcp add --scope user --transport http ${SERVER_NAME} ${this.url} --header "${header}"`,
      json: JSON.stringify({ mcpServers: { [SERVER_NAME]: { type: 'http', url: this.url, headers: { Authorization: `Bearer ${this.saved.token}` } } } }, null, 2),
    }
  }

  /** Listen again if it was left on (app start). */
  async start() { if (this.saved.enabled) await this.listen() }
  /** Switching it on makes a new token; switching it off forgets it, so agents set up before can no longer get in. */
  async set(on: boolean) {
    if (on === this.saved.enabled && (!on || this.http?.listening)) return this.status()
    await this.stop()
    this.saved = on ? { enabled: true, port: this.saved.port, token: randomBytes(32).toString('base64url') } : { enabled: false, port: this.saved.port }
    this.save()
    if (on) await this.listen()
    return this.status()
  }
  async stop() {
    this.keys.clear()
    const h = this.http
    this.http = undefined
    if (h) await new Promise<void>(done => { h.close(() => done()); h.closeAllConnections() })
  }

  private async listen() {
    this.problem = undefined
    const bind = (port: number) => new Promise<HttpServer>((ok, fail) => {
      const h = createServer((req, res) => { void this.answer(req, res) })
      h.once('error', fail)
      h.listen(port, '127.0.0.1', () => { h.off('error', fail); ok(h) })
    })
    try {
      // the port stays the same from one start to the next, so an agent set up once keeps working
      this.http = await bind(this.saved.port || this.port).catch(e => { if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') return bind(0); throw e })
      const port = (this.http.address() as { port: number }).port
      if (port !== this.saved.port) { this.saved.port = port; this.save() }
    } catch { this.problem = 'AgentShot couldn’t start listening on this computer. Switch it off and on again.' }
  }

  /** GET /media/<key>/<file in the project>: a file the editor page plays, in ranges. Anything else is not found. */
  private async media(req: IncomingMessage, res: ServerResponse, path: string) {
    const missing = () => res.writeHead(404).end()
    if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405, { allow: 'GET, HEAD' }).end()
    const m = /^\/media\/([A-Za-z0-9_-]+)\/(.+)$/.exec(path)
    const dir = m && this.keys.get(m[1])
    if (!m || !dir) return missing()
    let rel: string
    try { rel = decodeURIComponent(m[2]) } catch { return missing() }
    const now = this.editor.snapshot?.(dir)
    if (!now || !servable(now.project, rel)) return missing()
    try { await serveMobileMedia(req, res, join(dir, rel)) } catch { if (!res.headersSent) missing(); else res.destroy() }
  }

  private async answer(req: IncomingMessage, res: ServerResponse) {
    const refuse = (status: number, message: string, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
    const port = this.saved.port
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return refuse(403, 'Wrong host.')
    const path = new URL(req.url || '/', 'http://x').pathname
    // the editor page's video: from the chat's frame (a web page), with the key in the address instead of the token
    if (path.startsWith('/media/')) return this.media(req, res, path)
    if (req.headers.origin !== undefined) return refuse(403, 'AgentShot does not answer web pages.')
    if (path !== '/mcp') return refuse(404, 'Not found.')
    const given = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    if (!this.saved.token || !given || !sameToken(given, this.saved.token)) return refuse(401, 'Set AgentShot up again from Settings → Keys: this token is not the current one.')
    // each request stands alone (no session to keep or lose), so only POST means anything
    if (req.method !== 'POST') return refuse(405, 'Use POST.', { allow: 'POST' })
    const gone = new AbortController()
    const app = hasEditor(this.editor)
    const server = new Server({ name: SERVER_NAME, version: '1' }, { capabilities: { tools: {}, ...(app ? { resources: {} } : {}) }, instructions: INSTRUCTIONS })
    const who = whoOf(req.headers)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools() }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      callTool(this.editor, request.params.name, request.params.arguments, AbortSignal.any([gone.signal, extra.signal]), who, dir => this.mediaBase(dir)))
    if (app) {
      server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: this.resources() }))
      server.setRequestHandler(ReadResourceRequestSchema, async request => {
        if (request.params.uri !== EDITOR_URI) throw new McpError(-32002, `No resource ${request.params.uri}.`)
        return this.readPage()
      })
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    // the agent hung up (or was stopped) mid-call: stop the work it asked for
    res.on('close', () => { if (!res.writableEnded) gone.abort(); void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch { if (!res.headersSent) refuse(500, 'AgentShot could not answer.') }
  }
}
