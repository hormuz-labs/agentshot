// A project's history: every meaningful change (proposal, accept, reject, clip edit…) is a point you can go back to.
// It is a git repository inside the project (pure JavaScript, no git install needed) that tracks only the small text
// files that describe the film — project.json and each clip's HTML — never media or renders.
import * as git from 'isomorphic-git'
import fs from 'node:fs'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type HistoryEntry = { id: string; message: string; at: number }

const AUTHOR = { name: 'AgentShot', email: 'history@agentshot.local' }

export class History {
  constructor(readonly dir: string) {}

  /** The files history keeps: project.json and clips/<id>/clip.html. */
  private tracked(): string[] {
    const out = existsSync(join(this.dir, 'project.json')) ? ['project.json'] : []
    const clips = join(this.dir, 'clips')
    if (existsSync(clips)) for (const id of readdirSync(clips)) if (existsSync(join(clips, id, 'clip.html'))) out.push(`clips/${id}/clip.html`)
    return out
  }

  private async ready() {
    if (!existsSync(join(this.dir, '.git'))) await git.init({ fs, dir: this.dir, defaultBranch: 'main' })
  }

  /** Record the current state with a message; nothing is recorded when nothing changed. */
  async record(message: string): Promise<string | null> {
    await this.ready()
    const files = this.tracked()
    for (const f of files) await git.add({ fs, dir: this.dir, filepath: f })
    // files that disappeared (a removed clip)
    // look only at project.json and clips/ (never hash media or renders, which can be gigabytes)
    const scope = { fs, dir: this.dir, filepaths: ['project.json', 'clips'] }
    for (const [f, head, work] of await git.statusMatrix(scope)) if (head === 1 && work === 0) await git.remove({ fs, dir: this.dir, filepath: f })
    const changed = (await git.statusMatrix(scope))
      .filter(([f, head]) => files.includes(f) || head === 1)
      .some(([, head, work, stage]) => !(head === 1 && work === 1 && stage === 1))
    const hasHead = await git.resolveRef({ fs, dir: this.dir, ref: 'HEAD' }).then(() => true, () => false)
    if (hasHead && !changed) return null
    return git.commit({ fs, dir: this.dir, message, author: AUTHOR })
  }

  async log(): Promise<HistoryEntry[]> {
    if (!existsSync(join(this.dir, '.git'))) return []
    const commits = await git.log({ fs, dir: this.dir }).catch(() => [])
    return commits.map(c => ({ id: c.oid, message: c.commit.message.trim(), at: c.commit.author.timestamp * 1000 }))
  }

  async files(id: string): Promise<string[]> {
    return git.listFiles({ fs, dir: this.dir, ref: id })
  }

  /** Put the tracked files back as they were at a point; returns the clips whose HTML changed (they need re-rendering). */
  async restore(id: string): Promise<{ clips: string[] }> {
    const want = await this.files(id)
    const clips: string[] = []
    for (const f of want) {
      const { blob } = await git.readBlob({ fs, dir: this.dir, oid: id, filepath: f })
      const next = Buffer.from(blob)
      const path = join(this.dir, f)
      const before = existsSync(path) ? fs.readFileSync(path) : null
      if (before && before.equals(next)) continue
      fs.mkdirSync(join(path, '..'), { recursive: true })
      fs.writeFileSync(path, next)
      const m = /^clips\/([^/]+)\/clip\.html$/.exec(f)
      if (m) clips.push(m[1])
    }
    const entry = (await this.log()).find(e => e.id === id)
    await this.record(`Restored “${entry?.message || id.slice(0, 7)}”`)
    return { clips }
  }
}
