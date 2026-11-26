// The AgentShot plugin's launcher: what Claude Code starts for the plugin. It is the Node twin of the app's own launcher
// (scripts/launcher/src/main.rs), so it runs anywhere Claude Code does (Windows too) straight from the plugin folder.
// It reads one JSON-RPC message per line and passes each to AgentShot's MCP server on this computer (src/main/mcp.ts)
// with the port and token from AgentShot's state file, read afresh every time, so a new token or port needs no new
// setup and the token is never in any agent's settings. While AgentShot is closed, the questions an agent asks just to
// get ready (initialize, ping, the tools as AgentShot last listed them) are answered here; the first real request
// opens AgentShot (when it knows how) and waits for it.
import { request } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import { VERSION } from './version'

const PROTOCOL = '2025-06-18'
export const SWITCH_ON = 'Editing from other agents is switched off in AgentShot. Ask the user to open AgentShot\'s Settings → Keys and switch on "Edit from Claude Code or Codex".'
export const NOT_OPEN = 'AgentShot isn\'t open. Ask the user to open it, then try again.'
const INSTRUCTIONS = 'AgentShot is a video editor on this computer. These tools edit the project the user has open in it; start with project_state.'

type Env = Record<string, string | undefined>
/** AgentShot's state file (src/main/index.ts keeps it in the app's settings folder), or AGENTSHOT_STATE. */
export function defaultStateFile(env: Env, platform: NodeJS.Platform, home: string) {
  if (env.AGENTSHOT_STATE) return env.AGENTSHOT_STATE
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'AgentShot', 'outside.json')
  if (platform === 'win32') return join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'AgentShot', 'outside.json')
  return join(env.XDG_CONFIG_HOME || join(home, '.config'), 'AgentShot', 'outside.json')
}

type State = { enabled: boolean; port: number; token: string }
async function readState(file: string): Promise<State | undefined> {
  try {
    const v = JSON.parse(await readFile(file, 'utf8'))
    const port = Number(v?.port)
    return { enabled: v?.enabled === true, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 0, token: typeof v?.token === 'string' ? v.token : '' }
  } catch { return undefined }
}

type Sent = { status: number; body: string } | 'closed'

/** One message to AgentShot and its answer. A tool call may run a long time (a render), so the answer is never timed
 *  out; only the connection is. Nothing listening counts as closed. */
function send(state: State, from: string, message: string): Promise<Sent> {
  return new Promise((ok, fail) => {
    let connected = false
    const req = request({
      host: '127.0.0.1', port: state.port, path: '/mcp', method: 'POST', agent: false,
      headers: {
        host: `127.0.0.1:${state.port}`, authorization: `Bearer ${state.token}`, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'user-agent': 'agentshot-mcp', 'x-agentshot-from': from,
        'content-length': String(Buffer.byteLength(message)), connection: 'close',
      },
    }, res => {
      const parts: Buffer[] = []
      res.on('data', (p: Buffer) => parts.push(p))
      res.on('end', () => ok({ status: res.statusCode || 0, body: Buffer.concat(parts).toString('utf8').trim() }))
      res.on('error', fail)
    })
    const timer = setTimeout(() => { if (!connected) req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })) }, 2_000)
    req.on('socket', s => s.once('connect', () => { connected = true; clearTimeout(timer) }))
    req.on('error', e => {
      clearTimeout(timer)
      connected ? fail(e) : ok('closed')
    })
    req.end(message)
  })
}

type Id = string | number
const error = (id: Id | null, message: string, code = -32000) => JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })
const result = (id: Id, value: unknown) => JSON.stringify({ jsonrpc: '2.0', id, result: value })

/** An answer on one line: JSON from AgentShot, made compact (a string can't hold a raw newline, so nothing is lost). */
function oneLine(body: string) {
  try { return JSON.stringify(JSON.parse(body)) } catch { return body.replace(/\r?\n/g, ' ') }
}

export type LauncherOptions = {
  stateFile: string
  /** Who AgentShot says is at work while this agent uses a tool. */
  from?: string
  /** Opens AgentShot in the background; without it, a closed AgentShot is only reported. */
  openApp?: () => void
  /** How long to wait for AgentShot to listen once opened, and how often to look. */
  waitMs?: number
  intervalMs?: number
}

export class Launcher {
  private opened = false
  private readonly from: string
  constructor(private o: LauncherOptions) {
    this.from = (o.from || 'Another agent').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 40) || 'Another agent'
  }
  private get toolsFile() { return join(dirname(this.o.stateFile), 'outside-tools.json') }

  private async trySend(line: string): Promise<Sent> {
    const s = await readState(this.o.stateFile)
    return s && s.enabled && s.port && s.token ? send(s, this.from, line) : 'closed'
  }

  /** What can be answered without AgentShot: getting ready, and the tools as it last listed them. */
  private async answerClosed(msg: { id: Id; method: string; params?: { protocolVersion?: unknown } }) {
    if (msg.method === 'initialize') {
      const asked = msg.params?.protocolVersion
      return result(msg.id, { protocolVersion: typeof asked === 'string' ? asked : PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'agentshot', version: VERSION }, instructions: INSTRUCTIONS })
    }
    if (msg.method === 'ping') return result(msg.id, {})
    if (msg.method === 'tools/list') {
      try {
        const tools = JSON.parse(await readFile(this.toolsFile, 'utf8'))
        if (Array.isArray(tools)) return result(msg.id, { tools })
      } catch { /* none kept yet: AgentShot has to answer */ }
    }
    return undefined
  }

  /** The line to write back for one message, if it is owed an answer. */
  async handle(line: string): Promise<string | undefined> {
    let msg: { id?: Id | null; method?: unknown; params?: { protocolVersion?: unknown } }
    try { msg = JSON.parse(line) } catch { return error(null, 'Not JSON.', -32700) }
    if (!msg || typeof msg !== 'object') return error(null, 'Not JSON.', -32700)
    const id = msg.id ?? null
    let sent: Sent
    try { sent = await this.trySend(line) } catch (e) { return id === null ? undefined : error(id, `AgentShot stopped answering (${(e as Error).message}).`) }
    if (sent === 'closed') {
      // a note to the server, or a reply to it: nothing to say back
      if (id === null || typeof msg.method !== 'string') return undefined
      const ready = await this.answerClosed({ id, method: msg.method, params: msg.params })
      if (ready) return ready
      // switched off (or never on): opening AgentShot wouldn't switch it on, so say so at once
      if (!(await readState(this.o.stateFile))?.enabled) return error(id, SWITCH_ON)
      // a real request: open AgentShot (once), then wait for it to listen
      if (this.o.openApp && !this.opened) {
        this.opened = true
        try { this.o.openApp() } catch { /* then it's reported as not open */ }
        const until = Date.now() + (this.o.waitMs ?? 40_000)
        while (sent === 'closed' && Date.now() < until) {
          await new Promise(ok => setTimeout(ok, this.o.intervalMs ?? 250))
          try { sent = await this.trySend(line) } catch (e) { return error(id, `AgentShot stopped answering (${(e as Error).message}).`) }
        }
      }
      if (sent === 'closed') {
        const s = await readState(this.o.stateFile)
        return error(id, !s?.enabled ? SWITCH_ON : NOT_OPEN)
      }
    }
    if (sent.status === 200 && sent.body) return oneLine(sent.body)
    // taken note of (202), or an empty answer: nothing to pass on
    if (sent.status >= 200 && sent.status < 300) return undefined
    if (id === null) return undefined
    let said: unknown
    try { said = JSON.parse(sent.body)?.error?.message } catch { /* not JSON */ }
    return error(id, typeof said === 'string' && said ? said : 'AgentShot refused the request.')
  }
}

/** Reads messages from [input] one per line and writes each answer on a line of its own, one message at a time. */
export async function serve(input: Readable, output: Writable, launcher: Launcher) {
  const lines = createInterface({ input, crlfDelay: Infinity })
  for await (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const answer = await launcher.handle(line)
    if (answer !== undefined && !output.write(`${answer}\n`)) await new Promise(ok => output.once('drain', ok))
  }
}
