// Saving an edit that only cuts one file, fast. When the film is pieces of one H.264 file in its own size and frame
// rate (no motion clips, no overlays), most of the picture doesn't need encoding again: from one of the file's
// keyframes to another it is copied as it is, and only the frames between a cut and the next keyframe are encoded
// ("smart render"). The sound is made again in full, as composeArgs makes it (each piece's level, fades at cuts),
// which is quick. A few cuts in a long film take seconds instead of an encode of the whole film; anything else is
// rendered in full (composeArgs).
import { execFile } from 'node:child_process'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { soundOf, type MediaItem, type Timeline } from '../shared/timeline'

/** A video packet as ffprobe lists it (times in ticks of the stream's time base), in the file's (decode) order. */
export type Packet = { pts: number; dts: number; duration: number; pos: number; size: number; key: boolean; discard: boolean }

/** A file's picture, frame by frame: what a plan needs. */
export type Frames = {
  /** seconds per tick */
  tick: number
  /** the file's start (s): times are counted from here, as ffmpeg and the timeline count them */
  start: number
  /** every frame's time stamp (ticks), in the order they show */
  pts: number[]
  /** the stamp just after the last frame */
  end: number
  /** frames the file can be copied from: an IDR picture nothing after refers back past, nothing before needs (0 = first) */
  splits: number[]
}

/** Frames [from, to) of the file: copied as they are, or encoded again. */
export type Run = { from: number; to: number; copy: boolean }

/**
 * Index the frames and find where the file can be split cleanly: a key packet that is an IDR picture (idr) and shows
 * after everything before it in the file and before everything after it (no frame on the other side of it in either
 * direction, i.e. a closed GOP). Its place in the file is then also its place in showing order. A string says why the
 * file can't be cut this way. (Decode times aren't needed: Matroska doesn't keep them.)
 */
export function indexFrames(pk: Packet[], o: { tick: number; start: number; idr(i: number): boolean }): Frames | string {
  if (!pk.length) return 'no picture'
  if (pk.some(p => !Number.isFinite(p.pts) || p.discard)) return 'frames without times, or hidden ones'
  const n = pk.length
  const later = new Float64Array(n + 1)
  later[n] = Infinity
  for (let i = n - 1; i >= 0; i--) later[i] = Math.min(pk[i].pts, later[i + 1])
  const splits: number[] = []
  let earlier = -Infinity
  for (let i = 0; i < n; i++) {
    const p = pk[i]
    if (p.key && p.pts > earlier && later[i] === p.pts && o.idr(i)) splits.push(i)
    earlier = Math.max(earlier, p.pts)
  }
  const pts = pk.map(p => p.pts).sort((a, b) => a - b)
  for (let i = 1; i < n; i++) if (pts[i] === pts[i - 1]) return 'two frames at one time'
  const last = pk.reduce((m, p) => (p.pts > m.pts ? p : m))
  const end = last.pts + (last.duration > 0 ? last.duration : n > 1 ? pts[n - 1] - pts[n - 2] : 1)
  return { tick: o.tick, start: o.start, pts, end, splits }
}

/** The time (s, from the file's start) frame i shows at; n is just after the last. */
export const timeOf = (f: Frames, i: number) => (i < f.pts.length ? f.pts[i] : f.end) * f.tick - f.start

/** The frames [from, to) of seconds a..b: those showing from a (half a millisecond of rounding allowed) until b. */
export function framesIn(f: Frames, a: number, b: number): [number, number] {
  const first = (t: number) => {
    let lo = 0, hi = f.pts.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (timeOf(f, mid) < t - 5e-4) lo = mid + 1; else hi = mid }
    return lo
  }
  const from = first(a)
  return [from, Math.max(from, first(b))]
}

/**
 * What to copy and what to encode, for stretches of the file in the order they play (frames [from, to)). Stretches
 * that follow on in the file are one; in each, the frames from its first split to its last (or the file's end) are
 * copied, the rest encoded; a stretch with no two splits in it is encoded whole.
 */
export function planRuns(spans: [number, number][], splits: number[], n: number): Run[] {
  const merged: [number, number][] = []
  for (const [a, b] of spans) {
    if (b <= a) continue
    const prev = merged[merged.length - 1]
    if (prev && prev[1] === a) prev[1] = b
    else merged.push([a, b])
  }
  const at = [...new Set([...splits, n])].sort((x, y) => x - y)
  const runs: Run[] = []
  const add = (from: number, to: number, copy: boolean) => { if (to > from) runs.push({ from, to, copy }) }
  for (const [a, b] of merged) {
    const kA = at.find(s => s >= a)
    const kB = at.findLast(s => s <= b)
    if (kA === undefined || kB === undefined || kB <= kA) { add(a, b, false); continue }
    add(a, kA, false)
    add(kA, kB, true)
    add(kB, b, false)
  }
  return runs
}

/** The one file a timeline cuts, if that's all it does (no motion clips, no overlays). */
export function cutSource(tl: Timeline): string | undefined {
  if (tl.demo || tl.overlays?.length || !tl.items.length || tl.items.some(i => i.kind === 'media' && i.framing)) return
  const srcs = new Set(tl.items.map(i => (i.kind === 'media' ? i.src : '')))
  return srcs.size === 1 && !srcs.has('') ? [...srcs][0] : undefined
}

type Stream = Record<string, unknown> & { side_data_list?: { rotation?: number }[] }
const PROFILES: Record<string, string> = { Baseline: 'baseline', 'Constrained Baseline': 'baseline', Main: 'main', High: 'high', 'Progressive High': 'high', 'Constrained High': 'high' }

/** Why this picture can't be cut by copying for this timeline (undefined: it can). */
export function unfit(v: Stream, format: string, tl: Timeline): string | undefined {
  if (v.codec_name !== 'h264') return `${v.codec_name} picture`
  if (v.pix_fmt !== 'yuv420p') return `${v.pix_fmt} pixels`
  if (!PROFILES[String(v.profile)]) return `H.264 ${v.profile}`
  if (v.field_order && !['progressive', 'unknown'].includes(String(v.field_order))) return 'interlaced'
  if (v.side_data_list?.some(d => d.rotation)) return 'rotated'
  if (!/mp4|mov|matroska/.test(format)) return `${format} file`
  if (v.width !== tl.width || v.height !== tl.height) return 'a different size'
  const [num, den] = String(v.avg_frame_rate).split('/').map(Number)
  if (!den || Math.abs(Math.round((num / den) * 100) / 100 - tl.fps) > 0.011) return 'a different frame rate'
  return undefined
}

const run = (bin: string, args: string[], cwd: string) => new Promise<string>((ok, fail) =>
  execFile(bin, args, { cwd, maxBuffer: 1 << 28 }, (err, stdout, stderr) => (err ? fail(new Error(stderr.slice(-1500) || err.message)) : ok(stdout))))

export function parsePackets(csv: string): Packet[] {
  return csv.split('\n').filter(Boolean).map(line => {
    const f = Object.fromEntries(line.split('|').map(kv => kv.split('=') as [string, string]))
    const num = (k: string) => (f[k] === undefined || f[k] === 'N/A' ? NaN : Number(f[k]))
    return { pts: num('pts'), dts: num('dts'), duration: num('duration'), pos: num('pos'), size: num('size'), key: f.flags?.[0] === 'K', discard: f.flags?.[1] === 'D' }
  })
}

/** avcC's NAL length size, from ffprobe's hex dump of the stream's extradata (0: not avcC). */
export function nalLengthSize(dump: string) {
  const hex = dump.split('\n').map(l => l.slice(10, 50).replace(/\s/g, '')).join('')
  return hex.startsWith('01') && hex.length >= 10 ? (parseInt(hex.slice(8, 10), 16) & 3) + 1 : 0
}

/**
 * Which key packets hold an IDR picture, read from the file. A packet's NAL units must add up to its size exactly, from
 * where its data starts (Matroska's position is its block's, a few bytes before; found on the first key packet).
 */
async function idrPackets(file: string, pk: Packet[], lengthSize: number) {
  const idr = new Set<number>()
  const fh = await open(file, 'r')
  const head = Buffer.alloc(lengthSize + 1)
  const types = async (from: number, size: number) => {
    const out: number[] = []
    let at = from
    while (at < from + size) {
      if (at + head.length > from + size || (await fh.read(head, 0, head.length, at)).bytesRead < head.length) return null
      let len = 0
      for (let k = 0; k < lengthSize; k++) len = len * 256 + head[k]
      if (!len || head[lengthSize] & 0x80) return null
      out.push(head[lengthSize] & 0x1f)
      at += lengthSize + len
    }
    return at === from + size ? out : null
  }
  try {
    const keys = pk.flatMap((p, i) => (p.key && p.pos >= 0 && p.size > 0 ? [i] : []))
    let skip = -1
    for (let k = 0; k <= 16 && skip < 0 && keys.length; k++) if (await types(pk[keys[0]].pos + k, pk[keys[0]].size)) skip = k
    if (skip >= 0) for (const i of keys) if ((await types(pk[i].pos + skip, pk[i].size))?.includes(5)) idr.add(i)
  } finally {
    await fh.close()
  }
  return idr
}

/**
 * Why a joined picture isn't right: not the frames planned, or decode times that don't move on by about a frame each
 * time (going back, or nudged forward a tick at a time by ffmpeg where a join made them go back).
 */
export function badJoin(pk: Packet[], frames: number): string | undefined {
  if (pk.length !== frames) return `${pk.length} frames, not ${frames}`
  const pts = pk.map(p => p.pts).sort((a, b) => a - b)
  if (new Set(pts).size !== frames) return 'two frames at one time'
  const frame = Math.min(...pts.slice(1).map((t, i) => t - pts[i]))
  for (let i = 1; i < pk.length; i++) if (!(pk[i].dts - pk[i - 1].dts >= frame / 2)) return `decode times out of step at frame ${i}`
  return undefined
}

/** Run tasks, k at a time; after a failure no more start, and it throws once the running ones have finished. */
async function pool(tasks: (() => Promise<unknown>)[], k: number) {
  let next = 0
  const failed: unknown[] = []
  await Promise.all(Array.from({ length: Math.min(k, tasks.length) }, async () => {
    while (next < tasks.length && !failed.length) { const i = next++; await tasks[i]().catch(e => failed.push(e)) }
  }))
  if (failed.length) throw failed[0]
}

export type CutRender = { ffmpeg: string; ffprobe: string; cwd: string; tl: Timeline; out: string; progress?(f: number): void }
export type CutResult = { ok: true; copied: number } | { ok: false; why: string }

/**
 * Render tl into out (paths relative to cwd, the project folder) by copying most of the picture of its one file.
 * { ok: false } says why it can't (render it in full instead); a failure on the way throws.
 */
export async function renderCuts(o: CutRender): Promise<CutResult> {
  const src = cutSource(o.tl)
  if (!src) return { ok: false, why: 'not just cuts of one file' }
  const file = join(o.cwd, src)
  const probe = JSON.parse(await run(o.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_data', '-of', 'json', file], o.cwd)) as { streams: Stream[]; format: { format_name: string; start_time?: string } }
  // the picture (not a cover image), as ffmpeg's -map 0:v:<k> counts it
  const videos = probe.streams.filter(s => s.codec_type === 'video')
  const v = videos.find(s => !(s.disposition as Record<string, number> | undefined)?.attached_pic)
  if (!v) return { ok: false, why: 'no picture' }
  const pick = `v:${videos.indexOf(v)}`
  const why = unfit(v, probe.format.format_name, o.tl)
  if (why) return { ok: false, why }
  const lengthSize = nalLengthSize(String(v.extradata || ''))
  if (!lengthSize) return { ok: false, why: 'H.264 without avcC' }
  const [tbNum, tbDen] = String(v.time_base).split('/').map(Number)
  const pk = parsePackets(await run(o.ffprobe, ['-v', 'error', '-select_streams', pick, '-show_entries', 'packet=pts,dts,duration,size,pos,flags', '-of', 'compact=p=0', file], o.cwd))
  const idr = await idrPackets(file, pk, lengthSize)
  const f = indexFrames(pk, { tick: tbNum / tbDen, start: Number(probe.format.start_time) || 0, idr: i => idr.has(i) })
  if (typeof f === 'string') return { ok: false, why: f }
  o.progress?.(0.05)

  const n = f.pts.length
  const pieces = (o.tl.items as MediaItem[]).map(it => ({ it, span: framesIn(f, it.in, it.out) })).filter(p => p.span[1] > p.span[0])
  if (!pieces.length) return { ok: false, why: 'nothing to show' }
  const runs = planRuns(pieces.map(p => p.span), f.splits, n)
  const total = runs.reduce((s, r) => s + r.to - r.from, 0)
  const copied = runs.reduce((s, r) => s + (r.copy ? r.to - r.from : 0), 0)
  if (copied < total / 4) return { ok: false, why: `little to copy (${Math.round((100 * copied) / total)}%)` }

  const tmp = join(o.cwd, 'renders', `.cut-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`)
  await mkdir(tmp, { recursive: true })
  try {
    let done = 0.05
    const step = (w: number) => { done += w; o.progress?.(Math.min(0.95, done)) }
    // the copied stretches: the picture split at their ends, in one pass (only as far as the last one)
    const bounds = [...new Set(runs.filter(r => r.copy).flatMap(r => [r.from, r.to]))].filter(b => b > 0 && b < n).sort((x, y) => x - y)
    const last = Math.max(...runs.filter(r => r.copy).map(r => r.to))
    const edges = [0, ...bounds, n]
    const copyPass = () => run(o.ffmpeg, ['-y', '-loglevel', 'error', '-i', file, '-map', `0:${pick}`, '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1',
      ...(last < n ? ['-frames:v', String(last)] : []),
      '-f', 'segment', '-segment_format', 'mp4', ...(bounds.length ? ['-segment_frames', bounds.join(',')] : []),
      '-reset_timestamps', '1', '-avoid_negative_ts', 'disabled', join(tmp, 'copy%05d.mp4')], o.cwd).then(() => step(0.15))

    // the encoded stretches: decoded from the split before, frame-exact, in the file's own form, without B-frames
    // and decoding as far ahead as the copied stretches (delay: so every packet's decode time follows the one before)
    const level = Number(v.level)
    const colors = ([['color_primaries', 'color_primaries'], ['color_transfer', 'color_trc'], ['color_space', 'colorspace'], ['color_range', 'color_range']] as const)
      .flatMap(([k, opt]) => (v[k] && v[k] !== 'unknown' ? [`-${opt}`, String(v[k])] : []))
    const encodes = runs.filter(r => !r.copy)
    const encodedFrames = encodes.reduce((s, r) => s + r.to - r.from, 0) || 1
    const encode = (delay: number) => (r: Run, k: number) => () => {
      const from = f.splits.findLast(s => s <= r.from)
      const seek = from ? timeOf(f, from) + 1e-4 : 0
      return run(o.ffmpeg, ['-y', '-loglevel', 'error', '-copyts', '-noaccurate_seek', ...(seek > 0 ? ['-ss', seek.toFixed(6)] : []), '-i', file,
        '-map', `0:${pick}`, '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `trim=start_pts=${f.pts[r.from]}:end_pts=${r.to < n ? f.pts[r.to] : f.end},setpts=PTS-STARTPTS`, '-frames:v', String(r.to - r.from),
        '-fps_mode', 'passthrough', '-enc_time_base', `${tbNum}:${tbDen}`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-bf', '0', '-profile:v', PROFILES[String(v.profile)],
        ...(level >= 10 ? ['-level:v', `${Math.floor(level / 10)}.${level % 10}`] : []), '-pix_fmt', 'yuv420p', ...colors,
        ...(delay > 0 ? ['-bsf:v', `setts=dts=DTS-${delay}`] : []), join(tmp, `encode${String(k).padStart(5, '0')}.mp4`)], o.cwd)
        .then(() => step((0.55 * (r.to - r.from)) / encodedFrames))
    }

    // the sound, from the same frames (so it stays with the picture whatever the cuts)
    const hasAudio = probe.streams.some(s => s.codec_type === 'audio')
    const sound = join(tmp, 'sound.m4a')
    const aac = ['-c:a', process.platform === 'darwin' ? 'aac_at' : 'aac', '-b:a', '192k']
    const seconds = (r: [number, number]) => [timeOf(f, r[0]), timeOf(f, r[1])] as const
    const length = pieces.reduce((s, p) => { const [a, b] = seconds(p.span); return s + b - a }, 0)
    const audio = () => run(o.ffmpeg, hasAudio
      ? ['-y', '-loglevel', 'error', '-i', file, '-vn', '-filter_complex',
        [...pieces.map((p, k) => soundOf(0, p.it, ...seconds(p.span), o.tl.items.length > 1, `a${k}`)), `${pieces.map((_, k) => `[a${k}]`).join('')}concat=n=${pieces.length}:v=0:a=1[a]`].join(';'),
        '-map', '[a]', ...aac, sound]
      : ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', length.toFixed(6), ...aac, sound], o.cwd).then(() => step(0.15))

    // the sound alongside; the encoding after the copying, which tells how far ahead its decoding runs (in seconds: a
    // copied stretch from Matroska is in its own time base). Everything finishes before the folder is cleared.
    const picture = async () => {
      await copyPass()
      const first = edges.findIndex(b => b === runs.find(r => r.copy)!.from)
      const [pts, dts] = (await run(o.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-read_intervals', '%+#1', '-show_entries', 'packet=pts_time,dts_time', '-of', 'csv=p=0',
        join(tmp, `copy${String(first).padStart(5, '0')}.mp4`)], o.cwd)).trim().split(',').map(Number)
      await pool(encodes.map(encode(Math.round((pts - dts) / f.tick) || 0)), 3)
    }
    const failed = (await Promise.allSettled([audio(), picture()])).find(r => r.status === 'rejected')
    if (failed) throw failed.reason

    // join them in order; each part's length is set so the joins land on the frame times exactly
    const list = ['ffconcat version 1.0']
    let at = 0, e = 0
    const us = (ticks: number) => Math.round(ticks * f.tick * 1e6)
    const part = (name: string, from: number, to: number) => {
      const len = (to < n ? f.pts[to] : f.end) - (from < n ? f.pts[from] : f.end)
      list.push(`file ${name}`, `duration ${((us(at + len) - us(at)) / 1e6).toFixed(6)}`)
      at += len
    }
    for (const r of runs) {
      if (!r.copy) { part(`encode${String(e++).padStart(5, '0')}.mp4`, r.from, r.to); continue }
      for (let j = 0; j < edges.length - 1; j++) if (edges[j] >= r.from && edges[j + 1] <= r.to) part(`copy${String(j).padStart(5, '0')}.mp4`, edges[j], edges[j + 1])
    }
    await writeFile(join(tmp, 'cut.ffconcat'), list.join('\n') + '\n')
    await run(o.ffmpeg, ['-y', '-loglevel', 'error', '-f', 'concat', '-i', join(tmp, 'cut.ffconcat'), '-i', sound,
      '-map', '0:v:0', '-map', '1:a:0', '-c', 'copy', '-movflags', '+faststart', o.out], o.cwd)
    const bad = badJoin(parsePackets(await run(o.ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts,dts', '-of', 'compact=p=0', o.out], o.cwd)), total)
    if (bad) throw new Error(`The cut came out wrong: ${bad}`)
    o.progress?.(1)
    return { ok: true, copied: copied / total }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
}
