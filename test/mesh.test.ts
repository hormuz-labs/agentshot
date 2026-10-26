import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// a stand-in helper: never comes up (prints no address), just stays running like one still joining
const dir = mkdtempSync(join(tmpdir(), 'agentshot-mesh-'))
const bin = join(dir, 'agentshot-mesh')
writeFileSync(bin, '#!/bin/sh\nsleep 60\n')
chmodSync(bin, 0o755)
process.env.MANUL_MESH_BIN = bin
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await new Promise(r => setTimeout(r, 50)) ; return f() }

describe.skipIf(process.platform !== 'linux')('the mesh helper', () => {
  it('one still joining is stopped with the rest (a worker restarting seconds after a lease leaves none behind)', async () => {
    const { startMeshNode, stopAllMesh } = await import('../src/main/mesh')
    const joining = startMeshNode({ stateDir: join(dir, 'state-a'), hostname: 'h', controlUrl: 'https://mesh', authKey: 'k' })
    // its pid: the only child running the stand-in
    let pid = 0
    await until(() => { pid = Number(execFileSync('pgrep', ['-f', `${bin} --state-dir ${join(dir, 'state-a')}`]).toString().trim().split('\n')[0] || 0); return pid > 0 })
    expect(alive(pid)).toBe(true)
    stopAllMesh()
    expect(await until(() => !alive(pid))).toBe(true)
    expect(await joining).toBeNull()
  })

  it('a helper left from an earlier run on the same node is stopped before a new one starts; others are left alone', async () => {
    const { startMeshNode, stopAllMesh } = await import('../src/main/mesh')
    const stale = spawn(bin, ['--state-dir', join(dir, 'state-b'), '--hostname', 'h'], { detached: true, stdio: 'ignore' })
    const other = spawn(bin, ['--state-dir', join(dir, 'state-c'), '--hostname', 'h'], { detached: true, stdio: 'ignore' })
    try {
      await until(() => alive(stale.pid!) && alive(other.pid!))
      const next = startMeshNode({ stateDir: join(dir, 'state-b'), hostname: 'h', controlUrl: 'https://mesh', authKey: 'k' })
      expect(await until(() => { try { process.kill(stale.pid!, 0); return stale.exitCode !== null || stale.signalCode !== null } catch { return true } })).toBe(true)
      expect(alive(other.pid!)).toBe(true)
      stopAllMesh()
      await next
    } finally {
      try { process.kill(other.pid!) } catch { /* gone */ }
      try { process.kill(stale.pid!) } catch { /* gone */ }
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
