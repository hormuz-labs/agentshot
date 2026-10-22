// Screen-specific local change measurements: camera motion is not a measure of typing or UI activity.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { FFMPEG, probe } from './media'
import { mergeRanges, type TimeRange } from '../shared/demo'

const W = 480, H = 270, FPS = 4, SIZE = W * H
export type ScreenActivity = { duration: number; fps: number; active: TimeRange[]; samples: { t: number; changed: number }[] }

/** Count changed pixels per tile. A blinking caret or one moving pointer should not count as a whole-screen action. */
export function screenChange(before: Uint8Array, after: Uint8Array): number {
  let meaningful = 0
  for (let y = 0; y < H; y += 18) for (let x = 0; x < W; x += 24) {
    let changed = 0
    for (let j = y; j < Math.min(H, y + 18); j++) for (let i = x; i < x + 24; i++) if (Math.abs(before[j * W + i] - after[j * W + i]) > 18) changed++
    if (changed >= 18) meaningful += changed
  }
  return meaningful / SIZE
}

export async function analyzeScreen(project: string, media: string, signal?: AbortSignal): Promise<ScreenActivity> {
  const file = join(project, media), st = await stat(file), info = await probe(file)
  if (!info.width) throw new Error('Screen activity needs a video recording.')
  const dir = join(project, '.cache', 'screen'), cache = join(dir, createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:v1`).digest('hex') + '.json')
  try { return JSON.parse(await readFile(cache, 'utf8')) } catch { /* measure */ }
  const samples: ScreenActivity['samples'] = []
  await new Promise<void>((ok, fail) => {
    const ff = spawn(FFMPEG, ['-v', 'error', '-i', file, '-an', '-vf', `fps=${FPS},scale=${W}:${H}:flags=area,format=gray`, '-f', 'rawvideo', '-'], { signal })
    let pending = Buffer.alloc(0), before: Buffer | undefined, frame = 0, err = ''
    ff.stdout.on('data', (data: Buffer) => {
      pending = Buffer.concat([pending, data])
      while (pending.length >= SIZE) {
        const next = pending.subarray(0, SIZE)
        if (before) samples.push({ t: frame / FPS, changed: screenChange(before, next) })
        before = Buffer.from(next); pending = pending.subarray(SIZE); frame++
      }
    })
    ff.stderr.on('data', d => { err = (err + d).slice(-2000) })
    ff.on('error', fail); ff.on('close', code => code ? fail(new Error(`Screen analysis failed: ${err}`)) : ok())
  })
  const result: ScreenActivity = { duration: info.duration, fps: FPS, samples, active: mergeRanges(samples.filter(s => s.changed >= 0.0007).map(s => ({ s: Math.max(0, s.t - 1 / FPS), e: Math.min(info.duration, s.t + 1 / FPS) })), 0.5) }
  await mkdir(dir, { recursive: true }); await writeFile(cache, JSON.stringify(result))
  return result
}
