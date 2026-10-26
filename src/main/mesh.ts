// Userspace mesh helper manager: starts `agentshot-mesh` (tsnet) if present so workers and clients join Headscale without OS Tailscale.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve as resolvePath } from 'node:path'
import { BIN } from './media'
import { executableName } from './paths'

export type MeshNode = {
  ip: string
  stop: () => void
}

/** Every helper this process started, joined or still joining: all of them go when it does. A helper left behind
 *  keeps the same node identity as the next one (a cloud worker restarts on every lease), and two helpers fighting over
 *  one node make it unreachable. */
const helpers = new Set<ChildProcess>()
export function stopAllMesh() {
  for (const c of helpers) { try { c.kill() } catch { /* gone */ } }
  helpers.clear()
}
process.once('exit', () => { for (const c of helpers) { try { c.kill('SIGKILL') } catch { /* gone */ } } })

/** Helpers still running from an earlier run with this same state (a crash, or one that outlived its app): stopped,
 *  so only the one about to start holds the node. Linux reads /proc; elsewhere pkill does the same. */
export function stopStaleHelpers(stateDir: string, bin = meshBinPath()) {
  const dir = resolvePath(stateDir)
  try {
    if (process.platform === 'linux') {
      for (const pid of readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
        let args: string[]
        try { args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0') } catch { continue }
        const at = args.indexOf('--state-dir')
        if ((args[0] === bin || args[1] === bin) && at >= 0 && resolvePath(args[at + 1] || '') === dir && Number(pid) !== process.pid) {
          try { process.kill(Number(pid)) } catch { /* gone */ }
        }
      }
    } else if (process.platform === 'darwin') {
      execFileSync('pkill', ['-f', `${bin} --state-dir ${dir} `], { stdio: 'ignore' })
    }
  } catch { /* none found */ }
}

export function meshBinPath(): string {
  return process.env.MANUL_MESH_BIN || join(BIN, executableName('agentshot-mesh'))
}

export async function startMeshNode(opts: {
  stateDir: string
  hostname: string
  controlUrl: string
  authKey: string
  ephemeral?: boolean
  forwardPort?: number
  meshPort?: number
  /** Called if the helper exits after it came up (crash, kill, mesh logout). */
  onExit?: () => void
}): Promise<MeshNode | null> {
  const bin = meshBinPath()
  if (!existsSync(bin)) return null
  mkdirSync(opts.stateDir, { recursive: true })
  stopStaleHelpers(opts.stateDir, bin)
  const args = [
    '--state-dir',
    opts.stateDir,
    '--hostname',
    opts.hostname,
    '--control-url',
    opts.controlUrl,
    '--auth-key',
    opts.authKey,
    ...(opts.ephemeral ? ['--ephemeral'] : []),
    ...(opts.forwardPort ? ['--forward-port', String(opts.forwardPort), '--mesh-port', String(opts.meshPort || 47821)] : []),
  ]
  const { promise, resolve } = Promise.withResolvers<MeshNode | null>()
  let child: ChildProcess | undefined
  const timer = setTimeout(() => {
    child?.kill()
    resolve(null)
  }, 30_000)
  try {
    child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    helpers.add(child)
  } catch {
    clearTimeout(timer)
    return null
  }
  let ready = false
  let buf = ''
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buf += chunk
    const nl = buf.indexOf('\n')
    if (nl < 0) return
    const line = buf.slice(0, nl).trim()
    try {
      const parsed = JSON.parse(line) as { ip?: string }
      if (parsed.ip) {
        ready = true
        clearTimeout(timer)
        resolve({
          ip: parsed.ip,
          stop: () => {
            try {
              child?.kill()
            } catch {}
          },
        })
      }
    } catch {}
  })
  child.on('exit', () => {
    helpers.delete(child!)
    clearTimeout(timer)
    if (ready) opts.onExit?.()
    resolve(null)
  })
  child.on('error', () => {
    clearTimeout(timer)
    resolve(null)
  })
  return promise
}
