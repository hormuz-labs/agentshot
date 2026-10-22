// Skills: folders with a SKILL.md (frontmatter name + description, then instructions), bundled with the app and updated
// with it — nothing else is read, so the skills always match the tools the app has. A profile says which skills are on;
// the agent sees the enabled skills' descriptions and reads a SKILL.md before work it covers. Lasting corrections from the
// user go to memory, not into skills.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type Skill = { id: string; name: string; description: string; path: string }
export type Profile = { id: string; name: string; /** when set, only these skills */ only?: string[]; disabled: string[] }

const slug = (s: string) => {
  const n = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(n) ? `${n}-profile` : n
}

export class Skills {
  constructor(private dirs: { bundled: string; profiles: string }) {
    mkdirSync(dirs.profiles, { recursive: true })
  }

  /** Every bundled skill. */
  list(): Skill[] {
    const dir = this.dirs.bundled
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
      return [{ id, name: field('name') || id, description: field('description'), path }]
    })
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
      `SKILL.md (and any files it names) with the read tool, and follow it. Skills are part of Manul and read-only; when the user ` +
      `corrects how something should be done for good, save it with remember.\n` +
      on.map(k => `- ${k.id} (${k.path}): ${k.description.slice(0, 400)}`).join('\n')
  }
}
