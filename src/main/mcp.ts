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
import { basename, dirname, isAbsolute, join } from 'node:path'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { OutsideStatus } from '../shared/outside'

type Any = Record<string, any>
type Block = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
export type ToolResult = { content: Block[]; isError?: boolean }
export type OutsideTool = { name: string; description: string; parameters: Any }

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
}

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

/** Every tool an outside agent sees, each taking an optional project. */
export function toolList(editor: Editor) {
  return [...OWN, ...editor.tools()].map(t => ({
    name: t.name, description: t.description,
    inputSchema: { ...t.parameters, type: 'object', properties: { ...(t.name === 'projects' ? {} : { project: PROJECT }), ...t.parameters.properties } },
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
export async function callTool(editor: Editor, name: string, input: Any | undefined, signal: AbortSignal, who = 'Another agent'): Promise<ToolResult> {
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
    return tools
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

  private async answer(req: IncomingMessage, res: ServerResponse) {
    const refuse = (status: number, message: string, headers: Record<string, string> = {}) =>
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }))
    const port = this.saved.port
    if (req.headers.origin !== undefined) return refuse(403, 'AgentShot does not answer web pages.')
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return refuse(403, 'Wrong host.')
    if (new URL(req.url || '/', 'http://x').pathname !== '/mcp') return refuse(404, 'Not found.')
    const given = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1]
    if (!this.saved.token || !given || !sameToken(given, this.saved.token)) return refuse(401, 'Set AgentShot up again from Settings → Keys: this token is not the current one.')
    // each request stands alone (no session to keep or lose), so only POST means anything
    if (req.method !== 'POST') return refuse(405, 'Use POST.', { allow: 'POST' })
    const gone = new AbortController()
    const server = new Server({ name: SERVER_NAME, version: '1' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })
    const who = whoOf(req.headers)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.tools() }))
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
      callTool(this.editor, request.params.name, request.params.arguments, AbortSignal.any([gone.signal, extra.signal]), who))
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    // the agent hung up (or was stopped) mid-call: stop the work it asked for
    res.on('close', () => { if (!res.writableEnded) gone.abort(); void transport.close(); void server.close() })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res)
    } catch { if (!res.headersSent) refuse(500, 'AgentShot could not answer.') }
  }
}
