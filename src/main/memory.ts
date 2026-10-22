// Long-term memory across conversations and projects: one fact per Markdown file plus a MEMORY.md index that goes into
// the agent's prompt. The agent saves what the user teaches it (taste, rules, corrections); the user can read, edit or
// delete any memory in Settings.
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type MemoryItem = { name: string; description: string; body: string }

const slug = (s: string) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)

export class Memory {
  constructor(readonly dir: string) { mkdirSync(dir, { recursive: true }) }

  private get indexFile() { return join(this.dir, 'MEMORY.md') }

  private name(name: string): string {
    const n = slug(name)
    // Preserve persisted IDs, including memory.md on case-sensitive filesystems. An existsSync check could
    // mistake MEMORY.md for that fact on Windows; exact directory entries keep the index safe.
    if (readdirSync(this.dir).includes(`${n}.md`)) return n
    return /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|memory)$/.test(n) ? `${n}-item` : n
  }

  index(): string[] {
    return existsSync(this.indexFile) ? readFileSync(this.indexFile, 'utf8').split(/\r?\n/).filter(Boolean) : []
  }

  remember(name: string, description: string, body: string): string {
    const n = this.name(name)
    if (!n) throw new Error('A memory needs a name made of letters or digits.')
    const d = description.replace(/\s+/g, ' ').trim()
    writeFileSync(join(this.dir, `${n}.md`), `---\nname: ${n}\ndescription: ${d}\n---\n\n${body.trim()}\n`)
    const keep = this.index().filter(l => !l.includes(`(${n}.md)`))
    writeFileSync(this.indexFile, [...keep, `- [${n}](${n}.md) — ${d}`].join('\n') + '\n')
    return n
  }

  forget(name: string) {
    const n = this.name(name)
    try { unlinkSync(join(this.dir, `${n}.md`)) } catch { /* already gone */ }
    writeFileSync(this.indexFile, this.index().filter(l => !l.includes(`(${n}.md)`)).map(l => l + '\n').join(''))
  }

  list(): MemoryItem[] {
    return readdirSync(this.dir).filter(f => f.endsWith('.md') && f !== 'MEMORY.md').sort().map(f => {
      const raw = readFileSync(join(this.dir, f), 'utf8').replace(/\r\n/g, '\n')
      const head = /^---\n([\s\S]*?)\n---\n\n?/.exec(raw)
      const field = (k: string) => (head && new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(head[1])?.[1]) || ''
      return { name: field('name') || f.replace(/\.md$/, ''), description: field('description'), body: (head ? raw.slice(head[0].length) : raw).trim() }
    })
  }

  prompt(): string {
    return `Long-term memory (${this.dir}), kept across conversations and projects. Save what the user teaches you about their taste, ` +
      `rules and corrections with the remember tool (one fact per memory, then **Why:** and **How to apply:**); update a memory ` +
      `instead of duplicating it; read a memory file with the read tool when its line looks relevant; forget memories that ` +
      `turned out wrong.\n` + (this.index().join('\n') || '(empty)')
  }
}
