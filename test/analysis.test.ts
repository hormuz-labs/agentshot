import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { analyze, contactSheet, describeShot, mergeParts, parseLoudness, parseMetadata, parseRanges, parseTransforms, report, shakeOf, sheetFrames, shotsOf } from '../src/main/analysis'
import { FFMPEG, probe } from '../src/main/media'

describe('reading the filters\' output', () => {
  it('metadata=print records, one per frame', () => {
    const r = parseMetadata('frame:0    pts:0       pts_time:0\nlavfi.signalstats.YAVG=40.5\nlavfi.signalstats.SATAVG=12\nframe:1    pts:512     pts_time:0.2\nlavfi.scd.time=0.2\n')
    expect(r).toEqual([{ t: 0, v: { 'signalstats.YAVG': 40.5, 'signalstats.SATAVG': 12 } }, { t: 0.2, v: { 'scd.time': 0.2 } }])
  })

  it('black, frozen and silent ranges, including one still open at the end', () => {
    const log = `[blackdetect @ 0x1] black_start:0 black_end:0.48 black_duration:0.48
[freezedetect @ 0x2] lavfi.freezedetect.freeze_start: 3.2
[freezedetect @ 0x2] lavfi.freezedetect.freeze_duration: 1.1
[freezedetect @ 0x2] lavfi.freezedetect.freeze_end: 4.3
[silencedetect @ 0x3] silence_start: -0.01
[silencedetect @ 0x3] silence_end: 1.5 | silence_duration: 1.51
[silencedetect @ 0x3] silence_start: 9.25`
    expect(parseRanges(log, 'black', 10)).toEqual([{ s: 0, e: 0.48 }])
    expect(parseRanges(log, 'freeze', 10)).toEqual([{ s: 3.2, e: 4.3 }])
    expect(parseRanges(log, 'silence', 10)).toEqual([{ s: 0, e: 1.5 }, { s: 9.25, e: 10 }])
  })

  it('ebur128 summary', () => {
    const log = `[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -19.3 LUFS\n    Threshold: -29.6 LUFS\n\n  Loudness range:\n    LRA:         6.1 LU\n\n  True peak:\n    Peak:       -0.4 dBFS`
    expect(parseLoudness(log)).toEqual({ lufs: -19.3, lra: 6.1, peak: -0.4 })
  })

  it('vid.stab transforms: the median local motion per frame, empty frames unknown', () => {
    const trf = 'VID.STAB 1\n#      accuracy = 9\nFrame 1 (List 0 [])\nFrame 2 (List 3 [(LM 4 -2 10 10 16 0.3 0.1),(LM 5 -1 40 10 16 0.3 0.1),(LM 90 90 70 10 16 0.3 0.1)])\n'
    expect(parseTransforms(trf)).toEqual([null, { dx: 5, dy: -1 }])
  })
})

describe('turning numbers into shots', () => {
  it('drops cuts too close together or to the end', () => {
    expect(shotsOf([2, 2.1, 5, 9.9], 10)).toEqual([{ s: 0, e: 2 }, { s: 2, e: 5 }, { s: 5, e: 10 }])
  })

  it('a steady pan has motion and no shake; a jittering camera has shake', () => {
    const pan = Array.from({ length: 50 }, () => ({ dx: 4, dy: 0 }))
    const jitter = Array.from({ length: 50 }, (_, i) => ({ dx: i % 2 ? 9 : -9, dy: i % 3 ? 6 : -12 }))
    const p = shakeOf(pan, 25), j = shakeOf(jitter, 25)
    expect(p.shake).toBeLessThan(0.05)
    expect(p.motion).toBeCloseTo((4 * 25 / 640) * 100, 0)
    expect(j.shake).toBeGreaterThan(0.6)
  })

  it('a long take becomes stretches that look alike', () => {
    const w = (s: number, luma: number, shake: number, motion: number) => ({ s, e: s + 2, luma, shake, motion })
    const parts = mergeParts([w(0, 30, 0.3, 5), w(2, 40, 0.4, 6), w(4, 110, 0.9, 20), w(6, 105, 0.8, 18), w(8, 100, 0.1, 1)])
    expect(parts.map(p => [p.s, p.e, p.luma])).toEqual([[0, 4, 35], [4, 8, 108], [8, 10, 100]])
  })

  it('describes exposure, contrast, colour and shake in words', () => {
    const d = describeShot({ s: 0, e: 2, luma: 30, low: 16, high: 80, sat: 10, u: 120, v: 140, shake: 0.9, motion: 1 })
    expect(d.shake).toBe('shaky')
    expect(d.motion).toBe('static camera')
    expect(d.notes.join(' ')).toMatch(/dark.*flat contrast.*blacks crushed.*muted.*warm cast/)
  })
})

describe('measuring a real file', () => {
  let dir: string
  const vidstab = () => execFileSync(FFMPEG, ['-hide_banner', '-filters']).toString().includes(' vidstabdetect ')
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manul-analysis-'))
    // 2 s of a still test card (testsrc2's own movement would read as shake), a hard cut, 2 s of another card shaken
    // by a jittering crop; a tone, then silence
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=2',
      '-f', 'lavfi', '-i', 'smptebars=s=704x396:r=25:d=2',
      '-f', 'lavfi', '-i', 'sine=f=440:d=2.5', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1.5',
      '-filter_complex', "[0:v]trim=end_frame=1,loop=loop=49:size=1,setpts=N/25/TB[still];[1:v]crop=640:360:x='32+24*sin(n*2.1)':y='18+14*cos(n*2.9)'[shaky];[still][shaky]concat=n=2:v=1:a=0[v];[2:a]aresample=48000[t];[t][3:a]concat=n=2:v=0:a=1[a]",
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'clip.mp4')])
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('the bundled ffmpeg has vid.stab', () => { expect(vidstab()).toBe(true) })

  it('finds the cut, the shake, the loudness and the silence, and caches the result', async () => {
    const file = join(dir, 'clip.mp4')
    const a = await analyze(dir, file)
    expect(a.shots).toHaveLength(2)
    expect(a.shots[1].s).toBeCloseTo(2, 0)
    expect(a.shots[0].shake).toBeLessThan(0.25)
    expect(a.shots[1].shake).toBeGreaterThan(0.6)
    expect(a.audio!.lufs).toBeLessThan(0)
    expect(a.audio!.silence.at(-1)!.s).toBeCloseTo(2.5, 0)
    const text = report(a, 'clip.mp4')
    expect(text).toMatch(/Shots \(2\)/)
    expect(text).toMatch(/2\. 0:02\.0–0:04\.0.*shak/)
    expect(await analyze(dir, file)).toEqual(a) // cached
  }, 60_000)

  it('makes a contact sheet with one labelled frame per shot', async () => {
    const file = join(dir, 'clip.mp4')
    const a = await analyze(dir, file)
    const frames = sheetFrames(a, 16, 2)
    expect(frames.map(f => f.label)).toEqual(['#1  0:01.0', '#2  0:03.0'])
    const out = await contactSheet(file, frames, join(dir, 'sheet.jpg'))
    expect(existsSync(out)).toBe(true)
    const info = await probe(out)
    expect(info.width).toBe(2 * 768 + 4) // two cells side by side, 4 px between them
  })
})
