// Telling the agents that speak MCP over stdin and stdout (the Claude app, Codex) how to start AgentShot's launcher
// (scripts/launcher, the agentshot-mcp program). Each keeps its servers in a settings file of its own; AgentShot
// touches only its own entry there, keeps a copy of the file as it was before its first change, and leaves a file
// it can't read alone. The entry holds no password: the launcher reads AgentShot's own state file each time.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** How an agent starts the launcher. */
export type Launch = { command: string; args: string[] }

type Env = Record<string, string | undefined>
export const claudeAppConfig = (home: string, platform: string = process.platform, env: Env = process.env) =>
  platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
    : platform === 'win32' ? join(env.APPDATA || join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
      : join(env.XDG_CONFIG_HOME || join(home, '.config'), 'Claude', 'claude_desktop_config.json')
export const codexConfig = (home: string, env: Env = process.env) => join(env.CODEX_HOME || join(home, '.codex'), 'config.toml')

/** Which of them are on this computer: each makes its settings folder the first time it runs. */
export const installedAgents = (home: string, platform: string = process.platform, env: Env = process.env) => ({
  claudeApp: existsSync(dirname(claudeAppConfig(home, platform, env))),
  codex: existsSync(dirname(codexConfig(home, env))),
})

const BACKUP = '.before-agentshot'
/** Writes a settings file, keeping it as it was before AgentShot first changed it. */
function write(file: string, before: string | null, after: string) {
  if (before === after) return
  mkdirSync(dirname(file), { recursive: true })
  if (before !== null && !existsSync(file + BACKUP)) copyFileSync(file, file + BACKUP)
  writeFileSync(file, after)
}
const read = (file: string) => { try { return readFileSync(file, 'utf8') } catch { return null } }

/** The Claude app's settings with AgentShot's entry set (or, with no launch, removed); everything else as it was. */
export function withClaudeAppServer(json: string | null, name: string, launch: Launch | null): string {
  let config: Record<string, unknown> = {}
  if (json?.trim()) {
    try { config = JSON.parse(json) } catch { throw new Error('The Claude app’s settings file isn’t valid JSON, so AgentShot left it alone. Fix or remove it, then try again.') }
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('The Claude app’s settings file isn’t what AgentShot expects, so it was left alone.')
  }
  const servers = { ...(config.mcpServers && typeof config.mcpServers === 'object' ? config.mcpServers as Record<string, unknown> : {}) }
  if (launch) servers[name] = { command: launch.command, args: launch.args }
  else delete servers[name]
  if (!launch && !Object.keys(servers).length) { const { mcpServers: _gone, ...rest } = config; return `${JSON.stringify(rest, null, 2)}\n` }
  return `${JSON.stringify({ ...config, mcpServers: servers }, null, 2)}\n`
}
export function setClaudeAppServer(file: string, name: string, launch: Launch | null) {
  const before = read(file)
  if (before === null && !launch) return
  write(file, before, withClaudeAppServer(before, name, launch))
}

/** Codex's settings (TOML) with AgentShot's section set or removed. Only that section's lines change. */
export function withCodexServer(toml: string | null, name: string, launch: Launch | null): string {
  const header = `[mcp_servers.${name}]`
  const mine = (line: string) => { const t = line.trim(); return t === header || t.startsWith(`[mcp_servers.${name}.`) }
  const kept: string[] = []
  let skipping = false
  for (const line of (toml ?? '').split('\n')) {
    if (/^\s*\[/.test(line)) skipping = mine(line)
    if (!skipping) kept.push(line)
  }
  let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '')
  if (launch) {
    // a TOML basic string takes the same escapes JSON does for these (paths, plain words)
    const section = [header, `command = ${JSON.stringify(launch.command)}`, `args = [${launch.args.map(a => JSON.stringify(a)).join(', ')}]`,
      'startup_timeout_sec = 60', 'tool_timeout_sec = 900'].join('\n')
    out = out ? `${out}\n\n${section}` : section
  }
  return out ? `${out}\n` : ''
}
export function setCodexServer(file: string, name: string, launch: Launch | null) {
  const before = read(file)
  if (before === null && !launch) return
  write(file, before, withCodexServer(before, name, launch))
}
