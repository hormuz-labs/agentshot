// The agent's fence: its file tools and its shell reach only the project folder (read and write), temp folders, and
// Manul's own bundled tools, skills, models and fonts (read only) — never the user's home folder, other projects,
// Manul's app data or anything like ~/.claude. File tools are checked here, in process (symlinks resolved); shell
// commands run inside the operating system's sandbox: Seatbelt (sandbox-exec) on macOS, Landlock (manul-fence) on Linux.
import { existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { FileError } from '@earendil-works/pi-durable/env'
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node'
import { isWithinDir } from './paths'

export type Fence = { rw: string[]; ro: string[] }

/** A path as it really is on disk (following symlinks), even if it doesn't exist yet. */
export function realish(p: string): string {
  let cur = resolve(p)
  const tail: string[] = []
  while (!existsSync(cur)) {
    const up = dirname(cur)
    if (up === cur) break
    tail.unshift(basename(cur))
    cur = up
  }
  let real = cur
  try { real = realpathSync(cur) } catch { /* keep as is */ }
  return tail.length ? join(real, ...tail) : real
}

const within = (p: string, root: string) =>
  (process.platform === 'win32' ? p.toLowerCase() === root.toLowerCase() : p === root) || isWithinDir(root, p)

/** The folders the agent may use: the project, temp, Manul's bundled resources, and the private browser's home. */
export function fenceFor(o: { project: string; resources: string; extraRw?: string[]; extraRo?: string[] }): Fence {
  const tmp = [tmpdir(), ...(process.platform === 'win32' ? [] : [process.platform === 'darwin' ? '/private/tmp' : '/tmp'])]
  return {
    rw: [o.project, ...tmp, ...(o.extraRw || [])].map(realish),
    ro: [o.resources, ...(o.extraRo || [])].map(realish),
  }
}

/** May the agent read (or write) this path? */
export function allowed(fence: Fence, path: string, write: boolean): boolean {
  const p = realish(path)
  return fence.rw.some(r => within(p, r)) || (!write && fence.ro.some(r => within(p, r)))
}

const q = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** The Seatbelt profile: everything as usual, except no reading the home folder or other volumes and no writing outside the fence. */
export function seatbeltProfile(fence: Fence, home: string): string {
  return [
    '(version 1)',
    '(allow default)',
    `(deny file-read* file-write* (subpath ${q(realish(home))}) (subpath "/Volumes"))`,
    '(deny file-write* (subpath "/"))',
    `(allow file-read* file-write* ${fence.rw.map(p => `(subpath ${q(p)})`).join(' ')} (subpath "/dev"))`,
    `(allow file-read* ${fence.ro.map(p => `(subpath ${q(p)})`).join(' ')})`,
    '(allow file-read-metadata)', // stat() of the folders above the project, as tools do
  ].join('\n')
}

/** The program and arguments that run `argv` inside the fence (null where no OS sandbox exists). */
export function fencedArgv(fence: Fence, argv: string[], o: { home: string; fenceBin?: string }): string[] | null {
  if (process.platform === 'darwin') return ['/usr/bin/sandbox-exec', '-p', seatbeltProfile(fence, o.home), ...argv]
  if (process.platform === 'linux' && o.fenceBin && existsSync(o.fenceBin)) {
    return [o.fenceBin, ...fence.rw.flatMap(p => ['--rw', p]), ...fence.ro.flatMap(p => ['--ro', p]), '--', ...argv]
  }
  return null
}

type Ctx = Parameters<NodeExecutionEnv['readTextFile']>[1]
const denied = (path: string) => Promise.resolve({ ok: false as const, error: new FileError('permission_denied',
  `${path} is outside the project. You can only use the project folder, temp folders and Manul's bundled tools and skills.`, path) })

/** NodeExecutionEnv with the fence: file operations checked, shell commands sandboxed. */
export class FencedEnv extends NodeExecutionEnv {
  constructor(options: ConstructorParameters<typeof NodeExecutionEnv>[0], private fence: Fence, private sandbox: { home: string; fenceBin?: string },
    private enabled = true) {
    super(options)
  }

  private abs(p: string) { return resolve(this.cwd, p) }
  private ok(p: string, write = false) { return !this.enabled || allowed(this.fence, this.abs(p), write) }

  override exec(command: string | readonly string[], options: Parameters<NodeExecutionEnv['exec']>[1], context: Ctx) {
    if (!this.enabled) return super.exec(command, options, context)
    const argv = typeof command === 'string' ? ['/bin/bash', '-c', command] : [...command]
    const fenced = fencedArgv(this.fence, argv, this.sandbox)
    return super.exec(fenced || command, options, context)
  }

  override openTextLineReader(p: string, c: Ctx) { return this.ok(p) ? super.openTextLineReader(p, c) : denied(p) }
  override readTextFile(p: string, c: Ctx) { return this.ok(p) ? super.readTextFile(p, c) : denied(p) }
  override readTextLines(p: string, o: Parameters<NodeExecutionEnv['readTextLines']>[1], c: Ctx) { return this.ok(p) ? super.readTextLines(p, o, c) : denied(p) }
  override readBinaryFile(p: string, c: Ctx) { return this.ok(p) ? super.readBinaryFile(p, c) : denied(p) }
  override openBinaryReader(p: string, o: Parameters<NodeExecutionEnv['openBinaryReader']>[1], c: Ctx) { return this.ok(p) ? super.openBinaryReader(p, o, c) : denied(p) }
  override fileInfo(p: string, c: Ctx) { return this.ok(p) ? super.fileInfo(p, c) : denied(p) }
  override listDir(p: string, c: Ctx) { return this.ok(p) ? super.listDir(p, c) : denied(p) }
  override openDirReader(p: string, c: Ctx) { return this.ok(p) ? super.openDirReader(p, c) : denied(p) }
  override canonicalPath(p: string, c: Ctx) { return this.ok(p) ? super.canonicalPath(p, c) : denied(p) }
  override exists(p: string, c: Ctx) { return this.ok(p) ? super.exists(p, c) : denied(p) }
  override writeFile(p: string, d: string | Uint8Array, c: Ctx) { return this.ok(p, true) ? super.writeFile(p, d, c) : denied(p) }
  override appendFile(p: string, d: string | Uint8Array, c: Ctx) { return this.ok(p, true) ? super.appendFile(p, d, c) : denied(p) }
  override truncateFile(p: string, n: number, c: Ctx) { return this.ok(p, true) ? super.truncateFile(p, n, c) : denied(p) }
  override flushFile(p: string, c: Ctx) { return this.ok(p, true) ? super.flushFile(p, c) : denied(p) }
  override renameFile(a: string, b: string, c: Ctx) { return this.ok(a, true) && this.ok(b, true) ? super.renameFile(a, b, c) : denied(this.ok(a, true) ? b : a) }
  override createDir(p: string, o: Parameters<NodeExecutionEnv['createDir']>[1], c: Ctx) { return this.ok(p, true) ? super.createDir(p, o, c) : denied(p) }
  override remove(p: string, o: Parameters<NodeExecutionEnv['remove']>[1], c: Ctx) { return this.ok(p, true) ? super.remove(p, o, c) : denied(p) }
  override watch(targets: Parameters<NodeExecutionEnv['watch']>[0], onChange: Parameters<NodeExecutionEnv['watch']>[1], c: Ctx) {
    const bad = targets.map(t => (typeof t === 'string' ? t : (t as { path: string }).path)).find(p => p && !this.ok(p))
    return bad ? denied(bad) : super.watch(targets, onChange, c)
  }
}
