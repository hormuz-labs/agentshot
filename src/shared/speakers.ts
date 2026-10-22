// Who speaks when, as the transcript panel and the agent use it: diarized voices (A, B, C… in order of first speaking)
// and the names the user (or the agent) gives them. Giving two voices the same name makes them one person: diarization
// often splits one person in two when the sound changes (shouting, music under, another room), most of all in films.
import type { Segment } from './types'

export type Turn = { speaker: string; s: number; e: number; text?: string }
export type SpeakerInfo = { id: string; talk: number; turns: number; share: number; minor: boolean }
export type Speakers = { duration: number; speakers: SpeakerInfo[]; turns: Turn[]; /** how it was made (see main/speakers.ts) */ v?: number }
/** voice id → the name given to it */
export type SpeakerNames = Record<string, string>

/** What a voice is called: its name, else "Speaker A". */
export const nameOf = (id: string, names: SpeakerNames = {}) => names[id]?.trim() || `Speaker ${id}`

/** The people: voices with the same name joined, most talk first. */
export function people(sp: Speakers, names: SpeakerNames = {}) {
  const by = new Map<string, { name: string; ids: string[]; talk: number; turns: number; named: boolean }>()
  for (const v of sp.speakers) {
    const name = nameOf(v.id, names)
    const p = by.get(name) || { name, ids: [], talk: 0, turns: 0, named: !!names[v.id]?.trim() }
    p.ids.push(v.id); p.talk += v.talk; p.turns += v.turns
    by.set(name, p)
  }
  return [...by.values()].sort((a, b) => b.talk - a.talk)
}

/** The voice speaking most of each transcript sentence (undefined where no one is). */
export function speakerOfSegments(segments: Segment[], turns: Turn[]): (string | undefined)[] {
  const sorted = [...turns].sort((a, b) => a.s - b.s)
  let from = 0
  return segments.map(seg => {
    while (from < sorted.length && sorted[from].e < seg.s) from++
    const talk = new Map<string, number>()
    for (let i = from; i < sorted.length && sorted[i].s < seg.e; i++) {
      const overlap = Math.min(sorted[i].e, seg.e) - Math.max(sorted[i].s, seg.s)
      if (overlap > 0) talk.set(sorted[i].speaker, (talk.get(sorted[i].speaker) || 0) + overlap)
    }
    let best: string | undefined, most = 0
    for (const [k, v] of talk) if (v > most) { most = v; best = k }
    return best
  })
}

/** A voice's longest turn: the best moment to hear (and see) who it is. */
export const longestTurn = (sp: Speakers, id: string) =>
  sp.turns.filter(t => t.speaker === id).reduce<Turn | undefined>((a, t) => (!a || t.e - t.s > a.e - a.s ? t : a), undefined)

/** One of eight colours per name, the same everywhere it appears. */
export function colourOf(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 8
}
