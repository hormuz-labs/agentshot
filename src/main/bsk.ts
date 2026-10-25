// BrowserSkill (bsk) for the agent. By default AgentShot runs its own copy, fully private: the bundled CLI, a daemon in
// AgentShot's own home (never ~/.bsk) on a port other than bsk's default 52800, and the extension running inside AgentShot's
// embedded browser, preset to that port. A bsk extension the user installed in Chrome only knows 52800 and its own
// daemon, so it never sees AgentShot's daemon, and the agent's bsk calls never reach the user's Chrome.
// Settings → Browser can switch the agent to the user's own Chrome bsk instead (their logins), on purpose.
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { delimiter, dirname, join, resolve, win32 } from 'node:path'
import { promisify } from 'node:util'
import { BIN } from './media'
import { envPath } from './paths'

const run = promisify(execFile)

export const BSK_BIN = join(BIN, process.platform === 'win32' ? 'bsk.exe' : 'bsk')
/** bsk's own default WebSocket port: what every Chrome extension connects to unless told otherwise. */
export const DEFAULT_PORT = 52800
import type { BrowserMode, ChromeBsk } from '../shared/types'
export type { BrowserMode }

/** AgentShot's bsk home. macOS caps unix socket paths (~104 bytes), so a very long userData falls back to a short folder
 *  ~/.manul/bsk-<hash of userData> (one per AgentShot install, so two never share a daemon). */
export function privateHome(userData: string, home: string, platform = process.platform): string {
  const h = join(userData, 'bsk')
  return platform !== 'darwin' || Buffer.byteLength(join(h, 'run', 'daemon.sock')) <= 100 ? h : join(home, '.manul', `bsk-${createHash('sha256').update(userData).digest('hex').slice(0, 8)}`)
}

/** A free loopback port, never bsk's default. */
export async function freePort(avoid: number[] = []): Promise<number> {
  for (let i = 0; i < 20; i++) {
    const port = await new Promise<number>((ok, no) => {
      const s = createServer()
      s.once('error', no)
      s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)) })
    })
    if (port !== DEFAULT_PORT && !avoid.includes(port)) return port
  }
  throw new Error('No free port for the browser daemon.')
}

export function daemonArgs(port: number): string[] {
  if (port === DEFAULT_PORT) throw new Error(`Refusing bsk's default port ${DEFAULT_PORT}: the user's Chrome extension would connect to it.`)
  return ['daemon', 'start', '--foreground', '--port', String(port), '--daemon-idle', '8760h', '--session-idle', '30m']
}

/** chrome.storage.local preset for the extension inside AgentShot's browser. */
export const extensionStorage = (port: number) => ({ bsk_daemon_port: port, bh_label: 'AgentShot', bh_connection_enabled: true })

/** The user's own bsk CLI (the one their Chrome extension pairs with), never AgentShot's bundled copy. */
export function findUserBsk({ home, bundled, path, platform = process.platform }: { home: string; bundled: string; path?: string; platform?: NodeJS.Platform }): string | null {
  const p = platform === 'win32' ? win32 : { join, dirname, resolve, delimiter }
  const name = platform === 'win32' ? 'bsk.exe' : 'bsk'
  path ??= environmentPath(process.env, platform)
  const cands = [p.join(home, '.local', 'bin', name), ...(platform === 'win32' ? [] : ['/opt/homebrew/bin/bsk', '/usr/local/bin/bsk']),
    ...path.split(p.delimiter).filter(Boolean).map(d => p.join(d.replace(/^"|"$/g, ''), name))]
  const key = (s: string) => platform === 'win32' ? p.resolve(s).toLowerCase() : p.resolve(s)
  return cands.find(c => key(p.dirname(c)) !== key(p.dirname(bundled)) && existsSync(c)) ?? null
}

export const environmentPath = envPath

/** The user's own bsk home (the daemon their Chrome extension pairs with). MANUL_CHROME_BSK_HOME: tests point it at AgentShot's. */
export const userBskHome = (userHome: string) => process.env.MANUL_CHROME_BSK_HOME || join(userHome, '.bsk')
/** The environment that reaches the user's own bsk daemon, never starting it. */
export const userBskEnv = (userHome: string) => ({ BSK_HOME: userBskHome(userHome), BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' })

/** Said to the agent for every browser command after the user interrupted it in the browser, until they reply. */
export const HALTED = 'error: the user stopped you in their browser (the Interrupt button). Do not use the browser again until they reply: ' +
  'tell them in one line where you were, and ask what they want (ask_user). Never start another session to carry on.'

/**
 * The agent's \`bsk\` and \`chrome-bsk\` (bsk on the user's own Chrome, whichever browser plain bsk reaches; product
 * walkthroughs film there). Both are bsk itself, with three things around each command:
 * - The user's Interrupt holds: once bsk says the user interrupted, every later command but \`session stop\` is refused
 *   (stateDir/halted) until the user's next message, so the agent cannot carry on or start over in another window.
 * - A take filming through bsk shares the session, which runs one command at a time: each command leaves a mark in
 *   stateDir/yield while it runs (the take's screenshots wait), and one bsk turned away as busy (never sent) is sent again.
 * bin: the bsk to run (else $MANUL_BSK_BIN, set per browser mode); bskHome: fixed for chrome-bsk.
 */
export const bskScript = (o: { bin?: string; bskHome?: string; stateDir: string; name: string }) => {
  const q = JSON.stringify, state = q(o.stateDir)
  return `#!/bin/sh
# AgentShot: ${o.name === 'chrome-bsk' ? 'bsk on your own Chrome (your bsk daemon and extension), for product walkthroughs' : 'the browser bsk of the agent\'s setting'}.
${o.bskHome ? `export BSK_HOME=${q(o.bskHome)} BSK_AUTO_START=0\n` : ''}real=${o.bin ? q(o.bin) : '"$MANUL_BSK_BIN"'}
case "$1 $2" in
  "session stop"|"session list"|"--help "|"help "*) ;;
  *) if [ -e ${state}/halted ]; then echo ${q(HALTED)} >&2; exit 5; fi ;;
esac
mkdir -p ${state}/yield && mark=${state}/yield/$$ && : > "$mark"
err=$(mktemp)
trap 'rm -f "$mark" "$err"' EXIT
n=0
while :; do
  out=$("$real" "$@" 2>"$err"); code=$?
  if [ $code -eq 4 ] && [ $n -lt 200 ] && { printf '%s' "$out" | grep -q session_busy || grep -q 'unfinished command' "$err"; }; then
    n=$((n + 1)); sleep 0.05; continue
  fi
  if printf '%s' "$out" | grep -qi 'interrupted by user' || grep -qi 'interrupted by user' "$err"; then : > ${state}/halted; fi
  [ -n "$out" ] && printf '%s\n' "$out"
  cat "$err" >&2
  [ -e ${state}/halted ] && [ $code -ne 0 ] && echo ${q(HALTED)} >&2
  exit $code
done
`
}

/** Environment for every process the agent starts: which bsk CLI and which daemon its `bsk` commands reach. */
export function agentEnv(mode: BrowserMode, o: { bundledDir: string; privateHome: string; userHome: string; userBsk: string | null; path?: string }, platform = process.platform) {
  const p = platform === 'win32' ? win32 : { join, dirname, delimiter }
  const first = mode === 'chrome' && o.userBsk ? p.dirname(o.userBsk) : o.bundledDir
  return { BSK_HOME: mode === 'chrome' ? p.join(o.userHome, '.bsk') : o.privateHome, BSK_AUTO_START: mode === 'chrome' ? '1' : '0',
    PATH: [first, o.path || environmentPath(process.env, platform)].filter(Boolean).join(p.delimiter) }
}

/** AgentShot's private daemon: started on a fresh port, restarted if it dies, stopped with the app. */
export class BskDaemon {
  port: number | null = null
  private child: ChildProcess | null = null
  /** the pid of the daemon that has answered since it started (running means ready, not just spawned) */
  private readyPid: number | null = null
  private stopping = false
  private restarts = 0
  private restartTimer?: ReturnType<typeof setTimeout>

  constructor(private o: { bin: string; home: string; log?: (s: string) => void }) {}

  get home() { return this.o.home }
  get pid() { return this.child?.pid ?? null }
  get running() { return !!this.child && this.child.exitCode == null && !this.child.killed && this.readyPid === this.child.pid }
  get env() { return { ...process.env, BSK_HOME: this.o.home, BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' } }

  /** Run AgentShot's bsk CLI against the private daemon; JSON output is parsed. */
  async cli(args: string[]) {
    const { stdout } = await run(this.o.bin, args, { env: this.env, timeout: 30_000, windowsHide: true })
    try { return JSON.parse(stdout) } catch { return stdout }
  }

  async start(): Promise<{ port: number }> {
    this.stopping = false
    mkdirSync(this.o.home, { recursive: true })
    await this.stopLeftover()
    if (this.stopping) throw new Error('The browser daemon was stopped while starting.')
    this.port ??= await freePort()
    await this.spawn()
    return { port: this.port }
  }

  /** A daemon a crashed AgentShot left running in its home (it is ours: same private home). */
  private async stopLeftover() {
    let pid: number | undefined
    try { pid = JSON.parse(readFileSync(join(this.o.home, 'daemon.json'), 'utf8')).pid } catch { return }
    if (!Number.isInteger(pid) || pid! <= 0) return
    try { process.kill(pid!, 0) } catch { return } // not running
    await run(this.o.bin, ['daemon', 'stop'], { env: this.env, timeout: 10_000, windowsHide: true }).catch(() => { try { process.kill(pid!, 'SIGTERM') } catch { /* gone */ } })
  }

  private async spawn() {
    if (this.stopping) throw new Error('The browser daemon was stopped while starting.')
    const child = spawn(this.o.bin, daemonArgs(this.port!), { env: this.env, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    this.child = child
    this.readyPid = null
    let spawnError: Error | undefined
    let starting = true
    const failed = new Promise<never>((_ok, fail) => child.once('error', e => { spawnError = e; fail(e) }))
    const restart = () => {
      if (this.stopping) return
      const wait = Math.min(500 * 2 ** this.restarts++, 15_000)
      this.restartTimer = setTimeout(() => {
        if (!this.stopping) this.spawn().catch(e => { this.o.log?.(String(e)); restart() })
      }, wait)
    }
    child.stderr?.on('data', b => this.o.log?.(String(b)))
    child.once('exit', () => {
      if (this.child !== child || this.stopping || starting) return
      restart()
    })
    // ready when its daemon.json names our port and the CLI gets an answer
    const until = Date.now() + 10_000
    try {
      for (;;) {
        if (spawnError) throw spawnError
        if (this.stopping || this.child !== child) throw new Error('The browser daemon was stopped while starting.')
        try {
          const info = JSON.parse(readFileSync(join(this.o.home, 'daemon.json'), 'utf8'))
          if (info.ws_port === this.port && info.pid === child.pid) {
            await Promise.race([failed, this.cli(['status', '--json'])])
            if (this.stopping || this.child !== child || child.exitCode != null || child.signalCode != null) continue
            this.restarts = 0; this.readyPid = child.pid ?? null; return
          }
        } catch { /* not yet */ }
        if (child.exitCode != null || child.signalCode != null) throw new Error('The browser daemon stopped while starting.')
        if (Date.now() > until) throw new Error('The browser daemon did not start.')
        await Promise.race([failed, new Promise(r => setTimeout(r, 100))])
      }
    } catch (e) {
      if (this.child === child) { this.child = null; this.readyPid = null }
      try { child.kill('SIGKILL') } catch { /* gone */ }
      throw e
    } finally { starting = false }
  }

  /** At quit, when there is no time to wait. */
  killNow() { this.stopping = true; clearTimeout(this.restartTimer); this.readyPid = null; try { this.child?.kill('SIGTERM') } catch { /* gone */ } }

  async stop() {
    this.stopping = true
    clearTimeout(this.restartTimer)
    this.readyPid = null
    const c = this.child
    this.child = null
    if (!c?.pid || c.exitCode != null || c.signalCode != null) return
    await new Promise<void>(ok => {
      let forced: NodeJS.Timeout | undefined
      const done = () => { clearTimeout(timer); clearTimeout(forced); c.removeListener('exit', done); c.removeListener('error', done); ok() }
      const timer = setTimeout(() => {
        // Termination is asynchronous: reap the child before reporting a successful stop.
        forced = setTimeout(done, 1000)
        try { if (!c.kill('SIGKILL')) done() } catch { done() }
      }, 3000)
      c.once('exit', done)
      c.once('error', done)
      try { if (!c.kill('SIGTERM')) done() } catch { done() }
    })
  }
}

/** The browser part of the agent's instructions, for the current setting. */
const STOPPED = `If a bsk command says the user stopped you (their Interrupt button), stop using the browser: say where you were, ` +
  `ask what they want (ask_user) and end your turn; never start another session to carry on. Sign-in pages: request-help once, never retry it.`

export function browserPrompt(mode: BrowserMode, platform = process.platform): string {
  const files = `For files from the web, run \`bsk download <ref> --out downloads/<name> --session <id>\` (a path in the project folder), ` +
    `then call import_media to add it to the project. Ask the user (ask_user) before downloading anything large or paid, and before ` +
    `publishing, posting, sending, buying or uploading anything.` + (platform === 'win32' ?
      ` Run bsk with the powershell tool. Translate any Bash examples in the browser skill to PowerShell; no Git Bash, WSL, which or Unix utilities are required.` : '')
  if (mode === 'chrome') {
    return `Browser: the user chose to let you use their own Chrome. Your \`bsk\` commands drive the user's own Chrome through their bsk ` +
      `(their real, logged-in profile), so act only within what they asked. Several browsers can be online: run \`bsk browsers\` and pass ` +
      `\`--browser <id>\` to \`bsk session start\`; if it is unclear which one, ask_user. Never start, stop or restart their bsk daemon. ` +
      `For how to use bsk, read the browser-skill skill first. ${files} ${STOPPED}`
  }
  return `Browser: your \`bsk\` commands drive AgentShot's own browser (the Browser panel the user sees inside AgentShot), never the user's personal ` +
    `Chrome (only product walkthroughs use their Chrome, with chrome-bsk: see the product-walkthrough skill). It is the only browser bsk sees here: never pass \`--browser\`, and never change BSK_HOME or BSK_AUTO_START or start, stop or ` +
    `restart the bsk daemon (AgentShot runs it). Sign-ins the user made in AgentShot's browser are kept between sessions; when a page needs a sign-in, ` +
    `CAPTCHA or confirmation, use \`bsk request-help\` so the user does it in the panel. For how to use bsk, read the browser-skill skill first. ${files} ${STOPPED}`
}

/** An environment object whose values are read at each use (spread), so the agent's shell follows the setting live. */
export function liveEnv(get: () => Record<string, string>, platform = process.platform, inherited: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const o = {}
  const keys = new Set(Object.keys(get()))
  // Node deduplicates Windows environment keys before spawning. All PATH spellings must carry the override.
  if (platform === 'win32' && [...keys].some(k => k.toUpperCase() === 'PATH')) {
    keys.add('PATH')
    for (const k of Object.keys(inherited)) if (k.toUpperCase() === 'PATH') keys.add(k)
  }
  for (const k of keys) Object.defineProperty(o, k, { enumerable: true, get: () => platform === 'win32' && k.toUpperCase() === 'PATH' ? environmentPath(get(), platform) : get()[k] })
  return o as Record<string, string>
}

/** The user's own Chrome bsk, read-only: is their CLI installed, is their daemon up, which browsers are connected. Never starts anything. */
export async function chromeBsk(o: { userHome: string; bundled: string; path?: string }): Promise<ChromeBsk> {
  const cli = findUserBsk({ home: o.userHome, bundled: o.bundled, path: o.path })
  const env = { ...process.env, BSK_HOME: join(o.userHome, '.bsk'), BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' }
  try {
    const { stdout } = await run(cli || o.bundled, ['browsers', '--json'], { env, timeout: 5000, windowsHide: true })
    const list = JSON.parse(stdout) as { instance_id?: string; id?: string; label?: string; browser_name?: string }[]
    return { cli, daemon: true, browsers: list.map(b => ({ id: b.instance_id || b.id || '', label: b.label || b.browser_name || 'Chrome' })) }
  } catch { return { cli, daemon: false, browsers: [] } }
}
