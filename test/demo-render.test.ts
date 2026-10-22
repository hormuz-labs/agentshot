import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFMPEG, probe } from '../src/main/media'
import { composeArgs, applyEdit, duration, fromMedia } from '../src/shared/timeline'
import { cameraLayout, type CameraShape } from '../src/shared/demo'
import { analyzeScreen } from '../src/main/screen-activity'
import { planDemo } from '../src/main/demo'
import { syncMedia } from '../src/main/sync'
import type { Project, Transcript } from '../src/shared/types'

const ff = (...args: string[]) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args])
describe('demo rendering with the real bundled FFmpeg', () => {
  it('extracts and syncs actual media in a worker, then uses the cache', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-sync-'))
    try {
      ff('-f', 'lavfi', '-i', "anoisesrc=seed=42:d=24:r=8000,volume='0.2+0.15*sin(1.3*t)+0.05*sin(3.7*t)':eval=frame", join(dir, 'screen.wav'))
      ff('-ss', '2.13', '-t', '18', '-i', join(dir, 'screen.wav'), join(dir, 'camera.wav'))
      const a = await syncMedia(dir, 'screen.wav', 'camera.wav')
      expect(a.reliable).toBe(true)
      expect(a.offset).toBeCloseTo(2.13, 2)
      expect(await syncMedia(dir, 'screen.wav', 'camera.wav')).toEqual(a)
      const stopped = new AbortController(); stopped.abort(new Error('Stop requested'))
      await expect(syncMedia(dir, 'camera.wav', 'screen.wav', stopped.signal)).rejects.toThrow()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('matches a real spoken narration after lossy encoding and a different microphone gain', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-speech-sync-'))
    try {
      const speech = join(import.meta.dirname, 'fixtures', 'speech', 'narration-music.flac')
      ff('-t', '45', '-i', speech, '-c:a', 'aac', join(dir, 'screen.m4a'))
      ff('-ss', '4.37', '-t', '32', '-i', join(dir, 'screen.m4a'), '-af', 'volume=0.4,highpass=f=180', '-c:a', 'aac', join(dir, 'camera.m4a'))
      const result = await syncMedia(dir, 'screen.m4a', 'camera.m4a')
      expect(result.reliable).toBe(true)
      expect(result.offset).toBeCloseTo(4.37, 1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('matches shared audio on video timeline timestamps when the screen microphone starts late', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-delayed-sync-'))
    try {
      ff('-f', 'lavfi', '-i', 'color=c=blue:s=320x200:r=25:d=24', '-itsoffset', '0.33', '-f', 'lavfi', '-i', "anoisesrc=seed=42:d=23:r=16000,volume='0.2+0.15*sin(1.3*t)+0.05*sin(3.7*t)':eval=frame", '-c:v', 'libx264', '-c:a', 'aac', join(dir, 'screen.mp4'))
      ff('-ss', '2.13', '-t', '18', '-i', join(dir, 'screen.mp4'), '-c:v', 'libx264', '-c:a', 'aac', join(dir, 'camera.mp4'))
      const result = await syncMedia(dir, 'screen.mp4', 'camera.mp4')
      expect(result.reliable).toBe(true)
      expect(result.offset).toBeCloseTo(2.13, 1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it.each(['circle', 'square', 'rectangle', 'rounded'] as CameraShape[])('renders %s without freezing a camera before or after coverage, including ripple cuts', async shape => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-render-'))
    try {
      ff('-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(dir, 'screen.mp4'))
      ff('-f', 'lavfi', '-i', "color=c=red:s=160x120:r=30:d=3,drawbox=x=0:y=0:w=iw:h=ih:color=lime:t=fill:enable='gte(t,1.5)'", '-f', 'lavfi', '-i', 'sine=f=880:d=3', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(dir, 'camera.mp4'))
      const base = { ...fromMedia('screen.mp4', 6, { width: 320, height: 180, fps: 25 }), demo: { screen: 'screen.mp4', camera: 'camera.mp4', cameraDuration: 3,
        sync: { offset: 1, rate: 1.001, confidence: 1, reliable: true, residual: 0, anchors: [], overlap: [1, 4.003] as [number, number], method: 'fixture' },
        layout: cameraLayout(320, 180, { shape, width: 80, height: 60, x: 220, y: 20, border: 0 }), audio: 'camera' as const } }
      const tl = applyEdit(base, { op: 'cut', from: 2, to: 3 })
      // Small runner CPU counts exposed invalid timestamps in adelay's generated leading silence.
      ff('-cpucount', '2', ...composeArgs(tl, { inputOf: it => it.kind === 'media' ? join(dir, it.src) : '', hasAudio: () => true, out: join(dir, 'out.mp4') }).map(a => a === 'camera.mp4' ? join(dir, a) : a))
      const info = await probe(join(dir, 'out.mp4'))
      expect(info.duration).toBeCloseTo(5, 1)
      const px = (t: number, x: number, y: number) => [...ff('-ss', String(t), '-i', join(dir, 'out.mp4'), '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-')]
      expect(px(0.5, 260, 50)[2]).toBeGreaterThan(180)
      expect(px(1.5, 260, 50)[0]).toBeGreaterThan(180)
      expect(px(2.5, 260, 50)[1]).toBeGreaterThan(180) // source time 2.5: later green camera frame after the shared cut
      expect(px(4, 260, 50)[2]).toBeGreaterThan(180)
      if (shape === 'circle' || shape === 'rounded') expect(px(1.5, 220, 20)[2]).toBeGreaterThan(180)
      const pcm = ff('-i', join(dir, 'out.mp4'), '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-')
      const tone = (t: number, expected: number, unwanted: number) => {
        const raw = pcm.subarray(Math.round(t * 8000) * 4, Math.round((t + 0.2) * 8000) * 4)
        expect(raw.length).toBe(1600 * 4)
        const crossings: number[] = []
        let last = raw.readFloatLE(0)
        for (let i = 1; i < raw.length / 4; i++) { const x = raw.readFloatLE(i * 4); if (x > 0 && last <= 0) crossings.push(i); last = x }
        // Measure complete cycles, avoiding the extra crossing caused by the window's initial phase.
        expect((crossings.length - 1) * 8000 / (crossings.at(-1)! - crossings[0])).toBeCloseTo(expected, -1)
        const amplitude = (hz: number) => {
          let re = 0, im = 0
          for (let i = 0; i < raw.length / 4; i++) { const x = raw.readFloatLE(i * 4); re += x * Math.cos(2 * Math.PI * hz * i / 8000); im += x * Math.sin(2 * Math.PI * hz * i / 8000) }
          return 2 * Math.hypot(re, im) / (raw.length / 4)
        }
        expect(amplitude(expected)).toBeGreaterThan(0.05)
        expect(amplitude(unwanted)).toBeLessThan(amplitude(expected) * 0.05)
      }
      tone(0.5, 440, 880) // uncovered: screen narration
      tone(1.5, 880, 440) // covered: camera narration, never duplicate microphones
      tone(2.5, 880, 440) // camera remains aligned after the shared ripple cut
      tone(4, 440, 880) // camera ended: screen narration resumes
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('detects a local screen change but not a static screen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-activity-'))
    try {
      ff('-f', 'lavfi', '-i', "color=c=white:s=480x270:r=25:d=4,drawbox=x=100:y=100:w=80:h=30:color=black:t=fill:enable='between(t,1,2)'", '-c:v', 'libx264', join(dir, 'screen.mp4'))
      const a = await analyzeScreen(dir, 'screen.mp4')
      expect(a.active.length).toBeGreaterThan(0)
      expect(a.active.every(r => r.s >= 0.5 && r.e <= 2.75)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('keeps segment durations and microphone start offsets for variable-rate screen recordings', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-delayed-audio-'))
    try {
      ff('-f', 'lavfi', '-i', "testsrc2=s=320x200:r=30:d=8,select='not(mod(n,3))',setpts=PTS", '-itsoffset', '0.332687', '-f', 'lavfi', '-i', 'sine=f=440:d=7.6', '-fps_mode', 'vfr', '-c:v', 'libx264', '-c:a', 'aac', join(dir, 'screen.mov'))
      const info = await probe(join(dir, 'screen.mov'))
      const tl = applyEdit(fromMedia('screen.mov', info.duration, { width: 320, height: 200, fps: 25.23 }), { op: 'cut', from: 3.012, to: 4.218 })
      ff(...composeArgs(tl, { inputOf: () => join(dir, 'screen.mov'), hasAudio: () => true, out: join(dir, 'out.mp4') }))
      expect(Math.abs((await probe(join(dir, 'out.mp4'))).duration - duration(tl))).toBeLessThan(0.08)
      const pcm = ff('-i', join(dir, 'out.mp4'), '-vn', '-ac', '1', '-ar', '8000', '-f', 'f32le', '-')
      const rms = (from: number, to: number) => {
        let sum = 0
        for (let i = Math.round(from * 8000); i < Math.round(to * 8000); i++) sum += pcm.readFloatLE(i * 4) ** 2
        return Math.sqrt(sum / ((to - from) * 8000))
      }
      expect(rms(0.02, 0.2)).toBeLessThan(0.002) // actual late microphone, not pulled earlier by STARTPTS
      expect(rms(0.5, 0.7)).toBeGreaterThan(0.02)
      expect(rms(3.1, 3.3)).toBeGreaterThan(0.02) // no extra microphone offset introduced at the ripple join
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('plans cleanup on common source times while preserving static narration and silent UI activity', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-demo-plan-'))
    try {
      ff('-f', 'lavfi', '-i', "color=c=white:s=480x270:r=25:d=14,drawbox=x=100:y=100:w=80:h=30:color=black:t=fill:enable='between(t,9,10)'", '-f', 'lavfi', '-i', "sine=f=500:d=14,volume=enable='lt(t,3)+gt(t,5)':volume=0", '-c:v', 'libx264', '-c:a', 'aac', '-shortest', join(dir, 'screen.mp4'))
      ff('-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=25:d=10', '-c:v', 'libx264', join(dir, 'camera.mp4'))
      const media = { 'screen.mp4': await probe(join(dir, 'screen.mp4')), 'camera.mp4': await probe(join(dir, 'camera.mp4')) }
      const p = { dir, media, files: { 'screen.mp4': { kind: 'video' }, 'camera.mp4': { kind: 'video' } } } as unknown as Project
      const t: Transcript = { media: 'screen.mp4', model: 'fixture', createdAt: 0, language: 'en', segments: [{ s: 3, e: 5, text: 'Explain', words: [{ w: 'Explain', s: 3, e: 5 }] }] }
      const plan = await planDemo(p, { screen: 'screen.mp4', camera: 'camera.mp4', manualOffset: 1, cleanup: 'natural' }, async () => t)
      expect(plan.removed).toBeGreaterThan(4)
      expect(plan.cuts.every(c => c.e <= 3 || c.s >= 5)).toBe(true)
      expect(plan.cuts.every(c => c.e <= 9 || c.s >= 10)).toBe(true)
      expect(plan.timeline.demo?.sync.offset).toBe(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
