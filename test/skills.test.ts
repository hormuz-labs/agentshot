import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Skills } from '../src/main/skills'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'manul-skills-'))
  const bundled = join(root, 'bundled'), profiles = join(root, 'profiles')
  const skill = (dir: string, id: string, desc: string) => {
    mkdirSync(join(dir, id), { recursive: true })
    writeFileSync(join(dir, id, 'SKILL.md'), `---\nname: ${id}\ndescription: ${desc}\n---\n\n# ${id}\nbody\n`)
  }
  skill(bundled, 'motion-design', 'Make motion clips')
  skill(bundled, 'talking-head', 'Clean up talking videos')
  mkdirSync(join(bundled, 'broken'), { recursive: true }) // a folder without SKILL.md is ignored
  return { s: new Skills({ bundled, profiles }), bundled, profiles, skill }
}

describe('skills and profiles', () => {
  it('lists the bundled skills, and nothing else', () => {
    const { s } = setup()
    expect(s.list().map(k => [k.id, k.description])).toEqual([
      ['motion-design', 'Make motion clips'],
      ['talking-head', 'Clean up talking videos'],
    ])
  })

  it('reads multi-line (YAML block) descriptions', () => {
    const { s, bundled } = setup()
    mkdirSync(join(bundled, 'web'), { recursive: true })
    writeFileSync(join(bundled, 'web', 'SKILL.md'), `---\nname: web\ndescription: |\n  Drive a browser: read pages,\n  fill forms.\nother: x\n---\nbody\n`)
    expect(s.list().find(k => k.id === 'web')?.description).toBe('Drive a browser: read pages, fill forms.')
  })

  it('reads CRLF frontmatter including folded descriptions', () => {
    const { s, bundled } = setup()
    mkdirSync(join(bundled, 'windows'))
    writeFileSync(join(bundled, 'windows', 'SKILL.md'), '---\r\nname: windows\r\ndescription: >\r\n  Native commands,\r\n  portable paths.\r\n---\r\nbody\r\n')
    expect(s.list().find(k => k.id === 'windows')).toMatchObject({ name: 'windows', description: 'Native commands, portable paths.' })
  })

  it('avoids Windows reserved profile filenames', () => {
    const { s } = setup()
    for (const name of ['CON', 'prn', 'aux', 'NUL', 'COM1', 'lpt9']) {
      const p = s.createProfile(name)
      expect(p.id).toBe(`${name.toLowerCase()}-profile`)
      s.useProfile(p.id)
      expect(s.profile().id).toBe(p.id)
    }
  })

  it('the default profile has every skill on', () => {
    const { s } = setup()
    expect(s.profile()).toMatchObject({ id: 'default' })
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', 'talking-head'])
  })

  it('switches skills off and on per profile, and remembers it', () => {
    const { s, bundled, profiles } = setup()
    s.setEnabled('talking-head', false)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design'])
    const again = new Skills({ bundled, profiles })
    expect(again.enabled().map(k => k.id)).toEqual(['motion-design'])
    again.setEnabled('talking-head', true)
    expect(again.enabled()).toHaveLength(2)
  })

  it('makes and switches profiles', () => {
    const { s } = setup()
    s.createProfile('Podcasts', ['talking-head'])
    s.useProfile('podcasts')
    expect(s.profile()).toMatchObject({ id: 'podcasts', name: 'Podcasts' })
    expect(s.enabled().map(k => k.id)).toEqual(['talking-head'])
    expect(s.profiles().map(p => p.id).sort()).toEqual(['default', 'podcasts'])
  })

  it('new skills in an app update are on in the default profile', () => {
    const { s, bundled, skill } = setup()
    skill(bundled, 'new-one', 'd')
    expect(s.enabled().map(k => k.id)).toContain('new-one')
  })

  it('writes the prompt section with paths, read-only, corrections to memory', () => {
    const { s } = setup()
    const p = s.prompt()
    expect(p).toContain(join('motion-design', 'SKILL.md'))
    expect(p).toMatch(/read its SKILL\.md/i)
    expect(p).toMatch(/read-only/)
    expect(p).toMatch(/remember/)
    expect(p).not.toMatch(/fork_skill/)
  })
})

describe('bundled skills', () => {
  it('each has a name matching its folder and a description that says when to use it', () => {
    const s = new Skills({ bundled: join(import.meta.dirname, '..', 'resources', 'skills'), profiles: mkdtempSync(join(tmpdir(), 'p-')) })
    const list = s.list()
    expect(list.map(k => k.id)).toEqual(expect.arrayContaining(['cleanup-and-repair', 'motion-design', 'music-generation', 'promos-and-montages', 'short-form', 'talking-head', 'tutorials', 'video-editing']))
    for (const k of list) {
      expect(k.name).toBe(k.id)
      expect(k.description.length).toBeGreaterThan(40)
      expect(k.description).toMatch(/Read before/)
      expect(k.description.length).toBeLessThanOrEqual(400) // the agent's prompt shows 400 characters of it
    }
  })

  it('every file a skill points to (references/…) is there', () => {
    const root = join(import.meta.dirname, '..', 'resources', 'skills')
    const s = new Skills({ bundled: root, profiles: mkdtempSync(join(tmpdir(), 'p-')) })
    for (const k of s.list()) {
      for (const [ref] of readFileSync(k.path, 'utf8').matchAll(/\breferences\/[\w.-]+\.md\b/g)) {
        expect(existsSync(join(root, k.id, ref)), `${k.id}: ${ref}`).toBe(true)
      }
    }
  })
})
