// The rhythm of a piece of music, so cuts, hits and speed changes can land on it: tempo, every beat, bars (downbeats),
// the strongest hits and how the energy moves (intro, build, drop, break, outro). manul-beats (aubio) does the
// tracking; here the beat grid is completed back to the start, snapped to the real onsets, and grouped into bars.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { BEATS, FFMPEG } from './media'

export type BeatsRaw = { sr: number; duration: number; bpm: number; confidence: number; beats: number[]; onsets: [number, number][]; env: { rate: number; rms: number[]; flux: number[] } }
export type Bar = { n: number; t: number; db: number; label: string }
export type Music = {
  duration: number
  bpm: number
  /** how evenly the beats fall (1 = a metronome); under ~0.85 the tempo drifts or the tracker is unsure */
  steadiness: number
  confidence: number
  beat: number
  beats: number[]
  /** the beat index (0–3) that starts each bar */
  phase: number
  bars: Bar[]
  hits: { t: number; strength: number; onBeat: boolean }[]
  soundStart: number
  soundEnd: number
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN }
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)
const r3 = (n: number) => Math.round(n * 1000) / 1000
const db = (lin: number) => (lin > 0 ? 20 * Math.log10(lin) : -120)

/** From the tracker's output to a usable rhythm (pure, tested). */
export function rhythm(raw: BeatsRaw): Music {
  const { env } = raw
  const at = (arr: number[], t: number) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(t * env.rate)))] ?? 0
  const loud = env.rms.map(db)
  const peak = Math.max(-120, ...loud)
  const firstLoud = loud.findIndex(v => v > peak - 40), lastLoud = loud.length - 1 - [...loud].reverse().findIndex(v => v > peak - 40)
  const soundStart = firstLoud >= 0 ? firstLoud / env.rate : 0
  const soundEnd = lastLoud >= 0 ? Math.min(raw.duration, (lastLoud + 1) / env.rate) : raw.duration

  let beat = median(raw.beats.slice(1).map((b, i) => b - raw.beats[i]))
  if (!Number.isFinite(beat) || beat <= 0) beat = raw.bpm > 0 ? 60 / raw.bpm : 0.5

  // complete the grid: beats the tracker skipped (a gap of k beats gets its k-1 missing ones), the second or two
  // before its first beat, and any it stopped short of at the end — so bar counting never slips
  const beats: number[] = []
  raw.beats.forEach((b, i) => {
    const prev = raw.beats[i - 1]
    const k = prev == null ? 1 : Math.round((b - prev) / beat)
    for (let j = 1; j < k; j++) beats.push(prev + ((b - prev) * j) / k)
    beats.push(b)
  })
  const iois = beats.slice(1).map((b, i) => b - beats[i])
  const steadiness = iois.length ? Math.max(0, 1 - (mean(iois.map(x => Math.abs(x - beat))) / beat) * 4) : 0
  if (beats.length) {
    for (let t = beats[0] - beat; t >= soundStart - beat * 0.25; t -= beat) beats.unshift(t)
    for (let t = beats[beats.length - 1] + beat; t <= soundEnd + beat * 0.25; t += beat) beats.push(t)
  }
  // snap each beat to the strongest onset within 60 ms (the tracker reports at hop resolution, a little late)
  const snapped = beats.map(b => {
    const near = raw.onsets.filter(([t]) => Math.abs(t - b) <= 0.06)
    return near.length ? near.reduce((a, o) => (o[1] > a[1] ? o : a))[0] : b
  }).filter(t => t >= 0 && t <= raw.duration).map(r3)

  // bars: the beat position (of 4) where the accents fall — strongest onsets and loudest moments
  const accent = (t: number) => {
    const o = raw.onsets.filter(([x]) => Math.abs(x - t) <= 0.06).reduce((m, [, s]) => Math.max(m, s), 0)
    return o + at(env.flux, t)
  }
  let phase = 0, best = -Infinity
  for (let p = 0; p < 4; p++) {
    const score = mean(snapped.filter((_, i) => i % 4 === p).map(accent))
    if (score > best) { best = score; phase = p }
  }
  const downs = snapped.filter((t, i) => i % 4 === phase && t < soundEnd - beat)
  const barDb = downs.map((t, i) => {
    const end = downs[i + 1] ?? Math.min(raw.duration, t + beat * 4)
    const vals = env.rms.slice(Math.floor(t * env.rate), Math.max(Math.floor(t * env.rate) + 1, Math.floor(end * env.rate)))
    return Math.round(db(Math.sqrt(mean(vals.map(v => v * v)))) * 10) / 10
  })
  const loudest = Math.max(...barDb)
  const bars: Bar[] = downs.map((t, i) => {
    // a last bar cut short by the end of the music measures as noise: it keeps the level before it
    if (i > 0 && (downs[i + 1] ?? soundEnd) - t < beat * 3) return { n: i + 1, t: r3(t), db: barDb[i], label: 'end' }
    const before = barDb.slice(Math.max(0, i - 2), i)
    const prev = before.length ? mean(before) : barDb[i]
    const d = barDb[i] - prev
    const level = barDb[i] >= loudest - 6 ? 'full' : barDb[i] >= loudest - 14 ? 'mid' : 'quiet'
    const label = i > 0 && d >= 4 ? `${level}, lift/drop (+${d.toFixed(0)} dB)` : i > 0 && d <= -4 ? `${level}, break (${d.toFixed(0)} dB)` : level
    return { n: i + 1, t: r3(t), db: barDb[i], label }
  })

  // the strongest hits: biggest onsets, at least a beat apart
  const hits: Music['hits'] = []
  for (const [t, s] of [...raw.onsets].sort((a, b) => b[1] - a[1])) {
    if (hits.length >= 12) break
    if (hits.some(h => Math.abs(h.t - t) < beat)) continue
    hits.push({ t: r3(t), strength: Math.round(s * 100) / 100, onBeat: snapped.some(b => Math.abs(b - t) <= 0.05) })
  }
  hits.sort((a, b) => a.t - b.t)

  return { duration: r3(raw.duration), bpm: Math.round((60 / beat) * 10) / 10, steadiness: Math.round(steadiness * 100) / 100, confidence: Math.round(raw.confidence * 100) / 100,
    beat: r3(beat), beats: snapped, phase, bars, hits, soundStart: r3(soundStart), soundEnd: r3(soundEnd) }
}

const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`

/** What the agent reads: the rhythm, every bar with its energy, the hits, and where all the beat times are saved. */
export function musicReport(m: Music, rel: string, beatsFile: string) {
  const sure = m.steadiness >= 0.85 ? 'steady tempo' : m.steadiness >= 0.6 ? 'tempo drifts a little — check cut points against the beats file' : 'no steady beat (free time, rubato or several tempos): cut on the hits and phrases, not a grid'
  // runs of bars at one level; a lift, drop or break starts a new run
  const runs: { from: Bar; to: Bar; level: string; event?: string }[] = []
  for (const b of m.bars) {
    const [level, event] = b.label.split(', ')
    const last = runs[runs.length - 1]
    if (last && last.level === level && !event) last.to = b
    else runs.push({ from: b, to: b, level, event })
  }
  const sections = runs.map(r => `${r.from.n === r.to.n ? `bar ${r.from.n}` : `bars ${r.from.n}–${r.to.n}`} from ${ts(r.from.t)} ${r.level}${r.event ? ` (${r.event})` : ''}`)
  return [
    `${rel} · ${ts(m.duration)} · ${m.bpm} BPM, ${sure} · beat every ${m.beat.toFixed(3)} s, bar (4 beats) every ${(m.beat * 4).toFixed(3)} s`,
    `Sound from ${ts(m.soundStart)} to ${ts(m.soundEnd)}. First downbeat ${ts(m.bars[0]?.t ?? 0)}.`,
    '',
    `Bars — downbeat time, loudness, and where the energy changes (4/4 assumed):`,
    m.bars.map(b => `${b.n} ${ts(b.t)} ${b.db}${b.label.includes(',') ? ` ← ${b.label.split(', ')[1]}` : ''}`).join(' · '),
    '',
    `Energy: ${sections.slice(0, 40).join(' → ')}`,
    '',
    `Strongest hits (accents to put cuts, reveals and titles on): ${m.hits.map(h => `${ts(h.t)}${h.onBeat ? '' : ' (off-beat)'}`).join(', ')}`,
    '',
    `Every beat time (seconds, ${m.beats.length} beats) and the bars: ${beatsFile} — read it to place cuts exactly.`,
  ].join('\n')
}

const run = (bin: string, args: string[], cwd: string, signal?: AbortSignal) =>
  new Promise<string>((ok, fail) => execFile(bin, args, { cwd, maxBuffer: 1 << 27, signal }, (err, out, stderr) =>
    (err ? fail(new Error(`${basename(bin)} failed: ${String(stderr).slice(-1500) || err.message}`)) : ok(String(out)))))

/** Track the rhythm of a file's sound (music file or a video's soundtrack); cached in <project>/.cache/music. */
export async function analyzeMusic(projectDir: string, file: string, signal?: AbortSignal): Promise<{ music: Music; beatsFile: string }> {
  const st = await stat(file)
  const key = createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:v1`).digest('hex').slice(0, 16)
  const dir = join(projectDir, '.cache', 'music')
  const beatsFile = join(dir, `${basename(file).replace(/\.[^.]+$/, '')}-${key}.beats.json`)
  try { return { music: JSON.parse(await readFile(beatsFile, 'utf8')), beatsFile } } catch { /* track it */ }
  const tmp = await mkdtemp(join(tmpdir(), 'manul-music-'))
  try {
    const wav = join(tmp, 'a.wav')
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'pcm_s16le', wav], tmp, signal)
      .catch(() => { throw new Error('This file has no sound to analyse.') })
    const music = rhythm(JSON.parse(await run(BEATS, [wav], tmp, signal)) as BeatsRaw)
    await mkdir(dir, { recursive: true })
    await writeFile(beatsFile, JSON.stringify(music))
    return { music, beatsFile }
  } finally { await rm(tmp, { recursive: true, force: true }) }
}
