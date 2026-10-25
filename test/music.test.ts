import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BEATS, FFMPEG } from '../src/main/media'
import { analyzeMusic, musicReport, rhythm, type BeatsRaw } from '../src/main/music'

/** Tracker output for a 120 BPM track: beats from `from` (the tracker's warm-up), accents on every 4th beat from 0.25 s. */
function raw(o: { from?: number; skip?: number[]; loudFrom?: number } = {}): BeatsRaw {
  const rate = 20, dur = 16
  const all = Array.from({ length: 32 }, (_, i) => 0.25 + i * 0.5)
  return {
    sr: 44100, duration: dur, bpm: 120, confidence: 0.5,
    beats: all.filter(t => t >= (o.from ?? 1.7) && !(o.skip || []).includes(t)).map(t => t + 0.01),
    onsets: all.map(t => [t, (Math.round((t - 0.25) / 0.5) % 4 === 0 ? 1 : 0.3)] as [number, number]),
    env: { rate, rms: Array.from({ length: dur * rate }, (_, i) => (i / rate >= (o.loudFrom ?? 99) ? 0.5 : 0.05)), flux: Array.from({ length: dur * rate }, () => 0) },
  }
}

describe('rhythm from the tracker\'s beats', () => {
  it('finds the tempo, completes the grid back to the first beat and snaps beats onto the onsets', () => {
    const m = rhythm(raw())
    expect(m.bpm).toBe(120)
    expect(m.steadiness).toBeGreaterThan(0.9)
    expect(m.beats.slice(0, 3)).toEqual([0.25, 0.75, 1.25])
  })

  it('fills skipped beats so bar counting never slips', () => {
    const m = rhythm(raw({ skip: [6.25, 6.75, 7.25] }))
    expect(m.beats).toContain(6.75)
    expect(m.bars.every((b, i) => i === 0 || Math.abs(b.t - m.bars[i - 1].t - 2) < 0.01)).toBe(true)
  })

  it('puts bars on the accented beats', () => {
    const m = rhythm(raw())
    expect(m.bars.slice(0, 3).map(b => b.t)).toEqual([0.25, 2.25, 4.25])
  })

  it('marks where the energy lifts', () => {
    const m = rhythm(raw({ loudFrom: 8.25 }))
    const lift = m.bars.find(b => b.label.includes('lift'))
    expect(lift?.t).toBe(8.25)
    expect(musicReport(m, 'song.wav', '.cache/music/x.json')).toMatch(/bars 1–4 from 0:00\.25 quiet → bars? 5.* from 0:08\.25 full \(lift\/drop/)
  })
})

describe.skipIf(process.platform === 'win32')('tracking a real file', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'agentshot-music-'))
    // 12 s of clicks at 120 BPM from 0.25 s, the first of every four louder and higher
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
      "aevalsrc='if(lt(mod(t+0.25,0.5),0.04), sin(2*PI*(if(lt(mod(t+0.25,2),0.04),1500,800))*t)*(if(lt(mod(t+0.25,2),0.04),1,0.4)), 0)':s=44100:d=12",
      '-c:a', 'libmp3lame', '-b:a', '192k', join(dir, 'click.mp3')])
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('the beat tracker is built', () => { expect(existsSync(BEATS)).toBe(true) })

  it('hears 120 BPM, the beats within 20 ms and the bars on the accents; saves every beat', async () => {
    const { music, beatsFile } = await analyzeMusic(dir, join(dir, 'click.mp3'))
    expect(music.bpm).toBeGreaterThan(119)
    expect(music.bpm).toBeLessThan(121)
    expect(music.steadiness).toBeGreaterThan(0.85)
    const expected = Array.from({ length: 23 }, (_, i) => 0.25 + i * 0.5)
    for (const t of expected.slice(1, -1)) expect(Math.min(...music.beats.map(b => Math.abs(b - t)))).toBeLessThan(0.02)
    for (const b of music.bars) expect(Math.abs(((b.t - 1.75) % 2 + 2) % 2) < 0.03 || Math.abs(((b.t - 1.75) % 2 + 2) % 2 - 2) < 0.03).toBe(true)
    expect(JSON.parse(readFileSync(beatsFile, 'utf8')).beats).toEqual(music.beats)
  })
})
