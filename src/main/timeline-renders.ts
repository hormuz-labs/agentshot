// A render owns its files until they are complete. Chat, Save version and Export can request the same edit together.
import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { sameCut, type Timeline } from '../shared/timeline'
import type { Project, Version } from '../shared/types'

type Output = { final: string; out: string }

/** Encode privately, then publish to new immutable paths. Failed/cancelled renders leave no playable partial file. */
export async function renderOutput(dir: string, kind: 'timeline' | 'mix', mixed: boolean, render: (o: Output) => Promise<void>) {
  const name = `${kind}-${randomUUID()}`
  const temp = join('renders', `.${name}`)
  const final = join('renders', `${name}.mp4`), dry = mixed ? join('renders', `${name}.dry.mp4`) : undefined
  await mkdir(join(dir, temp), { recursive: true })
  try {
    const pending = join(temp, 'film.mp4'), pendingDry = mixed ? join(temp, 'dry.mp4') : undefined
    await render({ final: pending, out: pendingDry || pending })
    if (dry) await rename(join(dir, pendingDry!), join(dir, dry))
    await rename(join(dir, pending), join(dir, final))
    return { final, dry }
  } catch (e) {
    await Promise.all([final, ...(dry ? [dry] : [])].map(rel => rm(join(dir, rel), { force: true })))
    throw e
  } finally { await rm(join(dir, temp), { recursive: true, force: true }) }
}

type Work = { base: string; timeline: Timeline; clips: string; by: 'agent' | 'user'; propose: boolean; promise: Promise<string> }
type Dependencies = {
  render(p: Project, tl: Timeline, title: string, signal?: AbortSignal): Promise<{ final: string; dry?: string }>
  addVersion(p: Project, file: string, title: string, by: Version['by'], tl: Timeline, dry?: string): Promise<Version>
  checkpoint(p: Project, message: string): Promise<void>
  preview(p: Project, file: string): void
}

export class TimelineRenders {
  private running = new Map<string, Work[]>()
  private latest = new WeakMap<Project, Work>()
  constructor(private deps: Dependencies) {}

  request(p: Project, tl: Timeline, title: string, by: 'agent' | 'user' = 'agent', propose = by === 'agent', signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const active = this.running.get(p.dir) || []
    // Clip content can change without changing the timeline's clip ids.
    const clips = JSON.stringify(p.clips || {})
    const existing = active.find(w => w.base === p.current && w.clips === clips && sameCut(w.timeline, tl))
    if (existing) {
      // A user's Save/Export shares the chat render and makes the result current, rather than rendering it twice.
      if (!propose) { existing.propose = false; existing.by = by }
      return existing.promise
    }
    const snapshot = structuredClone(tl), before = structuredClone(p.timeline), base = p.current
    const work: Work = { base, timeline: snapshot, clips, by, propose, promise: undefined! }
    work.promise = Promise.resolve().then(async () => {
      const files = await this.deps.render(p, snapshot, title, signal)
      signal?.throwIfAborted()
      const v = await this.deps.addVersion(p, join(p.dir, files.final), title, work.by, snapshot, files.dry && join(p.dir, files.dry))
      v.by = work.by
      // A late render may be saved/exported, but must not reset newer live edits or a version the user switched to.
      if (this.latest.get(p) === work && p.current === base && sameCut(p.timeline, before)) {
        if (work.propose) {
          if (p.proposal) p.versions = p.versions.filter(x => x.id !== p.proposal)
          p.proposal = v.id
        } else {
          const proposed = p.versions.find(x => x.id === p.proposal)
          if (proposed?.timeline && sameCut(proposed.timeline, snapshot)) {
            p.versions = p.versions.filter(x => x.id !== p.proposal)
            p.proposal = undefined
          }
          p.current = v.id
          p.timeline = structuredClone(snapshot)
        }
      }
      await this.deps.checkpoint(p, work.propose ? `Proposed “${title}”` : title)
      this.deps.preview(p, v.path)
      if (v.dry) this.deps.preview(p, v.dry)
      return v.id
    }).finally(() => {
      const remaining = (this.running.get(p.dir) || []).filter(w => w !== work)
      if (remaining.length) this.running.set(p.dir, remaining)
      else this.running.delete(p.dir)
    })
    this.latest.set(p, work)
    this.running.set(p.dir, [...active, work])
    return work.promise
  }
}
