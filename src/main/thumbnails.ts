// Small, seek-based previews: no full-video decode, and never touch the playback element.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, stat, rename, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { FFMPEG } from './media'
import { isWithinDir } from './paths'

const run = promisify(execFile)
const pending = new Map<string, Promise<string>>()
let workers = 0
const waiting: (() => void)[] = []

// Bound decoding across projects and resize requests, including duplicate requests for the same frame.
async function limited<T>(work: () => Promise<T>): Promise<T> {
  if (workers >= 2) await new Promise<void>(done => waiting.push(done))
  else workers++
  try { return await work() } finally {
    const next = waiting.shift()
    if (next) next()
    else workers--
  }
}

export async function thumbnails(dir: string, src: string, duration: number, count: number, start = 0, end = duration, fps = 0): Promise<string[]> {
  const file = resolve(dir, src)
  if (!isWithinDir(dir, file)) throw new Error('Media must be inside the project.')
  if (!Number.isFinite(duration) || duration <= 0) return []
  if (!Number.isFinite(start) || !Number.isFinite(end)) return []
  start = Math.max(0, Math.min(start, duration))
  end = Math.max(start, Math.min(end, duration))
  if (end <= start) return []
  count = Number.isFinite(count) ? Math.max(1, Math.min(24, Math.round(count))) : 8
  const info = await stat(file)
  const cache = join(dir, '.cache', 'thumbnails')
  await mkdir(cache, { recursive: true })
  return Promise.all(Array.from({ length: count }, async (_, i) => {
    const sample = start + (end - start) * (i + 0.5) / count
    const time = fps > 0 ? Math.floor(sample * fps) / fps : sample
    const key = createHash('sha256').update(`${file}:${info.size}:${info.mtimeMs}:${time}:v2`).digest('hex')
    const out = join(cache, `${key}.jpg`)
    const existing = pending.get(out)
    if (existing) return existing
    const task = limited(async () => {
      if (await stat(out).then(s => s.size > 0, () => false)) return out
      const temp = join(cache, `${key}.tmp.jpg`)
      try {
        // Round down at microsecond precision so a 60 fps frame boundary is never sought past.
        await run(FFMPEG, ['-y', '-loglevel', 'error', '-threads', '1', '-ss', (Math.floor(time * 1e6) / 1e6).toFixed(6), '-i', file,
          '-frames:v', '1', '-an', '-vf', 'scale=192:108:force_original_aspect_ratio=decrease,pad=192:108:(ow-iw)/2:(oh-ih)/2',
          '-threads', '1', '-q:v', '4', temp], { timeout: 30_000 })
        await rename(temp, out)
        return out
      } finally { await rm(temp, { force: true }).catch(() => {}) }
    })
    pending.set(out, task)
    try { return await task } finally { pending.delete(out) }
  }))
}
