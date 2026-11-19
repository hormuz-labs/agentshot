// Word times that are safe to cut on.
//
// whisper.cpp's word times (-ml 1 -sow) spread words over pauses and music: on narration over music they were a median
// 1-2 s off, up to 16 s, so a cut "on the word" landed seconds away. Two steps fix it:
//  1. DTW token timestamps (-dtw <preset>) give each word's start to ~40 ms on base.en, which trails the real start by
//     ~95 ms; the multilingual base (the bundled model) trails by ~130 ms and spreads twice as wide (dtwLag).
//  2. snapWords moves every boundary onto the audio: words in running speech meet at the quietest point between them;
//     around a pause, a word ends just after its sound stops and the next starts just before its sound starts again.
// Every word's s/e is then a cut point in the quiet: cutting there never takes off a piece of a word.
// Measured against a forced alignment (BBC narration over music, and test/fixtures/speech): cuts at pauses that chop a
// word went from 29 % to 5 %, and none audible on the fixture.
import { execFile } from 'node:child_process'
import { basename } from 'node:path'
import { promisify } from 'node:util'
import type { Segment, Word } from '../shared/types'

const run = promisify(execFile)

export const HOP = 0.005       // envelope step (s)
const WIN = 0.02               // envelope window (s): short enough to see a consonant
const PRE = 0.95               // pre-emphasis: lifts s/f/t (quiet but bright) over a music bed (loud but low)

// whisper.cpp's alignment-head presets (whisper-cli --dtw)
const PRESETS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large.v1', 'large.v2', 'large.v3', 'large.v3.turbo']

/** The DTW preset for a ggml model file (quantized ones too), or null when whisper.cpp has none for it. */
export function dtwPreset(model: string): string | null {
  const name = basename(model).replace(/^ggml-/, '').replace(/\.bin$/, '').replace(/-q\d.*$/, '').replace(/-/g, '.')
  return PRESETS.includes(name) ? name : null
}

/** How far a model's DTW times trail the real word start (s). Measured against a forced alignment of narration over music
 *  (2026-10-08): base.en 95 ms, multilingual base 130-175 ms (0.13 fitted best). Models not measured use the base.en value. */
export function dtwLag(model: string): number {
  return dtwPreset(model) === 'base' ? 0.13 : 0.095
}

const helpText = new Map<string, Promise<string>>()
/** whisper-cli arguments for DTW word timings: none when this build or this model can't do it. */
export async function dtwFlags(binary: string, model: string): Promise<string[]> {
  const preset = dtwPreset(model)
  if (!preset) return []
  if (!helpText.has(binary)) {
    helpText.set(binary, run(binary, ['--help'], { timeout: 10_000 }).then(r => r.stdout + r.stderr, (e: { stdout?: string; stderr?: string }) => `${e.stdout || ''}${e.stderr || ''}`))
  }
  const help = await helpText.get(binary)!
  if (!/(^|\s)-dtw\b/.test(help)) return []
  // DTW needs flash attention off on builds that have it (on by default since 1.8)
  return ['-dtw', preset, ...(/(^|\s)-nfa\b/.test(help) ? ['-nfa'] : [])]
}

type CppToken = { text: string; t_dtw?: number }
type CppWord = { text: string; offsets: { from: number; to: number }; tokens?: CppToken[] }

/** whisper.cpp JSON (-ojf, one word per entry) → words. With DTW (lag given) the start is the word's first token's DTW time minus the lag; null = DTW off. */
export function whisperCppWords(raw: { transcription: CppWord[] }, lag: number | null): Word[] {
  const out: Word[] = []
  for (const t of raw.transcription) {
    const word = t.text.trim()
    if (!word || /^\[.*\]$/.test(word)) continue
    const d = lag != null ? t.tokens?.find(k => k.text.trim() && (k.t_dtw ?? -1) >= 0)?.t_dtw : undefined
    let s = d != null ? Math.max(0, d / 100 - lag!) : t.offsets.from / 1000
    if (out.length) s = Math.max(s, out[out.length - 1].s)
    out.push({ w: word, s, e: Math.max(s, t.offsets.to / 1000) })
  }
  return out
}

/** A 16-bit PCM mono WAV (what ffmpeg -ac 1 -c:a pcm_s16le writes) → its samples, read in place (an hour is 115 MB). */
export function readWav(buf: Buffer): { sr: number; x: Int16Array } {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file')
  let sr = 16000, channels = 1, bits = 16
  for (let p = 12; p + 8 <= buf.length;) {
    const id = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    if (id === 'fmt ') { channels = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22) }
    if (id === 'data') {
      if (bits !== 16 || channels !== 1) throw new Error(`only 16-bit mono WAV is supported (got ${bits}-bit, ${channels} channels)`)
      const n = Math.floor(Math.min(size, buf.length - p - 8) / 2), at = buf.byteOffset + p + 8
      const x = at % 2 ? new Int16Array(Uint8Array.prototype.slice.call(buf, p + 8, p + 8 + n * 2).buffer) : new Int16Array(buf.buffer, at, n)
      return { sr, x }
    }
    p += 8 + size + (size % 2)
  }
  throw new Error('WAV has no data')
}

/** Loudness in dB every HOP s over a WIN window, of the pre-emphasised signal (16-bit samples or -1..1 floats). */
export function envelope(x: Int16Array | Float32Array, sr: number): Float32Array {
  const scale = x instanceof Int16Array ? 1 / 32768 : 1
  const hop = Math.round(HOP * sr), win = Math.round(WIN * sr)
  const n = x.length >= win ? Math.floor((x.length - win) / hop) + 1 : 0
  const env = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let sum = 0
    for (let i = f * hop, end = i + win; i < end; i++) {
      const y = (x[i] - PRE * (i ? x[i - 1] : 0)) * scale
      sum += y * y
    }
    env[f] = 10 * Math.log10(sum / win + 1e-12)
  }
  return env
}

// thresholds as fractions of the way from the music/noise floor (10th percentile) to speech (90th) around each word
const HI = 0.5      // below this for QRUN: there is a pause
const LO = 0.2      // a word's sound starts/ends where it crosses this
const QRUN = 0.08   // s of quiet that makes a pause
const QIN = 0.03    // s of quiet that ends a word's tail
const QLONG = 0.1   // s of quiet that counts as "before the word" when walking back from a late start
const MIN_WORD = 0.08, BACK = 0.12, FWD = 0.03, PAD = 0.03, MAX_BACK = 0.5

/** Moves each word's s/e onto the audio so both are cut points in the quiet (see the top of this file). */
export function snapWords<T extends Word>(words: T[], env: Float32Array): T[] {
  const N = words.length, n = env.length
  if (!N || !n) return words.map(w => ({ ...w }))
  const dur = n * HOP
  const fr = (t: number) => Math.min(n - 1, Math.max(0, Math.round(t / HOP)))
  const anchor = words.map(w => Math.min(w.s, dur))
  const s = [...anchor], e = new Array<number>(N)
  const levels = (a: number, b: number) => {
    const seg = Float32Array.from(env.subarray(fr(a), Math.max(fr(a) + 1, fr(b)))).sort()
    const floor = seg[Math.floor(0.1 * (seg.length - 1))], loud = seg[Math.floor(0.9 * (seg.length - 1))]
    return { hi: floor + HI * (loud - floor), lo: floor + LO * (loud - floor) }
  }
  // walk back from t to the end of a quiet stretch of at least q seconds; `limit` if there is none
  const quietBefore = (t: number, limit: number, lo: number, q: number) => {
    let run = 0
    for (let k = fr(t); k > fr(limit); k--) {
      run = env[k] < lo ? run + 1 : 0
      if (run * HOP >= q) return (k + run) * HOP
    }
    return limit
  }

  { const { lo } = levels(anchor[0] - 2, anchor[0] + 1.5)
    s[0] = Math.max(0, quietBefore(anchor[0] + FWD, Math.max(0, anchor[0] - MAX_BACK), lo, QLONG) - PAD) }

  for (let i = 0; i < N; i++) {
    const next = i + 1 < N ? anchor[i + 1] : Math.min(anchor[i] + 2, dur)
    const { hi, lo } = levels(anchor[i] - 1.5, next + 0.5)
    // is there a pause before the next word?
    let end: number | null = null
    for (let k = fr(anchor[i] + MIN_WORD), run = 0; k < fr(next); k++) {
      run = env[k] < hi ? run + 1 : 0
      if (run * HOP >= QRUN) { end = (k - run + 1) * HOP; break }
    }
    if (end == null || next - end < 0.06) {
      // running speech: one cut at the quietest point just before the next word
      const a = fr(Math.max(anchor[i] + 0.05, next - BACK)), b = fr(next + FWD)
      let c = next
      if (b > a) { let m = a; for (let k = a; k <= b; k++) if (env[k] < env[m]) m = k; c = m * HOP }
      e[i] = c
      if (i + 1 < N) s[i + 1] = c
      continue
    }
    // a pause: the word's tail lasts while it is above the low threshold
    let k = fr(end), run = 0
    while (k < fr(next) && env[k] >= lo) k++
    for (; k < fr(next); k++) {
      run = env[k] < lo ? run + 1 : 0
      if (run * HOP >= QIN) break
    }
    e[i] = run ? Math.min((k - run + 1) * HOP + PAD, next) : Math.min(k * HOP, next)
    if (i + 1 < N) {
      // the next word starts where sound rises again after the pause
      let j = fr(e[i] + QIN), up = 0
      for (; j < fr(next + FWD); j++) {
        up = env[j] >= lo ? up + 1 : 0
        if (up * HOP >= 0.03) break
      }
      let on = (j - up + 1) * HOP
      // a sound far ahead of the word (a breath, a music hit): walk back from the word instead, over long quiet only
      if (on < next - MAX_BACK) on = quietBefore(next + FWD, Math.max(e[i], next - MAX_BACK), lo, QLONG)
      s[i + 1] = Math.max(e[i], on - PAD)
    }
  }
  // Repeated DTW anchors can follow a cut snapped a few milliseconds forward. Keep
  // those starts monotonic before capping each preceding word at the next start.
  for (let i = 1; i < N; i++) s[i] = Math.max(s[i - 1], s[i])
  return words.map((w, i) => {
    const a = round(s[i]), b = round(Math.max(e[i], s[i] + 0.01))
    return { ...w, s: a, e: i + 1 < N ? Math.min(b, round(s[i + 1])) : b }
  })
}

/** snapWords over a whole transcript; each segment then spans its first to last word. */
export function snapSegments(segments: Segment[], env: Float32Array): Segment[] {
  const snapped = snapWords(segments.flatMap(s => s.words), env)
  let i = 0
  return segments.map(seg => {
    const words = seg.words.map(() => snapped[i++])
    return words.length ? { ...seg, s: words[0].s, e: words[words.length - 1].e, words } : { ...seg }
  })
}

const round = (t: number) => Math.round(t * 1000) / 1000
