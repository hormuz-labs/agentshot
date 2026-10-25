#!/usr/bin/env node
// Ship the motion gallery: the app carries the catalogue and posters (a few MB); the videos stream from AgentShot's bucket.
// 1. Encode every video for streaming (longest side ≤ 1920, H.264 + AAC, moov first so playback starts at once)
//    into resources/motion-gallery/stream/ (git-ignored).
// 2. With --upload <gs://bucket/prefix>, sync them there with the posters (public; <base>/<id>.mp4, <base>/posters/<id>.jpg;
//    the website uses both).
//
//   node scripts/fetch-motion-gallery.mjs --media                      first: the catalogue, videos and posters
//   node scripts/publish-motion-gallery.mjs                            encode
//   node scripts/publish-motion-gallery.mjs --upload gs://manul-media/gallery
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(import.meta.dirname, '..')
const gallery = join(root, 'resources', 'motion-gallery')
const stream = join(gallery, 'stream')
const FFMPEG = join(root, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const upload = process.argv.includes('--upload') ? process.argv[process.argv.indexOf('--upload') + 1] : null

const entries = JSON.parse(readFileSync(join(gallery, 'catalog.json'), 'utf8')).entries.filter(e => e.video)
mkdirSync(stream, { recursive: true })
let next = 0, done = 0, before = 0, after = 0
const failed = []
await Promise.all(Array.from({ length: Math.max(1, Math.floor(cpus().length / 2)) }, async () => {
  while (next < entries.length) {
    const e = entries[next++]
    const src = join(gallery, e.video), out = join(stream, `${e.id}.mp4`)
    try {
      if (!existsSync(out)) {
        await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', src,
          '-vf', "scale='if(gt(iw,ih),min(1920,iw),-2)':'if(gt(iw,ih),-2,min(1920,ih))',fps='min(60,source_fps)'",
          '-c:v', 'libx264', '-preset', 'fast', '-crf', '24', '-pix_fmt', 'yuv420p', '-profile:v', 'high',
          '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', `${out}.part.mp4`], { timeout: 1_800_000 })
        renameSync(`${out}.part.mp4`, out)
      }
      before += statSync(src).size; after += statSync(out).size
    } catch (err) { failed.push(`${e.id}: ${String(err.stderr || err.message).slice(-200)}`) }
    process.stdout.write(`\r${++done}/${entries.length} encoded`)
  }
}))
console.log(`\n${(before / 1e9).toFixed(2)} GB → ${(after / 1e9).toFixed(2)} GB${failed.length ? `; ${failed.length} failed:\n  ${failed.join('\n  ')}` : ''}`)

if (upload) {
  console.log(`uploading to ${upload}…`)
  await run('gcloud', ['storage', 'rsync', stream, upload, '--recursive', '--exclude=.*\\.part\\.mp4$',
    '--cache-control=public, max-age=31536000, immutable', '--content-type=video/mp4'], { maxBuffer: 64 << 20 })
  await run('gcloud', ['storage', 'rsync', join(gallery, 'posters'), `${upload}/posters`, '--recursive',
    '--cache-control=public, max-age=31536000, immutable', '--content-type=image/jpeg'], { maxBuffer: 64 << 20 })
  console.log('uploaded (videos and posters)')
}
