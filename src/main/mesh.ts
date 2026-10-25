// Userspace mesh helper manager: starts `agentshot-mesh` (tsnet) if present so workers and clients join Headscale without OS Tailscale.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BIN } from './media'
import { executableName } from './paths'

export type MeshNode = {
  ip: string
  stop: () => void
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
