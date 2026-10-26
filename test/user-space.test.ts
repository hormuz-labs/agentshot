import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquire, checkUser, ensureSpace, holderOf, LOCK_TTL, Quota, readSession, release, spaceOf, usage, within, writeSession } from '../src/main/user-space'

const roots: string[] = []
const root = async () => { const d = await mkdtemp(join(tmpdir(), 'agentshot-spaces-')); roots.push(d); return d }
afterEach(async () => { await Promise.all(roots.splice(0).map(d => rm(d, { recursive: true, force: true }))) })

describe('a person\'s space on the shared disk', () => {
  it('is theirs alone: under users/<id>, readable by this computer\'s user only', async () => {
    const r = await root()
    const space = await ensureSpace(r, 'user_maya')
    expect(space.dir).toBe(join(r, 'users', 'user_maya'))
    // (Windows has no such modes: there the folders are as private as the account's own)
    if (process.platform !== 'win32') for (const d of [space.dir, space.projects, space.profile]) expect((await stat(d)).mode & 0o777).toBe(0o700)
  })

  it('refuses ids that could step out of the space', () => {
    for (const bad of ['../x', 'a/b', '', '.', '..', 'user maya', 'x'.repeat(200), 'a\0b']) expect(() => checkUser(bad)).toThrow()
    expect(() => spaceOf('/r', '../etc')).toThrow()
    expect(checkUser('user_2AbC-9')).toBe('user_2AbC-9')
  })
})

describe('the lock: one worker at a time', () => {
  it('goes to the first worker, is renewed by it, refused to another, and freed on release', async () => {
    const r = await root()
    expect(await acquire(r, 'user_maya', 'worker-1')).toBe(true)
    expect(await acquire(r, 'user_maya', 'worker-2')).toBe(false)
    expect(await holderOf(r, 'user_maya')).toBe('worker-1')
    expect(await acquire(r, 'user_maya', 'worker-1')).toBe(true) // renewed
    await release(r, 'user_maya', 'worker-2') // not its lock: nothing happens
    expect(await holderOf(r, 'user_maya')).toBe('worker-1')
    await release(r, 'user_maya', 'worker-1')
    expect(await holderOf(r, 'user_maya')).toBeUndefined()
    expect(await acquire(r, 'user_maya', 'worker-2')).toBe(true)
  })

  it('lapses when its worker stops renewing it (a crash never locks a person out)', async () => {
    const r = await root(), t = Date.now()
    expect(await acquire(r, 'user_maya', 'worker-1', LOCK_TTL, t)).toBe(true)
    expect(await acquire(r, 'user_maya', 'worker-2', LOCK_TTL, t + LOCK_TTL - 1)).toBe(false)
    expect(await acquire(r, 'user_maya', 'worker-2', LOCK_TTL, t + LOCK_TTL + 1)).toBe(true)
    expect(await holderOf(r, 'user_maya')).toBe('worker-2')
  })

  it('goes to exactly one of many workers asking at once', async () => {
    const r = await root()
    const got = await Promise.all(Array.from({ length: 12 }, (_, i) => acquire(r, 'user_maya', `worker-${i}`)))
    expect(got.filter(Boolean)).toHaveLength(1)
  })

  it('of many workers taking over a stale lock at once, gives it to exactly one', async () => {
    const r = await root(), t = Date.now()
    expect(await acquire(r, 'user_maya', 'gone', LOCK_TTL, t)).toBe(true)
    for (let round = 0; round < 5; round++) {
      const later = t + (round + 1) * (LOCK_TTL + 1)
      const got = await Promise.all(Array.from({ length: 12 }, (_, i) => acquire(r, 'user_maya', `w${round}-${i}`, LOCK_TTL, later)))
      expect(got.filter(Boolean)).toHaveLength(1)
      expect(await holderOf(r, 'user_maya', later)).toBe(`w${round}-${got.indexOf(true)}`)
    }
  })

  it('keeps people apart: one person\'s lock doesn\'t block another', async () => {
    const r = await root()
    expect(await acquire(r, 'user_maya', 'worker-1')).toBe(true)
    expect(await acquire(r, 'user_sam', 'worker-2')).toBe(true)
  })

  it('treats a damaged lock file as free', async () => {
    const r = await root()
    const { lock } = await ensureSpace(r, 'user_maya')
    await writeFile(lock, 'not json')
    expect(await acquire(r, 'user_maya', 'worker-1')).toBe(true)
    expect(JSON.parse(await readFile(lock, 'utf8')).holder).toBe('worker-1')
  })
})

describe('the quota', () => {
  it('counts what is there, files only, without following links out', async () => {
    const r = await root(), outside = await root()
    const { projects } = await ensureSpace(r, 'user_maya')
    await mkdir(join(projects, 'p', 'media'), { recursive: true })
    await writeFile(join(projects, 'p', 'media', 'a.mp4'), Buffer.alloc(1000))
    await writeFile(join(projects, 'p', 'project.json'), '{}')
    await writeFile(join(outside, 'big'), Buffer.alloc(50_000))
    await symlink(join(outside, 'big'), join(projects, 'p', 'link'))
    expect(await usage(projects)).toBe(1002)
  })

  it('refuses what would not fit, and keeps a running total', async () => {
    const r = await root()
    const { dir, projects } = await ensureSpace(r, 'user_maya')
    await writeFile(join(projects, 'f'), Buffer.alloc(600))
    const q = new Quota(dir, 1000)
    expect(await q.recount()).toBe(600)
    expect(() => q.ensureRoom(400)).not.toThrow()
    expect(() => q.ensureRoom(401)).toThrow(/space is full/)
    q.add(300)
    expect(() => q.ensureRoom(101)).toThrow(expect.objectContaining({ status: 507 }))
  })

  it('keeps room free on the shared disk for everyone, whatever one person\'s quota says', async () => {
    const r = await root()
    const { dir } = await ensureSpace(r, 'user_maya')
    const q = new Quota(dir, 1024 ** 4, 0)
    await q.recount()
    expect(q.free).toBeGreaterThan(0)
    expect(q.free).toBeLessThan(Infinity)
    // a disk with less free than the reserve: nothing more, even with quota to spare
    const tight = new Quota(dir, 1024 ** 4, q.free + 1)
    await tight.recount()
    expect(() => tight.ensureRoom(0)).toThrow(/out of room/)
    const roomy = new Quota(dir, 1024 ** 4, 1000)
    await roomy.recount()
    roomy.free = 1500
    expect(() => roomy.ensureRoom(500)).not.toThrow()
    roomy.add(400)
    expect(roomy.free).toBe(1100)
    expect(() => roomy.ensureRoom(101)).toThrow(expect.objectContaining({ status: 507 }))
  })
})

describe('paths stay inside the space', () => {
  it('allows the space\'s own projects, refuses others and links out', async () => {
    const r = await root()
    const maya = await ensureSpace(r, 'user_maya'), sam = await ensureSpace(r, 'user_sam')
    await mkdir(join(maya.projects, 'film'))
    await mkdir(join(sam.projects, 'secret'))
    await symlink(join(sam.projects, 'secret'), join(maya.projects, 'sneaky'))
    expect(await within(maya.projects, join(maya.projects, 'film'))).toBe(true)
    expect(await within(maya.projects, join(sam.projects, 'secret'))).toBe(false)
    expect(await within(maya.projects, join(maya.projects, 'sneaky'))).toBe(false)
    expect(await within(maya.projects, join(maya.projects, '..', '..', 'user_sam', 'projects', 'secret'))).toBe(false)
    expect(await within(maya.projects, join(maya.projects, 'missing'))).toBe(false)
  })
})

describe('the session a worker slot opens', () => {
  it('is remembered across a restart, and refuses a bad id', async () => {
    const slot = await root()
    expect(await readSession(slot)).toBeUndefined()
    await writeSession(slot, 'user_maya')
    expect(await readSession(slot)).toBe('user_maya')
    await writeSession(slot, undefined)
    expect(await readSession(slot)).toBeUndefined()
    await expect(writeSession(slot, '../x')).rejects.toThrow()
    await writeFile(join(slot, 'session.json'), JSON.stringify({ user: '../etc' }))
    expect(await readSession(slot)).toBeUndefined()
  })
})
