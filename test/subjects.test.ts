import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FFMPEG, MODELS_DIR, VISION, probe } from '../src/main/media'
import { cropFilter, cropPath, findSubjects, follow, shotSubjects, simplify, track, type Det } from '../src/main/subjects'

const det = (t: number, x: number, w: number, kind = 'car', score = 0.9): Det => ({ t, x: x - w / 2, y: 0.3, w, h: w * 0.6, score, kind })

describe('following subjects', () => {
  it('links a moving subject into one track, other kinds into their own, and starts again after a long gap', () => {
    const dets = [...[0, 0.2, 0.4, 0.6].map((t, i) => det(t, 0.3 + i * 0.03, 0.4)), det(0.2, 0.8, 0.1, 'face'), det(5, 0.35, 0.4)]
    const tracks = track(dets)
    expect(tracks.map(t => [t.kind, t.points.length])).toEqual([['car', 4], ['face', 1], ['car', 1]])
  })

  it('stays on the subject when a much smaller one of the same kind shows up nearby (a car parked behind)', () => {
    const dets = [det(0, 0.5, 0.95), det(0.2, 0.84, 0.12), det(0.4, 0.52, 0.9), det(0.6, 0.54, 0.85)]
    expect(follow(dets, 'car', { t: 0, x: 0.5, w: 0.95 }, 0, 1).map(k => k.x)).toEqual([0.5, 0.52, 0.54])
  })

  it('a face seen for a good part of the shot is the subject, over the bigger body around it', () => {
    const dets = [0, 0.2, 0.4, 0.6, 0.8].flatMap(t => [det(t, 0.5, 0.5, 'person'), det(t, 0.46, 0.08, 'face')])
    const sh = shotSubjects(track(dets), 0, 1, 5, 0.3164, dets)
    expect(sh.main?.kind).toBe('face')
    expect(sh.crop).toHaveLength(1)
    expect(sh.crop![0].x).toBeCloseTo(0.46, 2)
  })
})

describe('crop paths', () => {
  it('a still subject gives one centre; a moving one a smooth path no faster than 15 % of the width a second, inside the frame', () => {
    expect(cropPath([{ t: 0, x: 0.5 }, { t: 4, x: 0.51 }], 0, 4, 5, 0.3164)).toEqual([{ t: 0, x: 0.505 }])
    const moving = cropPath([{ t: 0, x: 0.2 }, { t: 1, x: 0.95 }, { t: 6, x: 0.95 }], 0, 6, 5, 0.3164)
    for (let i = 1; i < moving.length; i++) expect(Math.abs(moving[i].x - moving[i - 1].x) / (moving[i].t - moving[i - 1].t)).toBeLessThanOrEqual(0.15 + 1e-3)
    expect(Math.min(...moving.map(k => k.x))).toBeGreaterThanOrEqual(0.3164 / 2 - 1e-3)
    expect(Math.max(...moving.map(k => k.x))).toBeLessThanOrEqual(1 - 0.3164 / 2 + 1e-3)
  })

  it('simplify keeps the turning points', () => {
    const p = [0, 1, 2, 3, 4].map(t => ({ t, x: t < 2 ? 0.3 : 0.3 + (t - 2) * 0.1 }))
    expect(simplify(p, 0.01).map(k => k.t)).toEqual([0, 2, 4])
  })

  let dir: string
  beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'manul-subjects-')) })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('the crop filter is valid ffmpeg and makes the vertical frame', async () => {
    const vf = `${cropFilter([{ t: 0, x: 0.3 }, { t: 1, x: 0.7 }, { t: 2, x: 0.7 }], '9/16')},scale=1080:1920`
    const out = join(dir, 'v.mp4')
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=25:d=2', '-vf', vf, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out])
    const info = await probe(out)
    expect([info.width, info.height]).toEqual([1080, 1920])
  })
})

describe.skipIf(process.platform === 'win32')('the vision runner', () => {
  let dir: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'manul-vision-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=25:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'a.mp4')])
  })
  afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

  it('the runner and its models are there', () => {
    expect(existsSync(VISION)).toBe(true)
    for (const m of ['faces-yunet.onnx', 'objects-yolox-tiny.onnx']) expect(existsSync(join(MODELS_DIR, m)), m).toBe(true)
  })

  it('reads every sampled frame with both models (a test card: nothing to find), and caches', async () => {
    const r = await findSubjects(dir, join(dir, 'a.mp4'))
    expect(r.fps).toBe(5)
    expect(r.dets.every(d => d.x >= 0 && d.y >= 0 && d.x + d.w <= 1.0001 && d.y + d.h <= 1.0001)).toBe(true)
    expect((await findSubjects(dir, join(dir, 'a.mp4'))).dets).toEqual(r.dets)
  }, 60_000)
})
