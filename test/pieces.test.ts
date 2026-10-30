// Rendering a film in pieces: a change encodes only the pieces it touches, and the film comes out as long and whole as
// one rendered at a go.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))
import { SOFTWARE, encodersFor } from '../src/shared/encoders'
import { chooseFrames, piecesOf, renderPieces } from '../src/main/pieces'
import { FFMPEG, FFPROBE } from '../src/main/media'
import { cameraLayout } from '../src/shared/demo'
import { composeArgs, type Item, type Timeline } from '../src/shared/timeline'

const media = (src: string, a: number, b: number, id = 'x'): Item => ({ id, kind: 'media', src, in: a, out: b })
const format = { width: 320, height: 180, fps: 30 }

describe('cutting a film into pieces', () => {
  it('splits long scenes on their source clock, so a piece stays the same when the scene is trimmed', () => {
    const spans = (a: number, b: number) => piecesOf({ ...format, items: [media('a.mp4', a, b)] }).map(p => [(p.item as { in: number }).in, (p.item as { out: number }).out])
    expect(spans(0, 45)).toEqual([[0, 20], [20, 45]])
    expect(spans(3, 65)).toEqual([[3, 20], [20, 40], [40, 65]])
    expect(spans(0, 10)).toEqual([[0, 10]])
  })

  it('times an overlay from each piece it falls on', () => {
    const tl: Timeline = { ...format, items: [media('a.mp4', 0, 5), media('a.mp4', 10, 15)], overlays: [{ id: 'o', clip: 'c', start: 4, dur: 2 }] }
    expect(piecesOf(tl).map(p => p.overlays.map(o => o.start))).toEqual([[4], [-1]])
  })

  it('takes a piece a frame off when that saves encoding it, and stays within a frame of the clock', () => {
    expect(chooseFrames([30, 60, 90], () => false)).toEqual([30, 30, 30])
    const kept = (_: number, f: number) => f === 31
    expect(chooseFrames([30, 60, 90], kept)).toEqual([31, 29, 30]) // and the film still ends on its frame
  })
})

describe('encoders', () => {
  it('always ends on the one that works everywhere', () => {
    for (const p of ['darwin', 'win32', 'linux']) expect(encodersFor(p).at(-1)).toBe(SOFTWARE)
  })
})

describe('rendering in pieces', () => {
  let dir: string, cache: string
  const ff = (...a: string[]) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...a], { cwd: dir })
  const seconds = (f: string, stream: string) => Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', stream, '-count_frames', '-show_entries', 'stream=duration', '-of', 'csv=p=0', join(dir, f)]).toString().split('\n')[0])
  const frames = (f: string) => Number(execFileSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', join(dir, f)]).toString().trim())
  const render = (tl: Timeline, out: string) => renderPieces({ ffmpeg: FFMPEG, cwd: dir, cache, tl, out, encoder: SOFTWARE, inputOf: i => (i as { src: string }).src, hasAudio: () => true, overlayOf: () => 'ov.mov' })
  const kept = () => readdirSync(cache).filter(f => !f.startsWith('.')).length

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'pieces-'))
    cache = join(dir, 'cache')
    ff('-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=30', '-f', 'lavfi', '-i', 'sine=f=440:d=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', 'a.mp4')
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('matches a film rendered at a go, and a change encodes only the piece it touches', async () => {
    const tl: Timeline = { ...format, items: [media('a.mp4', 1, 4), media('a.mp4', 6.013, 9.2), media('a.mp4', 12, 14)] }
    expect(await render(tl, 'one.mp4')).toBe(0)
    expect(kept()).toBe(3)
    ff(...composeArgs(tl, { inputOf: i => (i as { src: string }).src, hasAudio: () => true, out: 'full.mp4' }))
    expect(Math.abs(frames('one.mp4') - frames('full.mp4'))).toBeLessThanOrEqual(1)
    expect(seconds('one.mp4', 'a:0')).toBeCloseTo(seconds('full.mp4', 'a:0'), 1)

    const same = await render(tl, 'same.mp4')
    expect(same).toBe(1)
    expect(kept()).toBe(3)

    // the middle scene trimmed: the others are kept although the last one moved earlier
    const trimmed: Timeline = { ...tl, items: [tl.items[0], media('a.mp4', 6.013, 8), tl.items[2]] }
    const reused = await render(trimmed, 'two.mp4')
    expect(reused).toBeGreaterThan(0.5)
    expect(kept()).toBe(4)
    expect(Math.abs(frames('two.mp4') - Math.round((3 + 1.987 + 2) * 30))).toBeLessThanOrEqual(1)
    // whole: every frame decodes, the joins included
    expect(execFileSync(FFMPEG, ['-v', 'error', '-i', join(dir, 'two.mp4'), '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString()).toBe('')
  }, 60_000)

  it('frames a camera in its circle and ring just as a film rendered at a go', async () => {
    ff('-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=30', '-f', 'lavfi', '-i', 'sine=f=880:d=30', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', 'camera.mp4')
    const tl: Timeline = {
      ...format, items: [media('a.mp4', 1, 4), media('a.mp4', 12, 15)],
      demo: { screen: 'a.mp4', camera: 'camera.mp4', cameraDuration: 30, audio: 'screen', layout: cameraLayout(320, 180, { shape: 'circle', width: 100, height: 100, x: 200, y: 60, border: 4 }),
        sync: { offset: 0, rate: 1, confidence: 1, reliable: true, residual: 0, anchors: [], overlap: [0, 30], method: 'fixture' } } as Timeline['demo'],
    }
    await render(tl, 'cam.mp4')
    ff(...composeArgs(tl, { inputOf: i => (i as { src: string }).src, hasAudio: () => true, out: 'camfull.mp4' }))
    const score = execFileSync('sh', ['-c', `"${FFMPEG}" -hide_banner -i cam.mp4 -i camfull.mp4 -lavfi ssim -f null - 2>&1 | grep -o 'All:[0-9.]*'`], { cwd: dir, encoding: 'utf8' })
    expect(Number(score.split(':')[1])).toBeGreaterThan(0.97)
  }, 60_000)

  it('carries an overlay that crosses two scenes', async () => {
    ff('-f', 'lavfi', '-i', 'color=red@0.5:s=320x180:r=30:d=3,format=yuva444p', '-c:v', 'qtrle', '-pix_fmt', 'argb', 'ov.mov')
    const tl: Timeline = { ...format, items: [media('a.mp4', 20, 22), media('a.mp4', 24, 26)], overlays: [{ id: 'o', clip: 'c', start: 1, dur: 2 }] }
    await render(tl, 'over.mp4')
    const red = (at: string) => Number(/(\d+)/.exec(execFileSync(FFMPEG, ['-v', 'error', '-ss', at, '-i', join(dir, 'over.mp4'), '-frames:v', '1', '-vf', 'crop=8:8:300:170,scale=1:1,format=gbrp', '-f', 'rawvideo', '-'], { encoding: 'latin1' }).charCodeAt(2).toString())![1])
    expect(red('1.5')).toBeGreaterThan(red('0.5') - 1)
    expect(frames('over.mp4')).toBe(120)
  }, 60_000)
})
