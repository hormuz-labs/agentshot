// Rendering a film in pieces. Every scene (and every 20 s of a long one, counted on its source) is encoded on its own and
// kept, named after all that goes into it, so a note on one scene encodes that scene: the rest of the film is joined as it
// is, whatever moved around it. The first render of a film pays for all its pieces, several at a time.
import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { composeArgs, duration, length, type Item, type Overlay, type Timeline } from '../shared/timeline'
import type { Encoder } from '../shared/encoders'
import { pool } from './cuts'

const CHUNK = 20, LIMIT = 8e9

export type Piece = { item: Item; start: number; end: number; overlays: Overlay[] }

/** The film cut into pieces, each with the overlays on it (timed from the piece's own start). */
export function piecesOf(tl: Timeline): Piece[] {
  const out: Piece[] = []
  let at = 0
  for (const item of tl.items) {
    const spans: [number, number][] = []
    if (item.kind === 'media') {
      let a = item.in
      for (let m = (Math.floor(item.in / CHUNK) + 1) * CHUNK; m < item.out - CHUNK / 4; m += CHUNK) { spans.push([a, m]); a = m }
      spans.push([a, item.out])
    }
    if (item.kind === 'clip') out.push(place(tl, item, at, at + item.dur))
    else for (const [a, b] of spans) out.push(place(tl, { ...item, in: a, out: b }, at + a - item.in, at + b - item.in))
    at += length(item)
  }
  return out
}

const place = (tl: Timeline, item: Item, start: number, end: number): Piece => ({
  item, start, end,
  overlays: (tl.overlays || []).filter(o => o.start < end && o.start + o.dur > start).map(o => ({ ...o, id: '', start: o.start - start })),
})

/** The piece as a timeline of its own, with only what it needs: a name for it must not change with the rest of the film. */
const pieceTimeline = (tl: Timeline, p: Piece): Timeline => ({
  width: tl.width, height: tl.height, fps: tl.fps, items: [{ ...p.item, id: '' }], overlays: p.overlays,
  ...(tl.demo && p.item.kind === 'media' && p.item.src === tl.demo.screen ? { demo: tl.demo } : {}),
})

export type RenderPieces = {
  ffmpeg: string; cwd: string; cache: string; tl: Timeline; out: string; encoder: Encoder
  inputOf(i: Item): string; hasAudio(i: Item): boolean; overlayOf(o: Overlay): string
  progress?(f: number): void; signal?: AbortSignal
}

const run = (ffmpeg: string, args: string[], cwd: string, signal?: AbortSignal) => new Promise<void>((ok, fail) =>
  execFile(ffmpeg, ['-y', '-loglevel', 'error', ...args], { cwd, signal, maxBuffer: 1 << 24, windowsHide: true }, (e, _o, stderr) => (e ? fail(new Error(stderr.slice(-1500) || e.message)) : ok())))

/** What a file's content is, as far as a name goes. */
const stamp = async (cwd: string, rel: string) => { const s = await stat(join(cwd, rel)); return [rel, s.size, s.mtimeMs] }

/**
 * Pieces land on whole frames. A piece's frame count follows the film's clock, which a cut earlier on can shift by a frame,
 * and shouldn't cost every piece after it: a kept piece a frame longer or shorter is used as long as the film stays within
 * a frame of its clock (the sound is never moved). The last piece lands exactly.
 */
export function chooseFrames(ends: number[], kept: (i: number, frames: number) => boolean): number[] {
  let at = 0
  return ends.map((end, i) => {
    const exact = end - at
    const options = i === ends.length - 1 ? [exact] : [exact, exact - 1, exact + 1]
    const frames = options.find(f => f > 0 && kept(i, f)) ?? Math.max(exact, 0)
    at += frames
    return frames
  })
}

/** Render the film into o.out. Returns the share of its frames that were already there. */
export async function renderPieces(o: RenderPieces) {
  const { tl, cwd, cache, encoder, signal } = o
  await mkdir(cache, { recursive: true })
  const pieces = piecesOf(tl)
  const made = new Set(await readdir(cache))
  const bases = await Promise.all(pieces.map(async p => {
    const own = pieceTimeline(tl, p), files = [o.inputOf(p.item), ...p.overlays.map(o.overlayOf), ...(own.demo ? [own.demo.camera] : [])]
    const parts = [own, await Promise.all(files.map(f => stamp(cwd, f))), encoder.name, encoder.flags]
    return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
  }))
  const nameOf = (i: number, frames: number) => `${bases[i]}-${frames}.mp4`
  const frames = chooseFrames(pieces.map(p => Math.round(p.end * tl.fps)), (i, f) => made.has(nameOf(i, f)))

  const wanted = pieces.map((_, i) => i).filter(i => frames[i] > 0)
  const todo = wanted.filter(i => !made.has(nameOf(i, frames[i])))
  const total = wanted.reduce((s, i) => s + frames[i], 0) || 1
  const fresh = todo.reduce((s, i) => s + frames[i], 0)
  let done = 0
  const step = (n: number) => { done += n; o.progress?.(Math.min(0.95, done / (fresh + total / 10))) }
  o.progress?.(0)
  await pool(todo.map(i => async () => {
    const name = nameOf(i, frames[i]), temp = join(cache, `.${randomUUID()}.mp4`)
    try {
      await run(o.ffmpeg, composeArgs(pieceTimeline(tl, pieces[i]), { ...o, out: temp, video: encoder.flags, piece: { frames: frames[i] } }), cwd, signal)
      await rename(temp, join(cache, name))
    } finally { await rm(temp, { force: true }) }
    step(frames[i])
  }), encoder.parallel)

  // the sound whole (it doesn't take long, and music and fades know nothing of pieces), then everything joined
  const tag = randomUUID(), sound = join(cache, `.${tag}.m4a`), list = join(cache, `.${tag}.txt`)
  try {
    await run(o.ffmpeg, composeArgs(tl, { ...o, out: sound, soundOnly: true }), cwd, signal)
    await writeFile(list, ['ffconcat version 1.0', ...wanted.map(i => `file ${nameOf(i, frames[i])}`)].join('\n') + '\n')
    await run(o.ffmpeg, ['-f', 'concat', '-safe', '0', '-i', list, '-i', sound, '-map', '0:v', '-map', '1:a', '-c', 'copy', '-t', String(duration(tl)), '-movflags', '+faststart', o.out], cwd, signal)
  } finally { await Promise.all([rm(sound, { force: true }), rm(list, { force: true })]) }

  const now = new Date()
  await Promise.all(wanted.map(i => utimes(join(cache, nameOf(i, frames[i])), now, now)))
  await trim(cache)
  return 1 - fresh / total
}

/** Pieces are only worth keeping while there's room: the ones used longest ago go first. */
async function trim(cache: string) {
  const files = await Promise.all((await readdir(cache)).filter(f => !f.startsWith('.')).map(async f => ({ f, ...(await stat(join(cache, f))) })))
  let size = files.reduce((s, x) => s + x.size, 0)
  for (const x of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (size <= LIMIT) break
    await rm(join(cache, x.f), { force: true })
    size -= x.size
  }
}
