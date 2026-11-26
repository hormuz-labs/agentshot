// Finding a moment across a project's files: by what is shown (the faces and objects already detected for reframing,
// plus what the agent wrote down about each file) and by what is said (the transcripts already made). Everything
// here reads things AgentShot has measured before; nothing is sent anywhere.
import { COCO, type Det } from './subjects'
import type { Transcript } from '../shared/types'

/** Everyday words for the things the detector knows by another name. */
const ALIASES: Record<string, string> = {
  people: 'person', man: 'person', men: 'person', woman: 'person', women: 'person', guy: 'person', girl: 'person', boy: 'person',
  kid: 'person', child: 'person', children: 'person', crowd: 'person', speaker: 'person', presenter: 'person', someone: 'person', human: 'person',
  faces: 'face', head: 'face', closeup: 'face', 'close-up': 'face',
  bike: 'bicycle', cyclist: 'bicycle', motorbike: 'motorcycle', scooter: 'motorcycle', automobile: 'car', vehicle: 'car', taxi: 'car',
  lorry: 'truck', van: 'truck', plane: 'airplane', aeroplane: 'airplane', jet: 'airplane', ship: 'boat', yacht: 'boat',
  puppy: 'dog', kitten: 'cat', kitty: 'cat', pony: 'horse', lamb: 'sheep', cattle: 'cow', bull: 'cow',
  phone: 'cell phone', mobile: 'cell phone', smartphone: 'cell phone', iphone: 'cell phone', computer: 'laptop', macbook: 'laptop', notebook: 'laptop',
  television: 'tv', screen: 'tv', monitor: 'tv', display: 'tv', sofa: 'couch', table: 'dining table', desk: 'dining table',
  plant: 'potted plant', flower: 'potted plant', ball: 'sports ball', football: 'sports ball', glass: 'wine glass', mug: 'cup', coffee: 'cup',
  bag: 'handbag', purse: 'handbag', rucksack: 'backpack', luggage: 'suitcase', glasses: 'person', watch: 'clock', food: 'bowl', drink: 'cup',
}
const KINDS = new Set(['face', ...COCO])
/** A plural or -ing form down to the word itself, roughly: enough for "dogs", "boxes", "running". */
export function stem(word: string) {
  const w = word.toLowerCase().replace(/[^a-z0-9 -]/g, '')
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`
  if (w.length > 4 && /(ss|sh|ch|x|s)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1)
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  return w
}

/** The detected kinds a query means ("two dogs and a bike" → dog, bicycle), in the order asked. */
export function kindsFor(query: string): string[] {
  const q = query.toLowerCase().replace(/[^a-z0-9 -]/g, ' ')
  const out: string[] = []
  const add = (k?: string) => { if (k && KINDS.has(k) && !out.includes(k)) out.push(k) }
  // names of two words first ("cell phone", "traffic light"), as they are and without a plural
  for (const k of KINDS) if (k.includes(' ') && new RegExp(`\\b${k}s?\\b`).test(q)) add(k)
  for (const w of q.split(/\s+/).filter(Boolean)) for (const form of [w, stem(w), w.replace(/s$/, ''), w.replace(/es$/, '')]) { add(form); add(ALIASES[form]) }
  return out
}

export type Seen = { kind: string; s: number; e: number; size: number }
/** When each kind is on screen: detections closer than `gap` seconds are one stretch; a single stray frame is not one. */
export function seenRanges(dets: Det[], kinds: string[], gap = 1.5): Seen[] {
  const out: Seen[] = []
  for (const kind of kinds) {
    const times = new Map<number, number>() // time → the biggest one's share of the frame then
    for (const d of dets) if (d.kind === kind && d.score >= 0.5) times.set(d.t, Math.max(times.get(d.t) || 0, d.w * d.h))
    let run: { s: number; e: number; n: number; size: number } | undefined
    const flush = () => { if (run && run.n >= 2) out.push({ kind, s: run.s, e: run.e, size: Math.round(run.size * 1000) / 1000 }); run = undefined }
    for (const [t, size] of [...times].sort((a, b) => a[0] - b[0])) {
      if (run && t - run.e <= gap) { run.e = t; run.n++; run.size = Math.max(run.size, size) } else { flush(); run = { s: t, e: t, n: 1, size } }
    }
    flush()
  }
  return out.sort((a, b) => a.s - b.s)
}

export type Said = { s: number; e: number; text: string }
/** Where a phrase is said: every word of it in order, in one sentence, whatever the capitals or punctuation. */
export function saidHits(t: Pick<Transcript, 'segments'>, phrase: string, max = 12): Said[] {
  const norm = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')
  const want = phrase.split(/\s+/).map(norm).filter(Boolean)
  if (!want.length) return []
  const out: Said[] = []
  for (const seg of t.segments) {
    const words = seg.words.map(w => ({ ...w, n: norm(w.w) })).filter(w => w.n)
    for (let i = 0; i + want.length <= words.length && out.length < max; i++) {
      if (want.every((q, k) => words[i + k].n === q || (k === want.length - 1 && words[i + k].n.startsWith(q) && q.length >= 3))) {
        out.push({ s: words[i].s, e: words[i + want.length - 1].e, text: seg.text.trim() })
        i += want.length - 1
      }
    }
  }
  return out
}

/** Whether what was written about a file (the agent's notes, its summary, its name) mentions every word asked for. */
export function mentions(text: string, query: string) {
  const have = new Set(text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map(stem))
  const want = query.split(/[^\p{L}\p{N}]+/u).filter(w => w.length > 2).map(stem)
  return want.length > 0 && want.every(w => have.has(w))
}

const at = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

export type FileHits = { rel: string; seen?: Seen[]; said?: Said[]; notes?: string }
/**
 * Where a stretch of a file plays in the film as it is cut now: its ranges in film time, none when the edit leaves
 * that stretch out, or null when the edit doesn't use the file itself (the film is a render made from it), so the
 * edit can't say.
 */
export type InFilm = (rel: string, s: number, e: number) => [number, number][] | null

/**
 * The answer the agent reads: one block per file with something in it. A file's times are its own (seconds into that
 * file) and never change; cuts move where they play in the film, so each moment also says where it is in the film now.
 */
export function searchReport(q: { shows?: string; said?: string }, hits: FileHits[], o: { kinds: string[]; unknown?: string; unseen?: string[]; unheard?: string[]; inFilm?: InFilm }) {
  const lines: string[] = []
  const film = (rel: string, s: number, e: number) => {
    const r = o.inFilm?.(rel, s, Math.max(e, s + 0.05))
    if (r == null) return ''
    return r.length ? ` → in the film now at ${r.map(([a, b]) => `${at(a)}–${at(b)}`).join(', ')}` : ' → cut out of the film now'
  }
  const found = hits.filter(h => h.seen?.length || h.said?.length || h.notes)
  if (!found.length) lines.push(`Nothing found for ${[q.shows && `shows "${q.shows}"`, q.said && `said "${q.said}"`].filter(Boolean).join(' and ')}.`)
  for (const h of found) {
    lines.push(h.rel)
    for (const s of h.seen || []) lines.push(`  shows ${s.kind} ${at(s.s)}–${at(s.e)}${s.size >= 0.15 ? ' (large in frame)' : s.size < 0.02 ? ' (small)' : ''}${film(h.rel, s.s, s.e)}`)
    for (const s of h.said || []) lines.push(`  said ${at(s.s)}–${at(s.e)}${film(h.rel, s.s, s.e)}: ${s.text.length > 160 ? `${s.text.slice(0, 157)}…` : s.text}`)
    if (h.notes) lines.push(`  your notes: ${h.notes}`)
  }
  if (found.length) lines.push('Times are each file\'s own (seconds into that file); they don\'t move when the film is cut. To cut one of these moments, give edit_timeline the file as src with these times.')
  if (q.shows && !o.kinds.length) lines.push(`"${q.shows}" isn't something detection knows by sight (it knows faces, people, vehicles, animals and everyday objects), so only your notes were searched. Look at likely files, then save what you find with note_file.`)
  if (o.unknown) lines.push(o.unknown)
  if (o.unseen?.length) lines.push(`Not checked by sight (no picture, or detection isn't installed): ${o.unseen.join(', ')}`)
  if (o.unheard?.length) lines.push(`No transcript yet (call transcript on them to search what's said): ${o.unheard.join(', ')}`)
  return lines.join('\n')
}
