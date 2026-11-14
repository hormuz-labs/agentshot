import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Skills } from '../src/main/skills'

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'agentshot-skills-'))
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

describe('bundled skills', () => {
  // GitHub, Claude and other tools read the frontmatter as strict YAML: an unquoted "a: b" in a description breaks it.
  it('have frontmatter that is valid YAML with a name and description', async () => {
    const { load } = await import('js-yaml')
    const { readdirSync } = await import('node:fs')
    const dir = join(__dirname, '..', 'resources', 'skills')
    for (const id of readdirSync(dir)) {
      const path = join(dir, id, 'SKILL.md')
      if (!existsSync(path)) continue
      const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))
      expect(head, id).toBeTruthy()
      const meta = load(head![1]) as { name?: string; description?: string }
      expect(meta.name, id).toBe(id)
      expect(meta.description?.length, id).toBeGreaterThan(20)
    }
  })
})

// A person's own skills: plain files in their own folder, written from Settings → Skills.
describe('a person’s own skills', () => {
  function own() {
    const base = setup()
    const dir = join(base.bundled, '..', 'mine')
    return { ...base, dir, s: new Skills({ bundled: base.bundled, profiles: base.profiles, own: dir }) }
  }
  const draft = { name: 'My podcast style', description: 'Editing episodes of my podcast', body: '- Open on the strongest line.\n- Never cut a laugh.' }

  it('there are none, and none can be written, where no folder was given for them', () => {
    const { s } = setup()
    expect(s.list().every(k => !k.own)).toBe(true)
    expect(() => s.saveOwn(draft)).toThrow(/aren’t available/)
    expect(() => s.own('my-podcast-style')).toThrow(/aren’t available/)
    expect(() => s.removeOwn('motion-design')).toThrow(/aren’t available/)
  })

  it('writes a skill as a plain file, listed after the built-in ones under the name it was given', () => {
    const { s, dir } = own()
    const made = s.saveOwn(draft)
    expect(made).toEqual({ id: 'my-podcast-style', name: 'My podcast style', description: 'Editing episodes of my podcast', path: join(dir, 'my-podcast-style', 'SKILL.md'), own: true })
    expect(readFileSync(made.path, 'utf8')).toBe(
      '---\nname: my-podcast-style\ntitle: >-\n  My podcast style\ndescription: >-\n  Editing episodes of my podcast\n---\n\n- Open on the strongest line.\n- Never cut a laugh.\n')
    expect(s.list().map(k => [k.id, !!k.own])).toEqual([['motion-design', false], ['talking-head', false], ['my-podcast-style', true]])
    expect(s.own('my-podcast-style')).toEqual({ id: 'my-podcast-style', ...draft })
  })

  it('keeps whatever was typed, and writes a file any YAML reader understands', async () => {
    const { s } = own()
    const awkward = {
      name: 'Reels: "fast" & #loud',
      description: "Shorts — when I say 'make it pop': use this, not: the default",
      body: '---\nname: not-the-header\n---\n\n# Rules\n\tkeep: this\n\n  indented line\n- a: b\n',
    }
    const made = s.saveOwn(awkward)
    expect(made).toMatchObject({ id: 'reels-fast-loud', name: awkward.name, description: awkward.description })
    expect(s.own(made.id)).toEqual({ id: made.id, name: awkward.name, description: awkward.description, body: awkward.body.trim() })
    const { load } = await import('js-yaml')
    const header = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(made.path, 'utf8'))![1]
    expect(load(header)).toEqual({ name: 'reels-fast-loud', title: awkward.name, description: awkward.description })
  })

  it('folds line breaks and runs of spaces in the name and “when to use it” into one line', () => {
    const { s } = own()
    const made = s.saveOwn({ name: '  My\n  style ', description: 'For   podcasts\nand\ttalks ', body: 'x' })
    expect(made).toMatchObject({ name: 'My style', description: 'For podcasts and talks' })
    expect(readFileSync(made.path, 'utf8').split('\n').slice(0, 7)).toEqual(['---', 'name: my-style', 'title: >-', '  My style', 'description: >-', '  For podcasts and talks', '---'])
  })

  it('gives each skill an id of its own, never a built-in skill’s', () => {
    const { s } = own()
    expect(s.saveOwn(draft).id).toBe('my-podcast-style')
    expect(s.saveOwn(draft).id).toBe('my-podcast-style-2')
    expect(s.saveOwn(draft).id).toBe('my-podcast-style-3')
    expect(s.saveOwn({ ...draft, name: 'Motion design' }).id).toBe('motion-design-2')
    expect(s.saveOwn({ ...draft, name: '日本語' }).id).toBe('skill')
    expect(s.saveOwn({ ...draft, name: '!!!' }).id).toBe('skill-2')
    expect(s.saveOwn({ ...draft, name: 'x'.repeat(60) }).id).toHaveLength(40)
    expect(s.saveOwn({ ...draft, name: 'x'.repeat(59) }).id).toBe(`${'x'.repeat(36)}-2`)
    expect(s.list().filter(k => !k.own).map(k => k.id)).toEqual(['motion-design', 'talking-head'])
    expect(new Set(s.list().map(k => k.id)).size).toBe(s.list().length)
  })

  it('changes a skill in place: renaming it keeps its id, so profiles still mean it', () => {
    const { s } = own()
    const made = s.saveOwn(draft)
    s.setEnabled(made.id, false)
    const changed = s.saveOwn({ id: made.id, name: 'Podcast, v2', description: 'Every episode', body: 'New rules.' })
    expect(changed).toMatchObject({ id: 'my-podcast-style', name: 'Podcast, v2', description: 'Every episode' })
    expect(s.own(made.id).body).toBe('New rules.')
    expect(s.list().filter(k => k.own)).toHaveLength(1)
    expect(s.enabled().map(k => k.id)).not.toContain(made.id)
  })

  it('refuses a skill that says nothing, or more than can be kept in mind', () => {
    const { s } = own()
    expect(() => s.saveOwn({ ...draft, name: '  ' })).toThrow('Give the skill a name.')
    expect(() => s.saveOwn({ ...draft, name: 'x'.repeat(61) })).toThrow(/under 60 characters/)
    expect(() => s.saveOwn({ ...draft, description: '\n' })).toThrow(/Say when to use it/)
    expect(() => s.saveOwn({ ...draft, description: 'x'.repeat(401) })).toThrow(/under 400 characters/)
    expect(() => s.saveOwn({ ...draft, body: ' \n ' })).toThrow('Say what to do.')
    expect(() => s.saveOwn({ ...draft, body: 'x'.repeat(20_001) })).toThrow(/20,000 characters/)
    expect(() => s.saveOwn({ name: undefined, description: undefined, body: undefined } as never)).toThrow('Give the skill a name.')
    expect(s.list().some(k => k.own)).toBe(false)
    expect(s.saveOwn({ ...draft, name: 'x'.repeat(60), description: 'x'.repeat(400), body: 'x'.repeat(20_000) }).own).toBe(true)
  })

  it('keeps at most fifty', () => {
    const { s } = own()
    for (let i = 0; i < 50; i++) s.saveOwn({ ...draft, name: `Style ${i}` })
    expect(() => s.saveOwn({ ...draft, name: 'One more' })).toThrow(/50 skills of your own/)
    // changing one of the fifty is still fine
    expect(s.saveOwn({ ...draft, id: 'style-0', name: 'Style zero' }).name).toBe('Style zero')
  })

  it('only changes or deletes the person’s own, and never reaches outside their folder', () => {
    const { s, bundled, dir } = own()
    const made = s.saveOwn(draft)
    writeFileSync(join(dir, '..', 'outside.txt'), 'keep me')
    for (const id of ['motion-design', '../bundled/motion-design', '..', '.', '', 'a/b', 'A', 'no-such-skill', `${made.id}/../../outside.txt`]) {
      expect(() => s.removeOwn(id), id).toThrow(/No skill of yours/)
      expect(() => s.own(id), id).toThrow(/No skill of yours/)
      expect(() => s.saveOwn({ ...draft, id }), id).toThrow(/No skill of yours/)
    }
    expect(existsSync(join(bundled, 'motion-design', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(dir, '..', 'outside.txt'), 'utf8')).toBe('keep me')
    expect(s.list()).toHaveLength(3)
  })

  it('deletes a skill and forgets it in every profile', () => {
    const { s, dir, profiles } = own()
    const a = s.saveOwn(draft), b = s.saveOwn({ ...draft, name: 'Reels' })
    s.setEnabled(a.id, false)
    const narrow = s.createProfile('Narrow', ['motion-design', a.id, b.id])
    s.removeOwn(a.id)
    expect(existsSync(join(dir, a.id))).toBe(false)
    expect(s.list().filter(k => k.own).map(k => k.id)).toEqual([b.id])
    expect(JSON.parse(readFileSync(join(profiles, 'default.json'), 'utf8')).disabled).toEqual([])
    expect(JSON.parse(readFileSync(join(profiles, `${narrow.id}.json`), 'utf8')).only).toEqual(['motion-design', b.id])
    expect(() => s.removeOwn(a.id)).toThrow(/No skill of yours/)
    // a skill written afterwards under the same name starts on, not carrying the old one's off switch
    expect(s.saveOwn(draft).id).toBe(a.id)
    expect(s.enabled().map(k => k.id)).toContain(a.id)
  })

  it('is on once written, and switched off and on per profile like any skill', () => {
    const { s } = own()
    const made = s.saveOwn(draft)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', 'talking-head', made.id])
    s.setEnabled(made.id, false)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', 'talking-head'])
    const other = s.createProfile('Clients')
    s.useProfile(other.id)
    expect(s.enabled().map(k => k.id)).toContain(made.id)
    // a profile made from a chosen few skills takes a new one only when it is switched on there
    const narrow = s.createProfile('Narrow', ['motion-design'])
    s.useProfile(narrow.id)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design'])
    s.setEnabled(made.id, true)
    expect(s.enabled().map(k => k.id)).toEqual(['motion-design', made.id])
  })

  it('tells the agent which skills are the person’s, and that theirs win', () => {
    const { s } = own()
    const before = s.prompt()
    expect(before).not.toMatch(/theirs/)
    const made = s.saveOwn(draft)
    const p = s.prompt()
    expect(p).toContain(`- my-podcast-style, theirs (${made.path}): Editing episodes of my podcast`)
    expect(p).toMatch(/Where one of theirs and a built-in skill disagree, theirs wins\./)
    expect(p).toContain('- motion-design (')
    // switched off, it is not mentioned at all
    s.setEnabled(made.id, false)
    expect(s.prompt()).toBe(before)
  })

  it('takes a skill folder dropped in by hand, but not one posing as a built-in skill or with a name that isn’t an id', () => {
    const { s, dir, skill } = own()
    skill(dir, 'from-elsewhere', 'A skill copied from another tool')
    skill(dir, 'motion-design', 'An impostor')
    skill(dir, 'Bad Name', 'Not an id')
    mkdirSync(join(dir, 'empty'))
    expect(s.list().filter(k => k.own)).toEqual([{ id: 'from-elsewhere', name: 'from-elsewhere', description: 'A skill copied from another tool', path: join(dir, 'from-elsewhere', 'SKILL.md'), own: true }])
    expect(s.list().find(k => k.id === 'motion-design')).toMatchObject({ description: 'Make motion clips' })
    expect(s.own('from-elsewhere')).toEqual({ id: 'from-elsewhere', name: 'from-elsewhere', description: 'A skill copied from another tool', body: '# from-elsewhere\nbody' })
  })
})
