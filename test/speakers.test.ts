import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MODELS_DIR, SPEAKERS } from '../src/main/media'
import { analyzeSpeakers, speakersReport, toTurns, withSentences } from '../src/main/speakers'

describe('speaker turns from the runner\'s segments', () => {
  const raw = { duration: 40, segments: [[0, 4, 3, 0.9], [4.5, 9, 3, 0.9], [9.2, 20, 1, 0.8], [20.1, 21, 3, 0.7], [21.2, 39, 1, 0.9], [39, 39.5, 0, 0.4]] as [number, number, number, number][] }

  it('names speakers by first appearance, joins a speaker\'s pieces less than a second apart, flags slivers as minor', () => {
    const sp = toTurns(raw)
    expect(sp.turns.map(t => `${t.speaker} ${t.s}-${t.e}`)).toEqual(['A 0-9', 'B 9.2-20', 'A 20.1-21', 'B 21.2-39', 'C 39-39.5'])
    expect(sp.speakers.map(s => [s.id, s.turns, s.minor])).toEqual([['A', 2, false], ['B', 2, false], ['C', 1, true]])
    expect(speakersReport(sp, 'pod.mp4', '.cache/speakers/x.json')).toMatch(/^pod\.mp4 · 2 speakers \(\+1 minor\) · 5 turns/)
  })

  it('gives each turn the transcript sentences mostly inside it', () => {
    const t = { media: 'a', language: 'en', model: 'm', createdAt: 0, segments: [
      { s: 0.2, e: 3.9, text: ' Hello there.', words: [] }, { s: 9.5, e: 12, text: ' Hi!', words: [] }, { s: 12.5, e: 19, text: ' Long answer.', words: [] }] }
    const sp = withSentences(toTurns(raw), t)
    expect(sp.turns[0].text).toBe('Hello there.')
    expect(sp.turns[1].text).toBe('Hi! Long answer.')
  })
})

describe.skipIf(process.platform === 'win32')('diarizing a real conversation', () => {
  let dir: string
  const fixture = join(import.meta.dirname, 'fixtures', 'speech', 'two-voices.flac')
  const ref = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'speech', 'two-voices.reference.json'), 'utf8')).turns as { speaker: string; s: number; e: number }[]
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'agentshot-speakers-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('the runner and its models are there', () => {
    expect(existsSync(SPEAKERS)).toBe(true)
    for (const m of ['speaker-segmentation.onnx', 'speaker-embedding.onnx']) expect(existsSync(join(MODELS_DIR, m)), m).toBe(true)
  })

  it('finds both voices and every turn, without being told how many there are', async () => {
    const { result } = await analyzeSpeakers(dir, fixture)
    expect(result.speakers.filter(s => !s.minor)).toHaveLength(2)
    expect(result.turns).toHaveLength(ref.length)
    result.turns.forEach((t, i) => {
      expect(t.speaker).toBe(ref[i].speaker)
      expect(Math.abs(t.s - ref[i].s)).toBeLessThan(0.4)
      expect(Math.abs(t.e - ref[i].e)).toBeLessThan(0.4)
    })
  }, 120_000)
})
