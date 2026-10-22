import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Memory } from '../src/main/memory'

const mem = () => new Memory(mkdtempSync(join(tmpdir(), 'manul-mem-')))

describe('long-term memory', () => {
  it('saves one fact per file with an index line', () => {
    const m = mem()
    m.remember('Captions Style', 'User wants yellow captions', 'Always yellow, bottom third.\n**Why:** brand.')
    expect(readFileSync(join(m.dir, 'captions-style.md'), 'utf8')).toBe('---\nname: captions-style\ndescription: User wants yellow captions\n---\n\nAlways yellow, bottom third.\n**Why:** brand.\n')
    expect(m.index()).toEqual(['- [captions-style](captions-style.md) — User wants yellow captions'])
  })

  it('updates instead of duplicating', () => {
    const m = mem()
    m.remember('captions-style', 'old', 'a')
    m.remember('Captions style', 'new', 'b')
    expect(m.index()).toEqual(['- [captions-style](captions-style.md) — new'])
    expect(m.list()).toEqual([{ name: 'captions-style', description: 'new', body: 'b' }])
  })

  it('forgets', () => {
    const m = mem()
    m.remember('a', 'x', 'y'); m.remember('b', 'x', 'y')
    m.forget('a')
    expect(m.list().map(x => x.name)).toEqual(['b'])
    m.forget('missing') // no throw
  })

  it('renders the prompt section with the index', () => {
    const m = mem()
    expect(m.prompt()).toContain('(empty)')
    m.remember('pace', 'Cuts on the beat', 'z')
    expect(m.prompt()).toContain('- [pace](pace.md) — Cuts on the beat')
    expect(m.prompt()).toContain(m.dir)
  })

  it('rejects names that are not names', () => {
    expect(() => mem().remember('!!!', 'd', 'b')).toThrow()
  })

  it('reads CRLF frontmatter and index lines without carrying carriage returns', () => {
    const m = mem()
    writeFileSync(join(m.dir, 'pace.md'), '---\r\nname: pace\r\ndescription: Fast cuts\r\n---\r\n\r\nOn the beat.\r\nNext line.\r\n')
    writeFileSync(join(m.dir, 'MEMORY.md'), '- [pace](pace.md)\r\n')
    expect(m.index()).toEqual(['- [pace](pace.md)'])
    expect(m.list()).toEqual([{ name: 'pace', description: 'Fast cuts', body: 'On the beat.\nNext line.' }])
    m.remember('pace', 'Updated', 'New')
    expect(m.index()).toHaveLength(1)
  })

  it('makes Windows device names portable and never overwrites the case-insensitive index', () => {
    const m = mem()
    for (const name of ['CON', 'prn', 'aux', 'nul', 'COM1', 'lpt9', 'Memory']) {
      expect(m.remember(name, 'd', 'b')).toBe(`${name.toLowerCase()}-item`)
    }
    expect(m.list()).toHaveLength(7)
    m.forget('CON')
    expect(m.list()).toHaveLength(6)
    expect(m.index()).toHaveLength(6)
  })

  it.skipIf(process.platform === 'win32')('preserves real legacy files on a filesystem supporting reserved Unix IDs', () => {
    const m = mem()
    const names = ['con', 'aux', 'con-item']
    try {
      for (const name of names) writeFileSync(join(m.dir, `${name}.md`), `---\nname: ${name}\ndescription: legacy\n---\n\n${name} fact.\n`)
      writeFileSync(join(m.dir, 'MEMORY.md'), names.map(n => `- [${n}](${n}.md)`).join('\n') + '\n')
      for (const name of ['con', 'aux']) {
        expect(m.remember(name, 'updated', 'Updated fact.')).toBe(name)
        expect(m.list().find(f => f.name === name)?.body).toBe('Updated fact.')
        m.forget(name)
        expect(existsSync(join(m.dir, `${name}.md`))).toBe(false)
      }
      expect(m.list()).toEqual([{ name: 'con-item', description: 'legacy', body: 'con-item fact.' }])
      expect(m.index()).toEqual(['- [con-item](con-item.md)'])
    } finally { rmSync(m.dir, { recursive: true, force: true }) }
  })
})
