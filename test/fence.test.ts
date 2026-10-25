import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowed, FencedEnv, fenceFor, realish } from '../src/main/fence'
import { BIN } from '../src/main/media'

// A project in a temp folder (temp is writable), AgentShot's resources inside the home folder (like a dev checkout in
// ~/Documents/manul: readable, not writable), and a "secret" in the home folder (like ~/.claude) the agent must never reach.
let root: string, project: string, resources: string, secretDir: string, secretLink: string
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'agentshot-fence-'))
  project = join(root, 'proj')
  mkdirSync(project)
  writeFileSync(join(project, 'a.txt'), 'inside')
  secretDir = mkdtempSync(join(homedir(), '.agentshot-fence-test-'))
  writeFileSync(join(secretDir, 'secret.txt'), 'secret')
  resources = join(secretDir, 'res')
  mkdirSync(resources)
  writeFileSync(join(resources, 'tool.txt'), 'tool')
  try {
    symlinkSync(join(secretDir, 'secret.txt'), join(project, 'link.txt'))
    secretLink = join(project, 'link.txt')
  } catch {
    symlinkSync(secretDir, join(project, 'link-dir'), 'junction')
    secretLink = join(project, 'link-dir', 'secret.txt')
  }
  mkdirSync(`${resources}-evil`) // a look-alike: its name starts with the allowed folder's
})
afterAll(() => { rmSync(root, { recursive: true, force: true }); rmSync(secretDir, { recursive: true, force: true }) })

describe('what the agent may touch', () => {
  it('the project to read and write, resources to read, nothing in the home folder — symlinks and look-alike folders included', () => {
    const f = fenceFor({ project, resources })
    expect(allowed(f, join(project, 'a.txt'), true)).toBe(true)
    expect(allowed(f, join(project, 'new', 'b.txt'), true)).toBe(true)
    expect(allowed(f, join(resources, 'tool.txt'), false)).toBe(true)
    expect(allowed(f, join(resources, 'tool.txt'), true)).toBe(false)
    expect(allowed(f, join(secretDir, 'secret.txt'), false)).toBe(false)
    expect(allowed(f, secretLink, false)).toBe(false) // points into the home folder
    expect(allowed(f, join(`${resources}-evil`, 'x'), false)).toBe(false)
    expect(allowed(f, homedir(), false)).toBe(false)
  })

  it('realish follows symlinks even for files that don\'t exist yet', () => {
    expect(realish(secretLink)).toBe(realish(join(secretDir, 'secret.txt')))
    expect(realish(join(project, 'not', 'yet.txt'))).toBe(join(realish(project), 'not', 'yet.txt'))
  })
})

describe('the fenced environment', () => {
  const env = () => new FencedEnv({ cwd: project }, fenceFor({ project, resources }), { home: homedir(), fenceBin: join(BIN, 'agentshot-fence') })

  it('file tools read and write the project, and refuse the home folder', async () => {
    const e = env()
    expect(await e.readTextFile('a.txt', ctx)).toEqual({ ok: true, value: 'inside' })
    expect((await e.writeFile('out/b.txt', 'x', ctx)).ok).toBe(true)
    const outside = await e.readTextFile(join(secretDir, 'secret.txt'), ctx)
    expect(outside.ok).toBe(false)
    expect(!outside.ok && outside.error.code).toBe('permission_denied')
    expect((await e.readTextFile(secretLink, ctx)).ok).toBe(false)
    expect((await e.listDir(homedir(), ctx)).ok).toBe(false)
    expect((await e.writeFile(join(resources, 'x'), 'x', ctx)).ok).toBe(false)
  })

  it.runIf(process.platform === 'darwin' || process.platform === 'linux')('shell commands run in the OS sandbox: the project yes, the home folder no', async () => {
    const e = env()
    const run = async (cmd: string) => { const r = await e.exec(cmd, undefined, ctx); return r.ok ? r.value.exitCode : -1 }
    expect(await run(`cat ${join(project, 'a.txt')}`)).toBe(0)
    expect(await run(`echo hi > ${join(project, 'c.txt')}`)).toBe(0)
    expect(readFileSync(join(project, 'c.txt'), 'utf8')).toBe('hi\n')
    expect(await run(`cat ${join(resources, 'tool.txt')}`)).toBe(0)
    expect(await run(`cat ${join(secretDir, 'secret.txt')}`)).not.toBe(0)
    expect(await run(`ls ${secretDir}`)).not.toBe(0)
    expect(await run(`echo x > ${join(resources, 'y.txt')}`)).not.toBe(0)
  })
})
