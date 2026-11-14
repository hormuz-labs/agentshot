// Skills: folders with a SKILL.md (frontmatter name + description, then instructions). The built-in ones come with the
// app and are updated with it, so they always match the tools the app has. A person can add their own, which say how
// they want their videos made: plain files in their own folder, never sent anywhere by this module. A profile says which
// skills are on; the agent sees the enabled skills' descriptions and reads a SKILL.md before work it covers. Lasting
// corrections from the user go to memory, not into skills.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Skill = { id: string; name: string; description: string; path: string; /** written by this person */ own?: boolean }
/** A person's own skill as they write it: a name, when it applies, and what to do. */
export type OwnSkill = { id?: string; name: string; description: string; body: string }
/** How much one of a person's skills may hold. The whole of it is read by the agent, so it has to stay readable. */
export const OWN_LIMITS = { name: 60, description: 400, body: 20_000, count: 50 }
const OWN_ID = /^[a-z0-9][a-z0-9-]{0,59}$/
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
export type Profile = { id: string; name: string; /** when set, only these skills */ only?: string[]; disabled: string[] }

const slug = (s: string) => {
  const n = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(n) ? `${n}-profile` : n
}

export class Skills {
  constructor(private dirs: { bundled: string; profiles: string; /** the person's own skills; without it there are none */ own?: string }) {
    mkdirSync(dirs.profiles, { recursive: true })
    if (dirs.own) mkdirSync(dirs.own, { recursive: true })
  }

  private read(dir: string, own: boolean): Skill[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).sort().flatMap(id => {
      const path = join(dir, id, 'SKILL.md')
      if (!existsSync(path)) return []
      const head = /^---\n([\s\S]*?)\n---/.exec(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'))
      const field = (k: string) => {
        const m = head && new RegExp(`^${k}:[ \\t]*(.*)$((?:\\n[ \\t]+.*)*)`, 'm').exec(head[1])
        if (!m) return ''
        // a YAML block (| or >) or a value continued on indented lines: joined into one line
        const v = /^[|>][+-]?$/.test(m[1].trim()) ? m[2] : `${m[1]}${m[2]}`
        return v.split('\n').map(s => s.trim()).filter(Boolean).join(' ')
      }
      // one of a person's own shows the name they gave it; its `name` stays a plain id, as other tools expect of a skill
      return [{ id, name: (own && field('title')) || field('name') || id, description: field('description'), path, ...(own ? { own: true } : {}) }]
    })
  }

  /** Every skill: the built-in ones, then the person's own. One of theirs in a folder named like a built-in skill is
   *  left out, so a skill's id always means one thing. */
  list(): Skill[] {
    const builtIn = this.read(this.dirs.bundled, false)
    const taken = new Set(builtIn.map(k => k.id))
    return [...builtIn, ...(this.dirs.own ? this.read(this.dirs.own, true).filter(k => OWN_ID.test(k.id) && !taken.has(k.id)) : [])]
  }

  // ---------------------------------------------------------------- a person's own skills
  private ownDir(id: string) {
    if (!this.dirs.own) throw new Error('Your own skills aren’t available here.')
    if (typeof id !== 'string' || !OWN_ID.test(id) || !this.list().some(k => k.own && k.id === id)) throw new Error(`No skill of yours called "${id}".`)
    return join(this.dirs.own, id)
  }

  /** One of the person's own skills, as they wrote it. */
  own(id: string): OwnSkill {
    const dir = this.ownDir(id)
    const text = readFileSync(join(dir, 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n')
    const k = this.list().find(k => k.id === id)!
    return { id, name: k.name, description: k.description, body: text.replace(/^---\n[\s\S]*?\n---\n?/, '').trim() }
  }

  /** Writes one of the person's own skills: a new one, or (with its id) one they are changing. Its id never changes,
   *  so the profiles that switched it off still mean it. */
  saveOwn(draft: OwnSkill): Skill {
    if (!this.dirs.own) throw new Error('Your own skills aren’t available here.')
    // what arrives here was typed into a form in the window: take it as text or as nothing
    const text = (v: unknown) => (typeof v === 'string' ? v : '')
    const name = oneLine(text(draft?.name)), description = oneLine(text(draft?.description)), body = text(draft?.body).replace(/\r\n/g, '\n').trim()
    if (!name) throw new Error('Give the skill a name.')
    if (name.length > OWN_LIMITS.name) throw new Error(`Keep the name under ${OWN_LIMITS.name} characters.`)
    if (!description) throw new Error('Say when to use it: AgentShot reads that line to decide whether the skill applies.')
    if (description.length > OWN_LIMITS.description) throw new Error(`Keep “when to use it” under ${OWN_LIMITS.description} characters. The detail goes in what to do.`)
    if (!body) throw new Error('Say what to do.')
    if (body.length > OWN_LIMITS.body) throw new Error(`That is longer than AgentShot can keep in mind at once (${OWN_LIMITS.body.toLocaleString('en-US')} characters). Split it into two skills.`)
    const all = this.list()
    let id = draft.id
    if (id != null) this.ownDir(text(id))
    else {
      if (all.filter(k => k.own).length >= OWN_LIMITS.count) throw new Error(`You have ${OWN_LIMITS.count} skills of your own, which is the most AgentShot keeps. Delete one you no longer use.`)
      const base = slug(name) || 'skill'
      id = base
      for (let n = 2; all.some(k => k.id === id) || existsSync(join(this.dirs.own, id!)); n++) id = `${base.slice(0, 36)}-${n}`
    }
    const dir = join(this.dirs.own, id)
    mkdirSync(dir, { recursive: true })
    // block scalars, so whatever the person typed is valid YAML for anything else that reads a skill
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${id}\ntitle: >-\n  ${name}\ndescription: >-\n  ${description}\n---\n\n${body}\n`)
    return this.list().find(k => k.id === id)!
  }

  /** Deletes one of the person's own skills, and forgets it in every profile. */
  removeOwn(id: string) {
    rmSync(this.ownDir(id), { recursive: true, force: true })
    for (const p of this.profiles()) {
      if (!p.disabled.includes(id) && !p.only?.includes(id)) continue
      this.save({ ...p, disabled: p.disabled.filter(x => x !== id), ...(p.only ? { only: p.only.filter(x => x !== id) } : {}) })
    }
  }

  // ---------------------------------------------------------------- profiles
  private file = (id: string) => join(this.dirs.profiles, `${id}.json`)
  private get activeFile() { return join(this.dirs.profiles, 'active') }

  profiles(): Profile[] {
    const list = readdirSync(this.dirs.profiles).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(this.dirs.profiles, f), 'utf8')) as Profile)
    return list.some(p => p.id === 'default') ? list : [{ id: 'default', name: 'Default', disabled: [] }, ...list]
  }

  profile(): Profile {
    const id = existsSync(this.activeFile) ? readFileSync(this.activeFile, 'utf8').trim() : 'default'
    return this.profiles().find(p => p.id === id) || { id: 'default', name: 'Default', disabled: [] }
  }

  private save(p: Profile) { writeFileSync(this.file(p.id), JSON.stringify(p, null, 1)) }

  createProfile(name: string, skills?: string[]): Profile {
    const id = slug(name) || 'profile'
    const p: Profile = { id, name, ...(skills ? { only: skills } : {}), disabled: [] }
    this.save(p)
    return p
  }

  useProfile(id: string) {
    if (!this.profiles().some(p => p.id === id)) throw new Error(`No profile "${id}".`)
    writeFileSync(this.activeFile, id)
  }

  enabled(): Skill[] {
    const p = this.profile()
    return this.list().filter(k => (!p.only || p.only.includes(k.id)) && !p.disabled.includes(k.id))
  }

  setEnabled(id: string, on: boolean) {
    const p = this.profile()
    if (p.only) p.only = on ? [...new Set([...p.only, id])] : p.only.filter(x => x !== id)
    p.disabled = on ? p.disabled.filter(x => x !== id) : [...new Set([...p.disabled, id])]
    this.save(p)
  }

  prompt(): string {
    const on = this.enabled()
    if (!on.length) return ''
    return `Skills (profile "${this.profile().name}"). Each holds how a kind of work should be done. Before work a skill covers, read its ` +
      `SKILL.md (and any files it names) with the read tool, and follow it. Skills are part of AgentShot and read-only; when the user ` +
      `corrects how something should be done for good, save it with remember.\n` +
      (on.some(k => k.own) ? `Those marked "theirs" were written by the user and say how they want their own videos made. Where one of theirs and ` +
        `a built-in skill disagree, theirs wins. They change them in Settings → Skills; don't offer to edit the files.\n` : '') +
      on.map(k => `- ${k.id}${k.own ? ', theirs' : ''} (${k.path}): ${k.description.slice(0, 400)}`).join('\n')
  }
}
