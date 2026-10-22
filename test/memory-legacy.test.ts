// A literal filesystem fixture lets legacy Unix device-name files be tested on Windows too.
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Memory } from '../src/main/memory'

const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }))
const dir = 'legacy-memory'
vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const { basename } = await import('node:path')
  return {
    ...actual,
    mkdirSync: () => {},
    readdirSync: () => [...files.keys()].map(f => basename(f)),
    existsSync: (path: string) => [...files.keys()].some(f => f.toLowerCase() === path.toLowerCase()),
    readFileSync: (path: string) => {
      if (!files.has(path)) throw new Error('ENOENT')
      return files.get(path)!
    },
    writeFileSync: (path: string, data: string) => files.set(path, data),
    unlinkSync: (path: string) => files.delete(path),
  }
})

const fact = (name: string) => {
  files.set(join(dir, `${name}.md`), `---\r\nname: ${name}\r\ndescription: legacy\r\n---\r\n\r\nOriginal fact.\r\n`)
  const index = join(dir, 'MEMORY.md')
  files.set(index, (files.get(index) || '') + `- [${name}](${name}.md)\r\n`)
}

describe('persisted memory IDs', () => {
  beforeEach(() => files.clear())

  it.each(['con', 'prn', 'aux', 'nul', 'com1', 'lpt9', 'memory'])('updates and forgets legacy %s.md without remapping it', name => {
    fact(name)
    const m = new Memory(dir)
    expect(m.list()).toEqual([{ name, description: 'legacy', body: 'Original fact.' }])
    expect(m.remember(name.toUpperCase(), 'updated', 'New fact.')).toBe(name)
    expect(m.list()).toEqual([{ name, description: 'updated', body: 'New fact.' }])
    expect(m.index()).toHaveLength(1)
    expect(m.index()[0]).toContain(`(${name}.md)`)
    expect(files.has(join(dir, `${name}-item.md`))).toBe(false)
    m.forget(name)
    expect(m.list()).toEqual([])
    expect(m.index()).toEqual([])
  })

  it('preserves both facts when legacy and portable IDs coexist', () => {
    fact('con')
    fact('con-item')
    const m = new Memory(dir)
    const portable = files.get(join(dir, 'con-item.md'))
    m.remember('CON', 'updated', 'Updated legacy fact.')
    expect(files.get(join(dir, 'con-item.md'))).toBe(portable)
    expect(m.index()).toHaveLength(2)
    m.forget('con')
    expect(files.get(join(dir, 'con-item.md'))).toBe(portable)
    expect(m.list()).toEqual([{ name: 'con-item', description: 'legacy', body: 'Original fact.' }])
    expect(m.index()).toEqual(['- [con-item](con-item.md)'])
  })

  it('never treats the uppercase index as a legacy memory.md fact', () => {
    fact('pace')
    const m = new Memory(dir)
    m.forget('memory')
    expect(m.index()).toEqual(['- [pace](pace.md)'])
    expect(m.remember('memory', 'new', 'A real fact.')).toBe('memory-item')
    expect(m.list().map(f => f.name)).toEqual(['memory-item', 'pace'])
    expect(m.index()).toHaveLength(2)
  })
})
