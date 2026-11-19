import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Segment, Transcript } from '../shared/types'
import { TranscriptionQueue } from './transcription-queue'

export type TranscriptRange = { t0: number; t1: number }
export const TRANSCRIPT_CHUNK = 60
export const validRange = (r: TranscriptRange) => Number.isFinite(r.t0) && Number.isFinite(r.t1) && r.t0 >= 0 && r.t1 > r.t0
export function validTranscript(t: Transcript) {
  return !!t && typeof t.language === 'string' && typeof t.model === 'string' && Array.isArray(t.segments) &&
    t.segments.every(s => s && Number.isFinite(s.s) && Number.isFinite(s.e) && s.e >= s.s && typeof s.text === 'string' &&
      Array.isArray(s.words) && s.words.every(w => w && typeof w.w === 'string' && Number.isFinite(w.s) && Number.isFinite(w.e) && w.s >= 0 && w.e >= w.s))
}
export async function fileRevision(file: string) {
  const s = await stat(file, { bigint: true })
  return [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].map(String).join(':')
}
export async function atomicTranscript(file: string, t: Transcript) {
  const tmp = `${file}.${randomUUID()}.tmp`
  try { await writeFile(tmp, JSON.stringify(t)); await rename(tmp, file) }
  finally { await rm(tmp, { force: true }) }
}

export function wordsInRange(segments: Segment[], range: TranscriptRange): Segment[] {
  return segments.flatMap(s => {
    const words = s.words.filter(w => (w.s + w.e) / 2 >= range.t0 && (w.s + w.e) / 2 < range.t1)
    return words.length ? [{ ...s, s: words[0].s, e: words.at(-1)!.e, text: words.map(w => w.w).join(' '), words }] : []
  })
}

/** Independent alignments can put the same boundary word's midpoint on opposite
 * sides of a seam. Collapse only equal words whose time intervals overlap there. */
export function stitchChunks(chunks: Segment[][]): Segment[] {
  const out: Segment[] = []
  const normalize = (s: string) => s.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
  for (const segments of chunks) {
    const previous = out.at(-1)?.words.at(-1)
    let first = true
    for (const segment of segments) {
      let words = segment.words
      if (first && previous && words.length) {
        const next = words[0], text = normalize(next.w)
        if (text && text === normalize(previous.w) && next.s < previous.e && next.e > previous.s) words = words.slice(1)
      }
      if (segment.words.length) first = false
      if (words.length) out.push({ ...segment, s: words[0].s, e: words.at(-1)!.e, text: words.map(w => w.w).join(' '), words })
    }
  }
  return out
}

type Request = {
  file: string; cache: string; duration: number; profile: string; range?: TranscriptRange; background?: boolean
  run(range: TranscriptRange): Promise<Transcript>
  progress?(completedSeconds: number, totalSeconds: number): void
}

/** Both full indexing and excerpts use the same source-clock chunks and immutable cache identity. */
export class TranscriptChunks {
  private inflight = new Map<string, Promise<Transcript>>()
  private foreground = new Map<string, number>()
  private demanded = new Set<string>()
  private scopes = new Map<string, Map<string, number>>()
  constructor(readonly queue = new TranscriptionQueue()) {}
  demand(file: string) { this.demanded.add(file); for (const scope of this.scopes.get(file)?.keys() || []) this.queue.promote(scope) }

  async read(o: Request): Promise<Transcript> {
    if (o.range && !validRange(o.range)) throw new Error('Invalid transcription range.')
    if (!Number.isFinite(o.duration) || o.duration <= 0) throw new Error('Cannot determine audio duration.')
    const revision = await fileRevision(o.file)
    const key = createHash('sha256').update(JSON.stringify(['chunks-v1', o.file, revision, o.profile, TRANSCRIPT_CHUNK])).digest('hex')
    const folder = join(o.cache, key)
    await mkdir(folder, { recursive: true })
    const range = o.range || { t0: 0, t1: o.duration }
    if (range.t0 >= o.duration) return { media: basename(o.file), language: 'none', model: o.profile, profile: o.profile, segments: [], createdAt: Date.now(), revision }
    const first = Math.floor(range.t0 / TRANSCRIPT_CHUNK), end = Math.min(o.duration, range.t1)
    const last = Math.ceil(end / TRANSCRIPT_CHUNK)
    const results: Transcript[] = new Array(last - first)
    const total = end - range.t0
    const scope = `${folder}/`
    const scopes = this.scopes.get(o.file) || new Map<string, number>()
    scopes.set(scope, (scopes.get(scope) || 0) + 1)
    this.scopes.set(o.file, scopes)
    if (!o.background && !o.range) { this.foreground.set(scope, (this.foreground.get(scope) || 0) + 1); this.queue.promote(scope) }
    if (!o.background && o.range) for (let i = first; i < last; i++) this.queue.promote(`${scope}${i}:`)
    let completed = 0
    try {
      const chunk = async (i: number) => {
        const core = { t0: i * TRANSCRIPT_CHUNK, t1: Math.min(o.duration, (i + 1) * TRANSCRIPT_CHUNK) }
        const path = join(folder, `${i}.json`), taskKey = `${scope}${i}:`
        let cached: Transcript | undefined
        try {
          const data = JSON.parse(await readFile(path, 'utf8')) as Transcript
          if (data.revision === revision && data.profile === o.profile && validTranscript(data)) cached = data
        } catch { /* interrupted/corrupt checkpoint: rebuild only this chunk */ }
        if (!cached) {
          let task = this.inflight.get(taskKey)
          if (!task) {
            task = this.queue.add(taskKey, !o.background || this.foreground.has(scope) || this.demanded.has(o.file), async () => {
              if (await fileRevision(o.file) !== revision) throw new Error('Media changed during transcription. Please retry.')
              const raw = await o.run({ t0: Math.max(0, core.t0 - 2), t1: Math.min(o.duration, core.t1 + 2) })
              if (await fileRevision(o.file) !== revision) throw new Error('Media changed during transcription. Please retry.')
              if (!validTranscript(raw)) throw new Error('Invalid speech recognition result.')
              const t = { ...raw, revision, profile: o.profile, segments: wordsInRange(raw.segments, core) }
              await atomicTranscript(path, t)
              return t
            }).finally(() => this.inflight.delete(taskKey))
            this.inflight.set(taskKey, task)
          }
          // Disk I/O above yields: background work may have been enqueued since the initial promotion.
          if (!o.background) this.queue.promote(taskKey)
          cached = await task
        }
        results[i - first] = cached
        completed += Math.min(core.t1, end) - Math.max(core.t0, range.t0)
        o.progress?.(completed, total)
      }
      // Feed at most two tasks per request; a long index must not flood the interactive queue.
      let next = first, failed = false, error: unknown
      const worker = async () => {
        while (next < last && !failed) {
          const i = next++
          try { await chunk(i) } catch (e) { failed = true; error = e }
        }
      }
      await Promise.all([worker(), worker()])
      if (failed) throw error
      if (await fileRevision(o.file) !== revision) throw new Error('Media changed during transcription. Please retry.')
      const languages = [...new Set(results.filter(t => t.segments.length).map(t => t.language))]
      return { media: basename(o.file), revision, profile: o.profile, language: languages.join(', ') || results[0]?.language || 'none',
        model: results[0]?.model || o.profile, createdAt: Date.now(), segments: wordsInRange(stitchChunks(results.map(t => t.segments)), range) }
    } finally {
      const active = (scopes.get(scope) || 1) - 1
      if (active) scopes.set(scope, active); else scopes.delete(scope)
      if (!scopes.size) { this.scopes.delete(o.file); this.demanded.delete(o.file) }
      if (!o.background && !o.range) {
        const count = (this.foreground.get(scope) || 1) - 1
        if (count) this.foreground.set(scope, count); else this.foreground.delete(scope)
      }
    }
  }
}
