import type { Transcript, Word } from '../shared/types'
import { duration, length, type Timeline } from '../shared/timeline'
import type { TranscriptRange } from './transcript-chunks'
import { groupWords } from './whisper'
import { fileRevision } from './transcript-chunks'
import { join } from 'node:path'

export async function transcriptSourcesCurrent(dir: string, tl: Timeline, output: string, sources?: Record<string, string>) {
  if (!sources) return false
  try {
    for (const src of new Set([output, ...tl.items.flatMap(i => i.kind === 'media' ? [i.src] : [])])) {
      if (!sources[src] || sources[src] !== await fileRevision(join(dir, src))) return false
    }
    return true
  } catch { return false }
}

/** Only known, unchanged speech can be mapped. Mixed/retimed camera sound needs actual listening. */
export function canMapTranscript(tl: Timeline, output: string) {
  return !tl.demo && !tl.mix?.music && !tl.mix?.voiceovers?.length &&
    tl.items.every(i => i.kind === 'media' && i.src !== output)
}

export async function transcriptFromTimeline(tl: Timeline, output: string,
  read: (src: string, range: TranscriptRange) => Promise<Transcript | null>, range?: TranscriptRange): Promise<Transcript | null> {
  if (!canMapTranscript(tl, output)) return null
  const wanted = range || { t0: 0, t1: duration(tl) }
  let at = 0
  const words: Word[] = [], languages = new Set<string>(), models = new Set<string>()
  for (const item of tl.items) {
    const end = at + length(item)
    if (item.kind !== 'media') return null
    const lo = Math.max(at, wanted.t0), hi = Math.min(end, wanted.t1)
    if (hi > lo && !item.muted) {
      const t = await read(item.src, { t0: item.in + lo - at, t1: item.in + hi - at })
      if (!t) return null
      languages.add(t.language); models.add(t.model)
      for (const s of t.segments) for (const w of s.words) {
        const start = at + w.s - item.in, finish = at + w.e - item.in
        // Midpoint assigns each word to one side of a split. Clip its boundaries to kept audio.
        if ((start + finish) / 2 >= lo && (start + finish) / 2 < hi) words.push({ ...w, s: Math.max(lo, start), e: Math.min(hi, finish) })
      }
    }
    at = end
  }
  return { media: output, language: [...languages].join(', ') || 'none', model: `${[...models].join(', ')} · mapped from source`,
    segments: groupWords(words), createdAt: Date.now() }
}
