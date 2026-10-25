import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { framing, placedVideo } from '../src/shared/framing'
import { applyEdit, composeArgs, fromMedia, sameCut } from '../src/shared/timeline'
import { cameraLayout, fullSourceLayout } from '../src/shared/demo'
import { exportArgs } from '../src/shared/export'
import { FFMPEG, probe } from '../src/main/media'

describe('independent viewport and source framing', () => {
  it('fits/fills, zooms and moves the source independently from the viewport', () => {
    expect(placedVideo(400, 200, 100, 100, framing({}, 'cover'))).toEqual({ width: 200, height: 100, left: -50, top: 0 })
    expect(placedVideo(400, 200, 100, 100, framing({ zoom: 0.5, y: -0.1 }, 'cover'))).toEqual({ width: 100, height: 50, left: 0, top: 15 })
    const base = fromMedia('a.mp4', 5, { width: 320, height: 180, fps: 25 })
    const moved = applyEdit(base, { op: 'frame', ids: [base.items[0].id], framing: { x: 0.1, zoom: 0.8 } })
    expect(sameCut(base, moved)).toBe(false)
    expect(sameCut(base, applyEdit(moved, { op: 'frame', ids: [base.items[0].id], framing: null }))).toBe(true)
  })
  it('reveals a previously cropped portrait without changing the existing visible framing', () => {
    const l = cameraLayout(1920, 1080, { width: 384, shape: 'circle', crop: { x: 0, y: 0.25, w: 1, h: 0.56 } })
    const full = fullSourceLayout(l, 576, 1024)
    expect(full.crop).toBeNull()
    const old = placedVideo(576, 1024 * 0.56, l.width, l.height, framing({}, 'cover'))
    const now = placedVideo(576, 1024, l.width, l.height, full.framing!)
    expect(now.width).toBeCloseTo(old.width, 4)
    expect(now.top + 1024 * 0.25 * (now.width / 576)).toBeCloseTo(old.top, 4)
    expect(now.height / now.width).toBeCloseTo(1024 / 576, 4)
  })
  it('exports original-size output without another quality-reducing encode', () => {
    const args = exportArgs({ preset: 'original', input: 'final.mp4', out: 'export.mp4', source: { width: 3840, height: 2160 } })
    expect(args).toContain('copy')
    expect(args).not.toContain('-crf')
  })
  it('renders source position inside a circle and regular video position with exact duration', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-framing-'))
    const ff = (...args: string[]) => execFileSync(FFMPEG, ['-y', '-v', 'error', ...args])
    try {
      ff('-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=25:d=2', '-c:v', 'libx264', join(dir, 'screen.mp4'))
      ff('-f', 'lavfi', '-i', 'color=c=red:s=160x120:r=25:d=2,drawbox=x=0:y=60:w=160:h=60:color=lime:t=fill', '-c:v', 'libx264', join(dir, 'camera.mp4'))
      let tl = { ...fromMedia('screen.mp4', 2, { width: 320, height: 180, fps: 25 }), demo: { screen: 'screen.mp4', camera: 'camera.mp4', cameraDuration: 2, audio: 'screen' as const,
        sync: { offset: 0, rate: 1, confidence: 1, reliable: true, anchors: [], residual: 0, overlap: [0, 2] as [number, number], method: 'fixture' },
        layout: cameraLayout(320, 180, { shape: 'circle', width: 80, x: 220, y: 20, border: 0, framing: framing({ y: -0.25 }, 'cover') }) } }
      tl = applyEdit(tl, { op: 'frame', ids: [tl.items[0].id], framing: { zoom: 0.5, x: -0.1 } }) as typeof tl
      ff(...composeArgs(tl, { inputOf: () => 'screen.mp4', hasAudio: () => false, out: 'out.mp4' }).map(s => ['screen.mp4', 'camera.mp4', 'out.mp4'].includes(s) ? join(dir, s) : s))
      const px = (x: number, y: number) => [...ff('-ss', '1', '-i', join(dir, 'out.mp4'), '-frames:v', '1', '-vf', `format=rgb24,crop=1:1:${x}:${y}`, '-f', 'rawvideo', '-')]
      expect(px(260, 60)[1]).toBeGreaterThan(180) // green bottom half moved to centre of fixed circle
      expect(px(260, 90).every(v => v < 40)).toBe(true) // moved source leaves black inside mask
      expect(px(10, 10).every(v => v < 40)).toBe(true) // normal video reduced on canvas
      expect(px(100, 90)[2]).toBeGreaterThan(180)
      expect((await probe(join(dir, 'out.mp4'))).duration).toBeCloseTo(2, 1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
