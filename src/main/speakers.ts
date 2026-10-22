// Who speaks when: speaker turns from manul-speakers (sherpa-onnx diarization: pyannote segmentation + a speaker
// embedding + clustering), then regrouped by Manul: each turn's voice embedding, voices whose centres sound alike
// merged, a few seconds of a voice folded into the nearest real one, and transcript lines no turn covers given the
// nearest voice. sherpa's one-threshold clustering splits a person whenever the sound changes (378 voices in a
// 2h20 film, most of them seconds long); regrouped, the film's main characters come out as one voice each.
// Named A, B, C… in order of appearance, joined into turns and, when a transcript exists, given the sentences spoken
// in them. For cutting to the speaker, cropping to the speaker, lower thirds and clips.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { FFMPEG, MODELS_DIR, SPEAKERS } from './media'
import type { Transcript } from '../shared/types'
import { nameOf, people, type SpeakerNames, type Speakers, type Turn } from '../shared/speakers'

/** Distance threshold for clustering when the number of speakers isn't given (calibrated on sherpa-onnx's labelled samples). */
const THRESHOLD = 0.75

export type { SpeakerInfo, Speakers, Turn } from '../shared/speakers'

/** Background callers skip unavailable native detection; explicit requests get an actionable setup error. */
export function speakerDetectionReady(binary = SPEAKERS, models = MODELS_DIR) {
  return existsSync(binary) && ['speaker-segmentation.onnx', 'speaker-embedding.onnx'].every(m => existsSync(join(models, m)))
}

const r2 = (n: number) => Math.round(n * 100) / 100
const label = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `S${i + 1}`)

/** From the runner's segments to named speakers and turns (pure, tested). */
export function toTurns(raw: { duration: number; segments: [number, number, number, number][] }, gap = 1): Speakers {
  const order: number[] = []
  for (const [, , k] of raw.segments) if (!order.includes(k)) order.push(k)
  const name = (k: number) => label(order.indexOf(k))
  const turns: Turn[] = []
  for (const [s, e, k] of [...raw.segments].sort((a, b) => a[0] - b[0])) {
    const last = turns[turns.length - 1]
    if (last && last.speaker === name(k) && s - last.e <= gap) last.e = Math.max(last.e, e)
    else turns.push({ speaker: name(k), s, e })
  }
  const total = turns.reduce((t, x) => t + x.e - x.s, 0) || 1
  const speakers = order.map(k => {
    const mine = turns.filter(t => t.speaker === name(k))
    const talk = mine.reduce((t, x) => t + x.e - x.s, 0)
    // a sliver of talk is usually the same person mis-clustered, a laugh, or someone off-mic
    return { id: name(k), talk: r2(talk), turns: mine.length, share: Math.round((talk / total) * 100), minor: talk / total < 0.04 && talk < 5 }
  })
  return { duration: r2(raw.duration), speakers, turns: turns.map(t => ({ ...t, s: r2(t.s), e: r2(t.e) })) }
}

/** Give each turn the transcript sentences mostly inside it. */
export function withSentences(sp: Speakers, t: Transcript): Speakers {
  const turns = sp.turns.map(x => ({ ...x }))
  for (const seg of t.segments) {
    let best: Turn | undefined, most = 0
    for (const x of turns) {
      const overlap = Math.min(x.e, seg.e) - Math.max(x.s, seg.s)
      if (overlap > most) { most = overlap; best = x }
    }
    if (best) best.text = best.text ? `${best.text} ${seg.text.trim()}` : seg.text.trim()
  }
  return { ...sp, turns }
}

const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** What the agent reads, with the names the user gave (voices with the same name are one person). Long recordings
 *  list the first turns; the file has them all. */
export function speakersReport(sp: Speakers, rel: string, file: string, max = 120, names: SpeakerNames = {}) {
  const main = sp.speakers.filter(s => !s.minor)
  const named = Object.values(names).some(n => n.trim())
  const who = (id: string) => (names[id]?.trim() ? `${names[id].trim()} (${id})` : id)
  const lines = [
    `${rel} · ${main.length} speaker${main.length === 1 ? '' : 's'}${sp.speakers.length > main.length ? ` (+${sp.speakers.length - main.length} minor)` : ''} · ${sp.turns.length} turns`,
    ...sp.speakers.map(s => `${who(s.id)}: ${mmss(s.talk)} of talk (${s.share} %), ${s.turns} turns${s.minor ? ' — minor: probably another speaker mis-split, a laugh or someone off-mic; pass speakers=N if you know the count' : ''}`),
    ...(named ? ['', `People (voices with the same name are one person): ${people(sp, names).map(p => `${p.name} = ${p.ids.join('+')}`).join(', ')}`] : []),
    '',
    'Turns (start–end speaker: what they say):',
    ...sp.turns.slice(0, max).map(t => `${ts(t.s)}–${ts(t.e)} ${named ? nameOf(t.speaker, names) : t.speaker}${t.text ? `: ${t.text.length > 140 ? `${t.text.slice(0, 137)}…` : t.text}` : ''}`),
  ]
  if (sp.turns.length > max) lines.push(`… ${sp.turns.length - max} more turns in ${file}`)
  else lines.push('', `All turns: ${file}`)
  lines.push(named
    ? 'Names are the ones the user gave; unnamed voices keep their letter. To name more, use name_speakers.'
    : 'Speaker letters are the order people first speak in, not names; find who is who with look (their faces) or the transcript (people addressing each other), then name them with name_speakers.')
  return lines.join('\n')
}

const run = (bin: string, args: string[], signal?: AbortSignal) =>
  new Promise<string>((ok, fail) => execFile(bin, args, { maxBuffer: 1 << 26, signal }, (err, out, stderr) =>
    (err ? fail(new Error(`${basename(bin)} failed: ${String(stderr).split('\n').filter(l => !l.startsWith('progress')).join('\n').slice(-1500) || err.message}`)) : ok(String(out)))))

/** The runner, reporting its progress (it prints "progress done/total" lines on stderr). */
const diarize = (args: string[], onProgress?: (p: number) => void, signal?: AbortSignal) => new Promise<string>((ok, fail) => {
  const child = spawn(SPEAKERS, args, { signal })
  let out = '', err = ''
  child.stdout.on('data', d => { out += d })
  child.stderr.on('data', d => {
    err += d
    const m = /progress (\d+)\/(\d+)\s*$/.exec(String(d).trim())
    if (m && onProgress && Number(m[2]) > 0) onProgress(Number(m[1]) / Number(m[2]))
  })
  child.on('error', fail)
  child.on('close', code => (code === 0 ? ok(out) : fail(new Error(`manul-speakers failed: ${err.split('\n').filter(l => !l.startsWith('progress')).join('\n').slice(-1500)}`))))
})

/** Bumped when the result changes meaning (2: regrouped by embeddings, lines labelled). */
const VERSION = 2

const cachePath = async (projectDir: string, file: string, speakers?: number) => {
  const st = await stat(file)
  const key = createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:${speakers || 0}:v${VERSION}`).digest('hex').slice(0, 16)
  return join(projectDir, '.cache', 'speakers', `${basename(file).replace(/\.[^.]+$/, '')}-${key}.json`)
}

/** A diarization already made (any speaker count asked for, the plain one first), or null. Never runs one. */
export async function cachedSpeakers(projectDir: string, file: string, made?: string): Promise<{ result: Speakers; file: string } | null> {
  for (const out of [...(made ? [made] : []), await cachePath(projectDir, file).catch(() => '')]) {
    try { const r = JSON.parse(await readFile(out, 'utf8')); if (r.v === VERSION) return { result: r, file: out } } catch { /* next */ }
  }
  return null
}

// ---------------------------------------------------------------- regrouping voices by their embeddings
type Vec = Float64Array
const unit = (v: number[]): Vec => { const a = Float64Array.from(v); let n = 0; for (const x of a) n += x * x; n = Math.sqrt(n) || 1; for (let i = 0; i < a.length; i++) a[i] /= n; return a }
const dot = (a: Vec, b: Vec) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

/** Regrouping settings, calibrated on a feature film (Avengers: Age of Ultron) and a two-person conversation:
 *  merge two voices when their centres are this alike; fold a voice with less talk than minTalk (seconds) into the
 *  nearest real one if at least floor alike (else it stays its own short voice). */
export const REGROUP = { merge: 0.6, floor: 0.3, minTalk: 8 }

/** A new voice for each turn, from the turns' embeddings (null when too short to tell): pure, tested. */
export function regroup(turns: Turn[], emb: (number[] | null)[], o = REGROUP): { speakers: string[]; centres: Map<string, Vec> } {
  const lab = turns.map(t => t.speaker)
  const X = emb.map(e => (e ? unit(e) : null))
  const dur = turns.map(t => t.e - t.s)
  const centresOf = () => {
    const sums = new Map<string, Vec>()
    lab.forEach((k, n) => { const x = X[n]; if (!x) return; const c = sums.get(k) || new Float64Array(x.length); for (let i = 0; i < x.length; i++) c[i] += x[i] * dur[n]; sums.set(k, c) })
    for (const [k, c] of sums) sums.set(k, unit([...c]))
    return sums
  }
  const talkOf = () => { const t = new Map<string, number>(); lab.forEach((k, n) => t.set(k, (t.get(k) || 0) + dur[n])); return t }

  // 1. merge the two most alike voices while their centres are alike enough (sums kept, similarities updated per merge)
  const keys = [...new Set(lab.filter((_, n) => X[n]))]
  const index = new Map(keys.map((k, i) => [k, i]))
  const dim = X.find(Boolean)?.length || 0
  const sums = keys.map(() => new Float64Array(dim))
  lab.forEach((k, n) => { const x = X[n]; if (x) { const c = sums[index.get(k)!]; for (let i = 0; i < dim; i++) c[i] += x[i] * dur[n] } })
  const K = keys.length, alive = new Uint8Array(K).fill(1), into = new Int32Array(K).fill(-1)
  let dirs = sums.map(c => unit([...c]))
  const S = new Float64Array(K * K).fill(-2)
  for (let i = 0; i < K; i++) for (let j = i + 1; j < K; j++) S[i * K + j] = dot(dirs[i], dirs[j])
  for (;;) {
    let best = -2, a = -1, b = -1
    for (let i = 0; i < K; i++) if (alive[i]) for (let j = i + 1; j < K; j++) if (alive[j] && S[i * K + j] > best) { best = S[i * K + j]; a = i; b = j }
    if (a < 0 || best < o.merge) break
    for (let d = 0; d < dim; d++) sums[a][d] += sums[b][d]
    alive[b] = 0; into[b] = a
    dirs[a] = unit([...sums[a]])
    for (let k = 0; k < K; k++) if (alive[k] && k !== a) { const v = dot(dirs[a], dirs[k]); if (k < a) S[k * K + a] = v; else S[a * K + k] = v }
  }
  dirs = []
  const root = (i: number): number => (into[i] < 0 ? i : root(into[i]))
  for (let n = 0; n < lab.length; n++) if (index.has(lab[n])) lab[n] = keys[root(index.get(lab[n])!)]

  // 2. a few seconds of a voice: each of its turns to the nearest real voice, when alike enough
  // 3. twice: every turn to the voice it is clearly closer to
  for (let pass = 0; pass < 3; pass++) {
    const talk = talkOf(), centres = centresOf()
    const big = [...centres.keys()].filter(k => (talk.get(k) || 0) >= o.minTalk)
    if (!big.length) break
    for (let n = 0; n < lab.length; n++) {
      const x = X[n]
      if (!x) continue
      let bk = '', bs = -2
      for (const k of big) { const v = dot(centres.get(k)!, x); if (v > bs) { bs = v; bk = k } }
      const small = (talk.get(lab[n]) || 0) < o.minTalk
      const mine = centres.has(lab[n]) && !small ? dot(centres.get(lab[n])!, x) : -2
      if (bs >= o.floor && (pass === 0 ? small : bs > mine + 0.05)) lab[n] = bk
    }
  }
  const talk = talkOf(), centres = centresOf()
  return { speakers: lab, centres: new Map([...centres].filter(([k]) => (talk.get(k) || 0) >= o.minTalk)) }
}

/** The nearest real voice for each line (null when none is alike enough or it is too short to tell). */
export function nearestVoices(emb: (number[] | null)[], centres: Map<string, Vec>, floor = REGROUP.floor) {
  return emb.map(e => {
    if (!e) return null
    const x = unit(e)
    let bk: string | null = null, bs = floor
    for (const [k, c] of centres) { const v = dot(c, x); if (v >= bs) { bs = v; bk = k } }
    return bk
  })
}

/** Voice embeddings for time ranges of a 16 kHz WAV (the runner's --embed mode). */
async function embedRanges(wav: string, ranges: [number, number][], tmp: string, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<(number[] | null)[]> {
  if (!ranges.length) return []
  const list = join(tmp, `ranges-${ranges.length}-${Date.now()}.txt`)
  await writeFile(list, ranges.map(([a, b]) => `${a.toFixed(3)} ${b.toFixed(3)}`).join('\n'))
  const out = await new Promise<string>((ok, fail) => {
    const child = spawn(SPEAKERS, ['--embedding', join(MODELS_DIR, 'speaker-embedding.onnx'), '--embed', list, wav], { signal })
    let o = '', err = ''
    child.stdout.on('data', d => { o += d })
    child.stderr.on('data', d => { err += d; const m = /embedded (\d+)\s*$/.exec(String(d).trim()); if (m && onProgress) onProgress(Number(m[1]) / ranges.length) })
    child.on('error', fail)
    child.on('close', code => (code === 0 ? ok(o) : fail(new Error(`manul-speakers --embed failed: ${err.slice(-800)}`))))
  })
  return (JSON.parse(out) as { embeddings: (number[] | null)[] }).embeddings
}

/** Regroup diarized turns and give uncovered transcript lines a voice; back as runner-style segments for toTurns. */
async function regrouped(sp: Speakers, wav: string, tmp: string, lines: { s: number; e: number }[], o: { regroup: boolean; onProgress?: (p: number) => void; signal?: AbortSignal }) {
  const covered = (l: { s: number; e: number }) => sp.turns.some(t => Math.min(t.e, l.e) - Math.max(t.s, l.s) > 0)
  const bare = lines.filter(l => !covered(l))
  const all = await embedRanges(wav, [...sp.turns, ...bare].map(t => [t.s, t.e] as [number, number]), tmp, o.onProgress, o.signal)
  const turnEmb = all.slice(0, sp.turns.length), lineEmb = all.slice(sp.turns.length)
  const { speakers, centres } = o.regroup ? regroup(sp.turns, turnEmb) : { speakers: sp.turns.map(t => t.speaker), centres: regroup(sp.turns, turnEmb, { ...REGROUP, merge: 2 }).centres }
  const ids = new Map<string, number>(), id = (k: string) => { if (!ids.has(k)) ids.set(k, ids.size); return ids.get(k)! }
  const segments: [number, number, number, number][] = sp.turns.map((t, n) => [t.s, t.e, id(speakers[n]), 1])
  nearestVoices(lineEmb, centres).forEach((k, n) => { if (k) segments.push([bare[n].s, bare[n].e, id(k), 1]) })
  return { duration: sp.duration, segments }
}

/** Diarize a file's sound (cached in <project>/.cache/speakers per file and speaker count). With the transcript, its
 *  lines no turn covers get the nearest voice too. */
export async function analyzeSpeakers(projectDir: string, file: string, o: { speakers?: number; transcript?: Transcript | null; signal?: AbortSignal; onProgress?: (p: number) => void } = {}): Promise<{ result: Speakers; file: string }> {
  const out = await cachePath(projectDir, file, o.speakers)
  const dir = join(projectDir, '.cache', 'speakers')
  try { const r = JSON.parse(await readFile(out, 'utf8')); if (r.v === VERSION) return { result: r, file: out } } catch { /* run it */ }
  if (!speakerDetectionReady()) throw new Error('Speaker detection is not installed completely. For a source checkout, run npm run build:ml and node scripts/fetch-models.mjs. Transcription, syncing and demo composition can continue without speaker detection.')
  const tmp = await mkdtemp(join(tmpdir(), 'manul-speakers-'))
  try {
    const wav = join(tmp, 'a.wav')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], o.signal)
      .catch(() => { throw new Error('This file has no sound to analyse.') })
    const args = ['--segmentation', join(MODELS_DIR, 'speaker-segmentation.onnx'), '--embedding', join(MODELS_DIR, 'speaker-embedding.onnx'),
      ...(o.speakers && o.speakers > 0 ? ['--speakers', String(Math.round(o.speakers))] : ['--threshold', String(THRESHOLD)]), wav]
    // diarizing is most of the time; then the embeddings (regrouping and labelling lines)
    const first = toTurns(JSON.parse(await diarize(args, p => o.onProgress?.(p * 0.75), o.signal)))
    const lines = o.transcript?.segments.map(x => ({ s: x.s, e: x.e })) || []
    // a speaker count asked for is sherpa's exact grouping already: keep it, only label the lines
    const result: Speakers = { ...toTurns(await regrouped(first, wav, tmp, lines, { regroup: !o.speakers, onProgress: p => o.onProgress?.(0.75 + p * 0.25), signal: o.signal })), v: VERSION }
    await mkdir(dir, { recursive: true })
    await writeFile(out, JSON.stringify(result))
    return { result, file: out }
  } finally { await rm(tmp, { recursive: true, force: true }) }
}
