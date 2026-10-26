// Cloud workers keep nothing of the people who lease them: each person's projects and profile (conversations, memory,
// skills, the agent's browser) live in their own space on a shared disk, <root>/users/<user>/, and whichever worker
// they lease next opens the same space. A lock in the space makes sure only one worker has it open at a time; it is
// renewed with every heartbeat and lapses on its own if that worker dies. A quota caps how much each person keeps.
// Plain files only, so the root can be a local disk shared by several workers on one computer or a network disk
// shared by workers on several.
import { randomBytes } from 'node:crypto'
import { constants, mkdirSync, readFileSync } from 'node:fs'
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm, statfs, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

/** An account user id, as the account service hands it out (user_2abc…): nothing that could step out of a folder. */
const USER = /^[A-Za-z0-9_-]{1,128}$/
/** How long a lock lasts without being renewed (heartbeats renew it every 30 s). */
export const LOCK_TTL = 2 * 60_000

export class SpaceError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

export function checkUser(user: string) {
  if (!USER.test(user)) throw new SpaceError(400, 'Invalid user')
  return user
}

/** A person's space: projects and profile, readable by this computer's user only. */
export function spaceOf(root: string, user: string) {
  const dir = join(resolve(root), 'users', checkUser(user))
  return { dir, projects: join(dir, 'projects'), profile: join(dir, 'profile'), lock: join(dir, '.lock') }
}

export async function ensureSpace(root: string, user: string) {
  const space = spaceOf(root, user)
  for (const d of [join(resolve(root), 'users'), space.dir, space.projects, space.profile]) await mkdir(d, { recursive: true, mode: 0o700 })
  return space
}

export type Lock = { holder: string; until: number }

async function readLock(file: string): Promise<Lock | undefined> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as Partial<Lock>
    return typeof parsed.holder === 'string' && typeof parsed.until === 'number' ? { holder: parsed.holder, until: parsed.until } : undefined
  } catch {
    return undefined
  }
}

/** Replaces the lock file in one step (a reader never sees half a lock). */
async function writeLock(file: string, lock: Lock) {
  const tmp = `${file}.${randomBytes(6).toString('hex')}`
  await writeFile(tmp, JSON.stringify(lock), { mode: 0o600 })
  await rename(tmp, file)
}

/** Takes, or renews, a person's lock for [holder] (a worker's id). False while another worker holds it; a lock nobody
 *  renewed for [ttl] is taken over (its worker is gone). Taking, and taking over, both end in creating the lock file
 *  exclusively, so of several workers asking at once exactly one gets it. */
export async function acquire(root: string, user: string, holder: string, ttl = LOCK_TTL, now = Date.now()): Promise<boolean> {
  const { lock } = await ensureSpace(root, user)
  const mine: Lock = { holder, until: now + ttl }
  const create = async () => {
    try {
      const file = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      await file.writeFile(JSON.stringify(mine))
      await file.close()
      return true
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    }
  }
  if (await create()) return true
  const current = await readLock(lock)
  if (current?.holder === holder) {
    await writeLock(lock, mine) // ours: renewed
    return true
  }
  if (current && current.until > now) return false
  // stale or damaged: only the worker that gets the takeover guard (created exclusively) may clear it; the others
  // try again with their next heartbeat. A guard left by a worker that died mid-takeover lapses after a few seconds.
  const guard = `${lock}.takeover`
  try {
    const file = await open(guard, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await file.close()
  } catch {
    const age = now - ((await lstat(guard).catch(() => undefined))?.mtimeMs ?? now)
    if (age > 10_000) await rm(guard, { force: true })
    return false
  }
  try {
    const again = await readLock(lock)
    // still the stale (or damaged) lock we saw, not one another worker took meanwhile
    if (again && (again.holder !== current?.holder || again.until !== current?.until)) return false
    await rm(lock, { force: true })
    return await create()
  } finally {
    await rm(guard, { force: true })
  }
}

/** Lets go of a person's lock, if [holder] still has it. */
export async function release(root: string, user: string, holder: string) {
  const { lock } = spaceOf(root, user)
  if ((await readLock(lock))?.holder === holder) await rm(lock, { force: true })
}

export async function holderOf(root: string, user: string, now = Date.now()) {
  const current = await readLock(spaceOf(root, user).lock)
  return current && current.until > now ? current.holder : undefined
}

/** Bytes under [dir], counting files only (links aren't followed: a link can't make a space look smaller or bigger). */
export async function usage(dir: string): Promise<number> {
  let total = 0
  const walk = async (d: string) => {
    let entries
    try { entries = await readdir(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(d, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile()) total += (await lstat(p).catch(() => undefined))?.size ?? 0
    }
  }
  await walk(dir)
  return total
}

/** A person's space and how much is in it: counted once when the session starts, then kept up as files arrive, and
 *  counted again now and then (renders and the agent write too). No disk walk per request. The shared disk itself
 *  keeps [reserve] free too: everyone's spaces are on it, so one full disk would stop them all. */
export class Quota {
  used = 0
  /** Free bytes on the shared disk, as of the last count. */
  free = Infinity
  constructor(readonly dir: string, readonly limit: number, readonly reserve = 0) {}
  async recount() {
    this.used = await usage(this.dir)
    try { const fs = await statfs(this.dir); this.free = fs.bavail * fs.bsize } catch { this.free = Infinity }
    return this.used
  }
  /** Throws (507) unless [bytes] more still fit, in this person's quota and on the disk. */
  ensureRoom(bytes: number) {
    const more = Math.max(0, bytes)
    const gb = (n: number) => (n / 1024 ** 3).toFixed(1)
    if (this.used + more > this.limit) {
      throw new SpaceError(507, `Your AgentShot space is full (${gb(this.used)} of ${gb(this.limit)} GB). Delete a project or some files to make room.`)
    }
    if (this.free - more < this.reserve) {
      throw new SpaceError(507, 'AgentShot Cloud is out of room right now. Your projects are safe; try again later.')
    }
  }
  add(bytes: number) { const more = Math.max(0, bytes); this.used += more; this.free -= more }
}

/** True when [path] is inside [dir] after resolving links: a project of this person's, not a way out of the space. */
export async function within(dir: string, path: string) {
  try {
    const [base, target] = await Promise.all([realpath(dir), realpath(path)])
    return target === base || target.startsWith(base + sep)
  } catch {
    return false
  }
}

/** Which person's space a worker slot opens when it starts: written before the worker restarts into it. */
export async function readSession(slot: string): Promise<string | undefined> {
  try {
    const user = (JSON.parse(await readFile(join(slot, 'session.json'), 'utf8')) as { user?: unknown }).user
    return typeof user === 'string' && USER.test(user) ? user : undefined
  } catch {
    return undefined
  }
}

export async function writeSession(slot: string, user: string | undefined) {
  if (user) checkUser(user)
  await mkdir(slot, { recursive: true, mode: 0o700 })
  const file = join(slot, 'session.json'), tmp = `${file}.${randomBytes(6).toString('hex')}`
  await writeFile(tmp, JSON.stringify({ user: user ?? null }), { mode: 0o600 })
  await rename(tmp, file)
}

/** The same, read synchronously: a worker decides at its very start whose space it opens (before anything uses the
 *  profile). Makes the space when there is one. */
export function startingSession(root: string, slot: string): { user: string; space: ReturnType<typeof spaceOf> } | undefined {
  let user: unknown
  try { user = (JSON.parse(readFileSync(join(slot, 'session.json'), 'utf8')) as { user?: unknown }).user } catch { return undefined }
  if (typeof user !== 'string' || !USER.test(user)) return undefined
  const space = spaceOf(root, user)
  for (const d of [join(resolve(root), 'users'), space.dir, space.projects, space.profile]) mkdirSync(d, { recursive: true, mode: 0o700 })
  return { user, space }
}
