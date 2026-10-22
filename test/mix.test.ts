import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { duckEnvelope, gainAt, mixArgs, mixCommands, regionsOnTimeline, speechRegions } from '../src/shared/mix'
import { fromMedia, insertAt } from '../src/shared/timeline'
import { FFMPEG } from '../src/main/media'
import type { Transcript } from '../src/shared/types'

const tr = (words: [number, number][]): Transcript => ({ media: 'a', language: 'en', model: 'm', createdAt: 0, segments: [{ s: words[0][0], e: words.at(-1)![1], text: '', words: words.map(([s, e]) => ({ w: 'x', s, e })) }] })

describe('speech regions', () => {
  it('pads words and merges short gaps', () => {
    expect(speechRegions(tr([[1, 1.5], [1.7, 2], [5, 6]]))).toEqual([[0.85, 2.15], [4.85, 6.15]])
  })
  it('follows the timeline through cuts and inserted clips', () => {
    const base = fromMedia('a.mp4', 10, { width: 1, height: 1, fps: 30 })
    // speech at 1–2 s and 6–7 s of the source; a 3 s clip inserted at 4 s pushes the second region 3 s later
    const tl = insertAt(base, 4, { kind: 'clip', clip: 'card', dur: 3 }).timeline
    const r = regionsOnTimeline(tl, { 'a.mp4': tr([[1, 2], [6, 7]]) })
    expect(r).toEqual([[0.85, 2.15], [8.85, 10.15]])
  })
  it('drops speech that was cut out', () => {
    const tl = { ...fromMedia('a.mp4', 10, { width: 1, height: 1, fps: 30 }), items: [{ id: 'x', kind: 'media' as const, src: 'a.mp4', in: 5, out: 10 }] }
    expect(regionsOnTimeline(tl, { 'a.mp4': tr([[1, 2], [6, 7]]) })).toEqual([[0.85, 2.15]])
  })
})

describe('ducking envelope', () => {
  const env = duckEnvelope([[2, 4]], 12, 0.25)
  it('is full volume away from speech, ducked during it, with ramps', () => {
    expect(gainAt(env, 0)).toBe(0)
    expect(gainAt(env, 1.7)).toBe(0)
    expect(gainAt(env, 1.875)).toBeCloseTo(-6, 5) // half way down the ramp
    expect(gainAt(env, 3)).toBe(-12)
    expect(gainAt(env, 4.125)).toBeCloseTo(-6, 5)
    expect(gainAt(env, 9)).toBe(0)
  })
  it('turns into ffmpeg volume commands over time', () => {
    const cmds = mixCommands(env)
    expect(cmds).toMatch(/^0\.000 volume@duck volume 1\.0000;/m)
    expect(cmds).toMatch(/^2\.000 volume@duck volume 0\.2512;/m) // −12 dB from the start of speech, held
  })
})

describe('the mix in a render', () => {
  it('ducks the music under speech by the chosen amount', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-mix-'))
    // film with a silent track (the speech regions are given directly); music: a constant 1 kHz tone
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=160x120:r=25:d=10',
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo:d=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'film.mp4')])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=1000:d=2:sample_rate=48000', join(dir, 'music.wav')])
    const commands = join(dir, "duck [cut],; O'Brien %.cmd")
    writeFileSync(commands, mixCommands(duckEnvelope([[3, 5]], 12, 0.25)))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...mixArgs({ dry: 'film.mp4', duration: 10, mix: { filmDb: 0, music: { src: 'music.wav', db: -6, duckDb: 12 } }, commands, out: 'out.mp4' })], { cwd: dir })
    // loudness of the 1 kHz music alone (band-pass) in a window
    const db = (a: number, b: number) => {
      const result = spawnSync(FFMPEG, ['-hide_banner', '-ss', String(a), '-t', String(b - a), '-i', join(dir, 'out.mp4'),
        '-af', 'bandpass=f=1000:w=100,volumedetect', '-f', 'null', '-'], { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
      return Number(/mean_volume: (-?[\d.]+) dB/.exec(result.stderr)![1])
    }
    // windows clear of the 1 s fade-in, the ramps and the 2 s fade-out at the end
    const outside = db(1.2, 2.6), inside = db(3.4, 4.6)
    expect(outside - inside).toBeGreaterThan(9) // ≈ 12 dB of ducking
    expect(outside - inside).toBeLessThan(15)
    expect(db(5.5, 7.5) - inside).toBeGreaterThan(9) // back up after the speech; the music loops past its 2 s
  })

  it('only changes the film level when there is no music, and copies the picture', () => {
    const a = mixArgs({ dry: 'd.mp4', duration: 5, mix: { filmDb: -3 }, out: 'o.mp4' })
    expect(a).toContain('[0:a]volume=-3dB[af]')
    expect(a.slice(a.indexOf('-c:v'), a.indexOf('-c:v') + 2)).toEqual(['-c:v', 'copy'])
  })
})

import { previewGains } from '../src/shared/mix'

describe('live preview gains (the same curve as the render)', () => {
  const mix = { filmDb: -6, music: { src: 'm.wav', db: -12, duckDb: 12 } }
  const env = duckEnvelope([[3, 5]], 12, 0.25)
  it('film level is constant', () => expect(previewGains(4, 10, mix, env).film).toBeCloseTo(0.5012, 3))
  it('music: level × duck × fades', () => {
    expect(previewGains(0.5, 10, mix, env).music).toBeCloseTo(0.2512 * 0.5, 3) // half way through the 1 s fade-in
    expect(previewGains(2, 10, mix, env).music).toBeCloseTo(0.2512, 3)
    expect(previewGains(4, 10, mix, env).music).toBeCloseTo(0.2512 * 0.2512, 4) // ducked 12 dB
    expect(previewGains(9, 10, mix, env).music).toBeCloseTo(0.2512 * 0.5, 3) // half way through the 2 s fade-out
  })
  it('no music, no music gain', () => expect(previewGains(4, 10, { filmDb: 0 }, env)).toEqual({ film: 1, music: 0 }))
})
