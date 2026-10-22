// Recorded speech -> real whisper.cpp. Runs where whisper-cli + a ggml base model exist.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { setConfig } from '../src/main/config'
import { FFMPEG } from '../src/main/media'
import { findBinaries, findModels, transcribe } from '../src/main/whisper'

const bins = await findBinaries()
const model = findModels(bins).find(m => /base/.test(m))
const ready = !!bins[0] && !!model
const fixture = join(import.meta.dirname, 'fixtures', 'speech', 'narration-music.flac')

describe.skipIf(!ready)('transcription with whisper.cpp', () => {
  afterEach(() => { setConfig({ whisper: undefined }) })
  it('returns sentences with word timings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-stt-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=320x240:d=14', '-i', fixture,
      '-t', '14', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'clip.mp4')])
    setConfig({ whisper: { engine: 'system', mode: 'custom', binary: bins[0], model } })

    const t = await transcribe(join(dir, 'clip.mp4'), join(dir, 'transcripts', 'clip.json'), 'Transcribing clip.mp4')
    const text = t.segments.map(s => s.text).join(' ').toLowerCase()
    expect(text).toContain('welcome')
    expect(text).toMatch(/short film/)
    expect(t.segments.length).toBeGreaterThanOrEqual(2)
    const words = t.segments.flatMap(s => s.words)
    for (const w of words) expect(w.e).toBeGreaterThanOrEqual(w.s)
    expect(words.every((w, i) => i === 0 || w.s >= words[i - 1].s)).toBe(true) // in time order
    expect(existsSync(join(dir, 'transcripts', 'clip.json'))).toBe(true)
    expect(existsSync(join(dir, 'transcripts', '.clip.wav'))).toBe(false) // temp audio cleaned up
  }, 120_000)

  it('puts word cut points in the pauses of narration over music', () => narrationOverMusic(model!, 0.06), 120_000)
  // the bundled engine's multilingual base model (its DTW times are noisier): MANUL_TEST_WHISPER_MODEL=/path/ggml-base.bin
  it.skipIf(!process.env.MANUL_TEST_WHISPER_MODEL)('…and with the model in MANUL_TEST_WHISPER_MODEL', () => narrationOverMusic(process.env.MANUL_TEST_WHISPER_MODEL!, 0.08), 120_000)
})


// Narration over music, with pauses: where whisper.cpp's own word times drift by seconds (they spread words over pauses and music).
// The reference is a forced alignment of the clean voice; the pauses are where the clean voice is silent.
async function narrationOverMusic(model: string, maxMedian: number) {
  const ref = JSON.parse(readFileSync(fixture.replace(/\.flac$/, '.reference.json'), 'utf8')) as { words: { w: string; s: number; e: number }[]; pauses: [number, number][] }
  const dir = mkdtempSync(join(tmpdir(), 'manul-stt-'))
  setConfig({ whisper: { engine: 'system', mode: 'custom', binary: bins[0], model } })
  const t = await transcribe(fixture, join(dir, 'narration.json'), 'Transcribing narration-music.flac')
  const words = t.segments.flatMap(s => s.words)
  const pairs = matchWords(ref.words.map(w => w.w), words.map(w => w.w))
  expect(pairs.length).toBeGreaterThan(ref.words.length * 0.8)

  const errs = pairs.map(([i, j]) => Math.abs(words[j].s - ref.words[i].s)).sort((a, b) => a - b)
  expect(errs[Math.floor(errs.length / 2)]).toBeLessThan(maxMedian) // median word start error

  let edges = 0
  for (const [a0, a1] of ref.pauses) {
    for (const [i, j] of pairs) {
      const r = ref.words[i], w = words[j]
      if (Math.abs(r.e - a0) < 0.25) { // the word before the pause: its cut-out keeps the word, stays in the pause
        edges++
        expect(w.e, `end of "${r.w}"`).toBeGreaterThanOrEqual(r.e - 0.12)
        expect(w.e, `end of "${r.w}"`).toBeLessThanOrEqual(a1)
      }
      if (Math.abs(r.s - a1) < 0.12) { // the word after it: its cut-in lies in the pause, before the word starts
        edges++
        expect(w.s, `start of "${r.w}"`).toBeGreaterThanOrEqual(a0)
        expect(w.s, `start of "${r.w}"`).toBeLessThanOrEqual(r.s + 0.04)
      }
    }
  }
  expect(edges).toBeGreaterThanOrEqual(7)
}

/** Index pairs of the same words in two transcripts (longest common subsequence, punctuation and case ignored). */
function matchWords(a: string[], b: string[]): [number, number][] {
  const n = (w: string) => w.toLowerCase().replace(/[^a-z']/g, '')
  const A = a.map(n), B = b.map(n)
  const L = Array.from({ length: A.length + 1 }, () => new Array<number>(B.length + 1).fill(0))
  for (let i = A.length - 1; i >= 0; i--) for (let j = B.length - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: [number, number][] = []
  for (let i = 0, j = 0; i < A.length && j < B.length;) {
    if (A[i] === B[j]) out.push([i++, j++])
    else if (L[i + 1][j] >= L[i][j + 1]) i++
    else j++
  }
  return out
}

describe('silent media', () => {
  it('gives an empty transcript instead of failing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-silent-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=160x120:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'silent.mp4')])
    const t = await transcribe(join(dir, 'silent.mp4'), join(dir, 't.json'), 'Transcribing silent.mp4')
    expect(t.segments).toEqual([])
    expect(t.language).toBe('none')
  })
})
