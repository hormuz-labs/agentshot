// Authentication belongs exclusively to the published Claude Code binary. Never read its credential files.
import { createRequire } from 'node:module'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { startup, type ModelInfo } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeCodeStatus } from '../shared/claude-code'

export function claudeExecutable() {
  const require = createRequire(import.meta.url)
  const platform = process.platform === 'win32' ? 'win32' : process.platform
  const musl = platform === 'linux' && !(process.report.getReport() as any).header.glibcVersionRuntime ? '-musl' : ''
  try { return require.resolve(`@anthropic-ai/claude-agent-sdk-${platform}-${process.arch}${musl}/${platform === 'win32' ? 'claude.exe' : 'claude'}`).replace(/app\.asar([/\\])/, 'app.asar.unpacked$1') } catch { return undefined }
}

export class ClaudeCodeConnection {
  private login?: ChildProcess
  private enabled = false
  private catalog?: { models: ModelInfo[]; at: number }
  constructor(private preference: string, readonly executable = claudeExecutable()) {
    try { this.enabled = JSON.parse(readFileSync(preference, 'utf8')).enabled === true } catch { /* not connected yet */ }
  }
  private run(args: string[]) {
    if (!this.executable || !existsSync(this.executable)) throw new Error('Claude Code is unavailable. Reinstall AgentShot with optional dependencies enabled.')
    return new Promise<string>((resolve, reject) => execFile(this.executable!, args,
      { cwd: homedir(), timeout: 20_000, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
        // auth status returns JSON even when logged out; never forward raw stderr.
        if (stdout.trim() && args[1] === 'status') resolve(stdout)
        else if (error) reject(new Error('Claude Code could not complete the request. Try again.'))
        else resolve(stdout)
      }))
  }
  async status(): Promise<ClaudeCodeStatus> {
    if (!this.executable) return { available: false, connected: false, enabled: this.enabled, subscription: false }
    try {
      const s = JSON.parse(await this.run(['auth', 'status']))
      return { available: true, connected: s.loggedIn === true, enabled: this.enabled,
        subscription: s.loggedIn === true && s.authMethod === 'claude.ai', authMethod: s.authMethod, email: s.email }
    } catch { return { available: true, connected: false, enabled: this.enabled, subscription: false, warning: 'Could not check Claude Code sign-in. Try Refresh connection.' } }
  }
  async connect() {
    writeFileSync(this.preference, JSON.stringify({ enabled: true }), { mode: 0o600 })
    this.enabled = true
    this.catalog = undefined
    return this.status()
  }
  async signIn() {
    if (this.login) throw new Error('Claude Code sign-in is already in progress.')
    if (!this.executable) throw new Error('Claude Code is not available.')
    await new Promise<void>((resolve, reject) => {
      // Claude opens its browser and owns the callback. Its output may contain OAuth URLs: discard it.
      const child = spawn(this.executable!, ['auth', 'login'], { cwd: homedir(), stdio: 'ignore', windowsHide: true })
      this.login = child
      const timer = setTimeout(() => child.kill(), 5 * 60_000)
      const finish = (ok: boolean) => { clearTimeout(timer); if (this.login === child) this.login = undefined
        ok ? resolve() : reject(new Error('Claude Code sign-in was cancelled or did not complete. Try again or run claude auth login in a terminal.')) }
      child.once('error', () => finish(false)); child.once('exit', code => finish(code === 0))
    })
    return this.connect()
  }
  cancel() { this.login?.kill() }
  async disconnect() {
    this.cancel(); this.catalog = undefined
    writeFileSync(this.preference, JSON.stringify({ enabled: false }), { mode: 0o600 })
    this.enabled = false
    // Disconnect only AgentShot; don't log the user out of their other Claude Code sessions.
    return this.status()
  }
  /** Lists an MCP server (AgentShot's own, src/main/mcp.ts) in the person's Claude Code, for every folder, in place of
   *  an older entry of that name. The token is Claude Code's to keep from then on. */
  async addServer(name: string, url: string, token: string) {
    await this.removeServer(name)
    await this.run(['mcp', 'add', '--scope', 'user', '--transport', 'http', name, url, '--header', `Authorization: Bearer ${token}`])
  }
  async removeServer(name: string) { await this.run(['mcp', 'remove', '--scope', 'user', name]).catch(() => { /* wasn't listed */ }) }
  async models(): Promise<ModelInfo[]> {
    if (!this.enabled || !(await this.status()).connected) return []
    if (this.catalog && Date.now() - this.catalog.at < 300_000) return this.catalog.models
    const warm = await startup({ options: { pathToClaudeCodeExecutable: this.executable, cwd: homedir(), tools: [], settingSources: [] }, initializeTimeoutMs: 20_000 })
    // Initialize without sending a user turn or spending inference credits.
    const probe = warm.query((async function* () { await new Promise(() => {}); })())
    try { const models = await probe.supportedModels(); this.catalog = { models, at: Date.now() }; return models }
    finally { probe.close(); warm.close() }
  }
}
