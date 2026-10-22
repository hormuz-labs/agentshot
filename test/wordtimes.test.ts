import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { dtwFlags, dtwLag, dtwPreset, envelope, HOP, readWav, snapSegments, snapWords, whisperCppWords } from '../src/main/wordtimes'

const { help } = vi.hoisted(() => ({ help: new Map<string, string>() }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  const execFile = Object.assign(vi.fn(), { [promisify.custom]: vi.fn(async (bin: string, args: string[]) => {
    expect(args).toEqual(['--help'])
    if (!help.has(bin)) throw new Error('ENOENT')
    return { stdout: '', stderr: help.get(bin)! }
  }) })
  return { ...actual, execFile }
})

const SR = 16000

describe('dtwPreset', () => {
  it('maps ggml model files to whisper.cpp alignment-head presets', () => {
    expect(dtwPreset('/m/ggml-base.en.bin')).toBe('base.en')
    expect(dtwPreset('/m/ggml-base.bin')).toBe('base')
    expect(dtwPreset('/m/ggml-small.en-q5_1.bin')).toBe('small.en')
    expect(dtwPreset('/m/ggml-large-v3-turbo.bin')).toBe('large.v3.turbo')
    expect(dtwPreset('/m/ggml-large-v3-turbo-q8_0.bin')).toBe('large.v3.turbo')
    expect(dtwPreset('/m/ggml-large-v2.bin')).toBe('large.v2')
    expect(dtwPreset('/m/ggml-medium.en.bin')).toBe('medium.en')
  })
  it('gives none for models it does not know (DTW then stays off)', () => {
    expect(dtwPreset('/m/ggml-distil-large-v3.bin')).toBeNull()
    expect(dtwPreset('/m/my-finetune.bin')).toBeNull()
  })
})

describe('dtwLag', () => {
  it('is measured per model: base.en trails by ~95 ms, the multilingual base (the bundled one) by ~130 ms', () => {
    expect(dtwLag('/m/ggml-base.en.bin')).toBe(0.095)
    expect(dtwLag('/m/ggml-base.bin')).toBe(0.13)
    expect(dtwLag('/m/ggml-base-q5_1.bin')).toBe(0.13)
  })
  it('falls back to the base.en value for models not measured yet', () => {
    expect(dtwLag('/m/ggml-small.en.bin')).toBe(0.095)
    expect(dtwLag('/m/ggml-large-v3-turbo.bin')).toBe(0.095)
  })
})

describe('dtwFlags', () => {
  const dir = 'fake-binaries'
  const fake = (name: string, text: string) => {
    const bin = join(dir, name)
    help.set(bin, text)
    return bin
  }
  it('turns DTW on (and flash attention off) when the binary supports both', async () => {
    const bin = fake('new', '  -dtw MODEL --dtw MODEL   compute token-level timestamps\n  -nfa,  --no-flash-attn  disable flash attention')
    expect(await dtwFlags(bin, '/m/ggml-base.bin')).toEqual(['-dtw', 'base', '-nfa'])
  })
  it('skips -nfa on builds without flash attention', async () => {
    expect(await dtwFlags(fake('mid', '  -dtw MODEL --dtw MODEL'), '/m/ggml-base.en.bin')).toEqual(['-dtw', 'base.en'])
  })
  it('stays off for old builds and unknown models', async () => {
    expect(await dtwFlags(fake('old', '  -ml N  max segment length'), '/m/ggml-base.bin')).toEqual([])
    expect(await dtwFlags(fake('new2', '  -dtw MODEL\n  -nfa'), '/m/custom.bin')).toEqual([])
    expect(await dtwFlags(join(dir, 'missing'), '/m/ggml-base.bin')).toEqual([])
  })
})

describe('whisperCppWords', () => {
  const tok = (text: string, from: number, to: number, dtw = -1) => ({ text, offsets: { from, to }, tokens: [{ text, t_dtw: dtw }] })
  it('uses the DTW time (minus the model\'s lag) as the word start, the segment offsets otherwise', () => {
    const raw = { transcription: [tok(' A', 70, 4360, 509), tok(' cat.', 4360, 9360, 580), tok(' He', 9360, 9540)] }
    const w = whisperCppWords(raw, 0.13)
    expect(w.map(x => x.w)).toEqual(['A', 'cat.', 'He'])
    expect(w[0].s).toBeCloseTo(5.09 - 0.13, 3)
    expect(w[1].s).toBeCloseTo(5.80 - 0.13, 3)
    expect(w[2].s).toBeCloseTo(9.36, 3) // no DTW time: falls back to the offset
    expect(whisperCppWords(raw, null)[0].s).toBeCloseTo(0.07, 3) // DTW off
  })
  it('drops non-speech markers and keeps starts in time order', () => {
    const raw = { transcription: [tok(' one', 0, 500, 120), tok(' [BLANK_AUDIO]', 500, 900), tok(' two', 900, 1200, 110), tok(' ', 1200, 1300)] }
    const w = whisperCppWords(raw, 0.095)
    expect(w.map(x => x.w)).toEqual(['one', 'two'])
    expect(w[1].s).toBeGreaterThanOrEqual(w[0].s)
  })
})

describe('readWav', () => {
  it('reads 16-bit PCM mono, skipping other chunks', () => {
    const samples = [0, 16384, -16384, 32767]
    const data = Buffer.alloc(samples.length * 2)
    samples.forEach((v, i) => data.writeInt16LE(v, i * 2))
    const list = Buffer.concat([Buffer.from('LIST'), Buffer.from([4, 0, 0, 0]), Buffer.from('INFO')])
    const fmt = Buffer.alloc(24)
    fmt.write('fmt ', 0); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10)
    fmt.writeUInt32LE(SR, 12); fmt.writeUInt32LE(SR * 2, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22)
    const head = Buffer.alloc(8); head.write('data', 0); head.writeUInt32LE(data.length, 4)
    const body = Buffer.concat([Buffer.from('WAVE'), fmt, list, head, data])
    const riff = Buffer.alloc(8); riff.write('RIFF', 0); riff.writeUInt32LE(body.length, 4)
    const { sr, x } = readWav(Buffer.concat([riff, body]))
    expect(sr).toBe(SR)
    expect(Array.from(x)).toEqual(samples)
  })
})

// ---------------------------------------------------------------- a synthetic recording
// A quiet music bed (110 Hz, about -33 dB) under "words": loud noisy bursts with speech-like energy.
function recording(words: [number, number][], dur: number, gapsInside: [number, number][] = []) {
  const x = new Float32Array(Math.round(dur * SR))
  let seed = 7
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) * 2 - 1
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    x[i] = 0.03 * Math.sin(2 * Math.PI * 110 * t)
    const inWord = words.some(([a, b]) => t >= a && t < b) && !gapsInside.some(([a, b]) => t >= a && t < b)
    if (inWord) x[i] += 0.2 * Math.sin(2 * Math.PI * 220 * t) + 0.15 * noise()
  }
  return x
}
const w = (word: string, s: number, e = s) => ({ w: word, s, e })

describe('envelope', () => {
  it('reads 16-bit samples the same as floats', () => {
    const f = recording([[0.2, 0.4]], 0.6), i16 = Int16Array.from(f, v => Math.round(v * 32767))
    const a = envelope(f, SR), b = envelope(i16, SR)
    expect(Math.max(...a.map((v, k) => Math.abs(v - b[k])))).toBeLessThan(0.5)
  })
  it('is loud in words and near the bed between them, one value per 5 ms', () => {
    const env = envelope(recording([[1, 1.5]], 2), SR)
    expect(env.length).toBeCloseTo(2 / HOP, -1)
    const at = (t: number) => env[Math.round(t / HOP)]
    expect(at(1.25) - at(0.5)).toBeGreaterThan(15)
  })
})

describe('snapWords', () => {
  // "Hello there." (joined by a 40 ms dip) · pause · "Unfortunately" (a quiet consonant inside it) · 100 ms gap · "yes."
  const truth: [number, number][] = [[1.0, 1.38], [1.42, 1.8], [3.0, 3.6], [3.7, 4.0]]
  const env = envelope(recording(truth, 5, [[3.12, 3.17]]), SR)
  // whisper's word starts: close on the first two, 0.4 s late on "Unfortunately" (as DTW was on the real clip), 20 ms late on "yes."
  const out = snapWords([w('Hello', 1.03), w('there.', 1.45), w('Unfortunately', 3.4), w('yes.', 3.72)], env)
  const [hello, there, unf, yes] = out

  it('starts the first word in the quiet just before it, not at the start of the file', () => {
    expect(hello.s).toBeGreaterThanOrEqual(0.9)
    expect(hello.s).toBeLessThanOrEqual(1.0)
  })
  it('joins words in running speech at one cut point in the dip between them', () => {
    expect(hello.e).toBe(there.s)
    expect(there.s).toBeGreaterThanOrEqual(1.37)
    expect(there.s).toBeLessThanOrEqual(1.43)
  })
  it('ends a word before a pause just after its sound stops', () => {
    expect(there.e).toBeGreaterThanOrEqual(1.8)
    expect(there.e).toBeLessThanOrEqual(1.9)
  })
  it('finds the start of a word after a pause even when the given start is late and the word has a quiet consonant inside', () => {
    expect(unf.s).toBeGreaterThanOrEqual(2.9)
    expect(unf.s).toBeLessThanOrEqual(3.0)
  })
  it('splits a short gap between its two words', () => {
    expect(unf.e).toBeGreaterThanOrEqual(3.6)
    expect(yes.s).toBeLessThanOrEqual(3.7)
    expect(unf.e).toBeLessThanOrEqual(yes.s)
  })
  it('never puts a cut point inside a word, and keeps words in order', () => {
    const inside = (t: number) => truth.some(([a, b]) => t > a + 0.01 && t < b - 0.01) && !(t >= 3.12 && t <= 3.17)
    for (const x of out) {
      expect(inside(x.s)).toBe(false)
      expect(inside(x.e)).toBe(false)
      expect(x.e).toBeGreaterThan(x.s)
    }
    out.forEach((x, i) => i && expect(x.s).toBeGreaterThanOrEqual(out[i - 1].e))
    expect(yes.e).toBeGreaterThanOrEqual(4.0)
    expect(yes.e).toBeLessThanOrEqual(4.1)
  })
  it('keeps other fields and handles no words', () => {
    expect(snapWords([{ w: 'hi', s: 1.03, e: 1.3, p: 0.9 }], env)[0].p).toBe(0.9)
    expect(snapWords([], env)).toEqual([])
  })
})

describe('snapSegments', () => {
  it('snaps every word and moves each segment to its first and last word', () => {
    const env = envelope(recording([[1.0, 1.38], [1.42, 1.8], [3.0, 3.6]], 5), SR)
    const segs = snapSegments([
      { s: 0, e: 1.9, text: 'Hello there.', words: [w('Hello', 1.03, 1.4), w('there.', 1.45, 1.9)] },
      { s: 1.9, e: 4.5, text: 'Again', words: [w('Again', 3.05, 4.5)] },
    ], env)
    expect(segs[0].s).toBe(segs[0].words[0].s)
    expect(segs[0].e).toBe(segs[0].words[1].e)
    expect(segs[1].s).toBeGreaterThanOrEqual(2.9)
    expect(segs[1].e).toBeLessThanOrEqual(3.75)
    expect(segs.map(s => s.text)).toEqual(['Hello there.', 'Again'])
  })
})
