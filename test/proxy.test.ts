import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { needsProxy, proxyArgs } from '../src/shared/proxy'
import { FFMPEG, probe } from '../src/main/media'

const info = (o: Partial<{ width: number; height: number; codec: string; bitrate: number; pixfmt: string }>) =>
  ({ duration: 10, width: 1920, height: 1080, fps: 30, hasAudio: true, codec: 'h264', bitrate: 8e6, pixfmt: 'yuv420p', ...o })

describe('preview copies', () => {
  it('light H.264 1080p plays as is', () => expect(needsProxy(info({}))).toBe(false))
  it('4K needs one', () => expect(needsProxy(info({ width: 3840, height: 2160 }))).toMatchObject({ why: 'larger than 1080p' }))
  it('codecs the player can\'t decode smoothly need one', () => {
    expect(needsProxy(info({ codec: 'prores' }))).toMatchObject({ why: 'prores' })
    expect(needsProxy(info({ codec: 'hevc', pixfmt: 'yuv420p10le' }))).toBeTruthy()
    expect(needsProxy(info({ codec: 'dnxhd' }))).toBeTruthy()
  })
  it('very high bitrate needs one', () => expect(needsProxy(info({ bitrate: 80e6 }))).toMatchObject({ why: 'very high bitrate' }))
  it('images and audio never do', () => expect(needsProxy(info({ codec: 'none', width: 0, height: 0 }))).toBe(false))

  it('makes a 720p H.264 copy with frequent keyframes for scrubbing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-proxy-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'big.mp4')])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...proxyArgs('big.mp4', 'proxy.mp4', process.platform)], { cwd: dir })
    const p = await probe(join(dir, 'proxy.mp4'))
    expect(p).toMatchObject({ width: 1280, height: 720, hasAudio: true, codec: 'h264' })
    expect(p.duration).toBeCloseTo(2, 0)
  })
})
