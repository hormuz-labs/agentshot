// agentshot-mcp (plugin): started by Claude Code for the AgentShot plugin. Nothing may be printed to stdout here:
// stdout is the protocol.
//
//   AGENTSHOT_STATE   AgentShot's state file, when it isn't in the usual settings folder
//   AGENTSHOT_APP     the AgentShot app to open when it's closed (macOS opens the installed AgentShot by itself)
//   AGENTSHOT_FROM    who AgentShot says is at work (default: Claude Code)
import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { Launcher, defaultStateFile, serve } from './launcher'

/** Opens AgentShot in the background, without bringing it to the front. */
function opener(env: NodeJS.ProcessEnv): (() => void) | undefined {
  const start = (command: string, args: string[]) => () => {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' })
    child.on('error', () => {}) // not installed there: reported as not open
    child.unref()
  }
  const app = env.AGENTSHOT_APP
  if (process.platform === 'darwin') return start('/usr/bin/open', ['-g', '-a', app || 'AgentShot'])
  return app ? start(app, []) : undefined
}

const launcher = new Launcher({
  stateFile: defaultStateFile(process.env, process.platform, homedir()),
  from: process.env.AGENTSHOT_FROM || 'Claude Code',
  openApp: opener(process.env),
})
await serve(process.stdin, process.stdout, launcher)
