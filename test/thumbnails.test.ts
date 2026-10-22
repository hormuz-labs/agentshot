import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { FFMPEG } from '../src/main/media'
import { thumbnails } from '../src/main/thumbnails'

let dir: string
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'manul-thumbnails-'))
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=red:s=320x180:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=blue:s=320x180:r=10:d=1', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'video.mp4')])
})
afterAll(async () => { await rm(dir, { recursive: true, force: true }) })

it('extracts different moments in order and reuses the disk cache', async () => {
  const [frames, duplicate] = await Promise.all([thumbnails(dir, 'video.mp4', 2, 2), thumbnails(dir, 'video.mp4', 2, 2)])
  expect(duplicate).toEqual(frames)
  const pixel = (file: string) => [...execFileSync(FFMPEG, ['-loglevel', 'error', '-i', file, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])]
  const first = pixel(frames[0]), last = pixel(frames[1])
  expect(first[0]).toBeGreaterThan(200)
  expect(first[2]).toBeLessThan(40)
  expect(last[0]).toBeLessThan(40)
  expect(last[2]).toBeGreaterThan(200)
  const before = await stat(frames[0])
  expect(await thumbnails(dir, 'video.mp4', 2, 2)).toEqual(frames)
  expect((await stat(frames[0])).mtimeMs).toBe(before.mtimeMs)
})

it('ignores invalid durations and rejects paths outside the project', async () => {
  expect(await thumbnails(dir, 'video.mp4', 0, 8)).toEqual([])
  await expect(thumbnails(dir, '../outside.mp4', 2, 8)).rejects.toThrow('inside the project')
  await expect(thumbnails(dir, join(dir + '-outside', 'video.mp4'), 2, 8)).rejects.toThrow('inside the project')
  await expect(thumbnails(dir, '.', 2, 8)).rejects.toThrow('inside the project')
})

it('samples only the requested zoomed range, aligned to source frames', async () => {
  const frames = await thumbnails(dir, 'video.mp4', 2, 4, 1, 2, 10)
  for (const frame of frames) {
    const pixel = execFileSync(FFMPEG, ['-loglevel', 'error', '-i', frame, '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
    expect(pixel[2]).toBeGreaterThan(200)
    expect(pixel[0]).toBeLessThan(40)
  }
  expect(await thumbnails(dir, 'video.mp4', 2, 4, 2, 1)).toEqual([])
})
