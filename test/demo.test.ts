import { describe, expect, it } from 'vitest'
import { cameraAt, cameraLayout, demoCleanup, demoCuts, demoHint, demoSummary } from '../src/shared/demo'
import { applyEdit, fromMedia, sameCut } from '../src/shared/timeline'
import { synchronize, fitSync } from '../src/main/sync'
import { joinAttached, splitAttached } from '../src/shared/attached'

function signal(seconds: number, sr: number) {
  let seed = 431
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296 }
  const x = new Float32Array(seconds * sr)
  let volume = 0
  for (let i = 0; i < x.length; i++) { if (i % (sr / 10) === 0) volume = random() ** 2; x[i] = (random() * 2 - 1) * volume }
  return x
}

describe('audio synchronization', () => {
  it('finds an unequal-length camera recording with different gain and background noise', () => {
    const sr = 8000, screen = signal(36, sr), offset = 5.137
    const camera = screen.slice(Math.round(offset * sr), Math.round((offset + 25) * sr))
    for (let i = 0; i < camera.length; i++) camera[i] = camera[i] * 0.4 + Math.sin(i * 0.183) * 0.003
    const sync = synchronize(screen, camera, sr)
    expect(sync.reliable).toBe(true)
    expect(sync.offset).toBeCloseTo(offset, 2)
    expect(sync.rate).toBeCloseTo(1, 4)
  })
  it('supports a camera that starts before the screen', () => {
    const sr = 8000, camera = signal(32, sr), screen = camera.slice(3 * sr, 28 * sr)
    const sync = synchronize(screen, camera, sr)
    expect(sync.reliable).toBe(true)
    expect(sync.offset).toBeCloseTo(-3, 2)
  })
  it('does not claim silence or unrelated signals are aligned', () => {
    expect(synchronize(new Float32Array(80000), new Float32Array(60000)).reliable).toBe(false)
    const a = signal(20, 8000), b = Float32Array.from(a, (_, i) => Math.sin(i * 0.019) * Math.sin(i * 0.004))
    expect(synchronize(a, b).reliable).toBe(false)
  })
  it('rejects ambiguous repeated takes instead of guessing which occurrence to use', () => {
    const take = signal(16, 8000), screen = new Float32Array(take.length * 2)
    screen.set(take); screen.set(take, take.length)
    expect(synchronize(screen, take).reliable).toBe(false)
  })
  it('fits drift while rejecting a bad anchor', () => {
    const sync = fitSync([0, 40, 80, 120, 160].map((camera, i) => ({ camera, screen: 7 + 1.0008 * camera + (i === 2 ? 1 : 0), score: 0.9 })), 7, 200, 180)
    expect(sync.reliable).toBe(true)
    expect(sync.rate).toBeCloseTo(1.0008, 5)
    expect(sync.anchors).toHaveLength(4)
  })
  it('measures actual time drift across independently sampled signals', () => {
    const sr = 8000, screen = signal(90, sr), offset = 4.13, rate = 1.0006, camera = new Float32Array(70 * sr)
    for (let i = 0; i < camera.length; i++) {
      const at = offset * sr + i * rate, k = Math.floor(at), f = at - k
      camera[i] = screen[k] * (1 - f) + screen[k + 1] * f
    }
    const sync = synchronize(screen, camera)
    expect(sync.reliable).toBe(true)
    expect(sync.offset).toBeCloseTo(offset, 1)
    expect(sync.rate).toBeCloseTo(rate, 4)
  })
})

describe('linked demo editing', () => {
  it('accepts natural-language keep-everything retries without changing the cleanup policy', () => {
    for (const value of ['none', 'keep-all', 'keep everything', 'keep_everything', 'off']) expect(demoCleanup(value)).toBe('none')
    expect(demoCleanup()).toBe('natural')
    expect(() => demoCleanup('aggressive')).toThrow(/natural.*tight.*none/)
  })
  const base = () => ({ ...fromMedia('screen.mp4', 30, { width: 1920, height: 1080, fps: 30 }), demo: { screen: 'screen.mp4', camera: 'camera.mp4', cameraDuration: 20,
    sync: fitSync([0, 8, 16].map(camera => ({ camera, screen: camera + 5, score: 1 })), 5, 30, 20), layout: cameraLayout(1920, 1080), audio: 'screen' as const } })
  it('ripples all tracks together and hides the camera beyond coverage', () => {
    const tl = applyEdit(base(), { op: 'cut', from: 8, to: 12 })
    expect(cameraAt(tl, 9)?.at).toBe(8)
    expect(cameraAt(tl, 1)).toBeNull()
    expect(cameraAt(tl, 23)).toBeNull()
  })
  it('preserves sync metadata when resizing and detects the changed composition', () => {
    const tl = base(), after = applyEdit(tl, { op: 'camera', layout: { width: 300, shape: 'square' } })
    expect(after.demo?.layout.height).toBe(300)
    expect(after.demo?.sync).toEqual(tl.demo.sync)
    expect(sameCut(tl, after)).toBe(false)
    expect(() => cameraLayout(1920, 1080, { width: NaN })).toThrow(/finite/)
    expect(() => cameraLayout(1920, 1080, { crop: { x: 0.8, y: 0, w: 0.5, h: 1 } })).toThrow(/inside/)
    expect(cameraLayout(1080, 1920, { width: 1200, shape: 'square' })).toMatchObject({ width: 1080, height: 1080 })
  })
  it('preserves static-screen narration and silent screen actions', () => {
    const cuts = demoCuts(30, [{ s: 3, e: 10 }], [{ s: 18, e: 22 }], 'natural')
    expect(cuts).toHaveLength(3)
    expect(cuts.every(c => c.e <= 3 || c.s >= 10)).toBe(true)
    expect(cuts.every(c => c.e <= 18 || c.s >= 22)).toBe(true)
    expect(demoCuts(30, [], [], 'tight')).toEqual([])
  })
  it('refreshes final duration after later cuts without calling every user trim automatic stale detection', () => {
    const tl = base()
    tl.demo.summary = demoSummary(30, 30, 0, 0, 'none')
    const after = applyEdit(tl, { op: 'cut', from: 0, to: 5 })
    expect(after.demo?.summary).toMatchObject({ original: 30, final: 25, removed: 5, staleRemoved: 0, additionalTrimmed: 5 })
    expect(after.demo?.summary?.message).toContain('subsequent timeline edits')
  })
  it('routes only a pair of video attachments when the skill is enabled', () => {
    const media = { a: { width: 1920 }, b: { width: 1080 }, logo: { width: 0 } }
    expect(demoHint(['a', 'b'], media, true)).toContain('demo-editor')
    expect(demoHint(['a', 'logo'], media, true)).toBe('')
    expect(demoHint(['a', 'b'], media, false)).toBe('')
    expect(splitAttached(joinAttached('Clean my demo', ['a — video', 'b — video']) + demoHint(['a', 'b'], media, true))).toEqual({ text: 'Clean my demo', files: ['a', 'b'], more: 0 })
  })
})
