// Where the subject is: faces (YuNet) and objects (YOLOX, 80 COCO classes) found by manul-vision in sampled frames,
// linked into tracks, summarised per shot, with a crop path for a narrower shape (9:16, 1:1, 4:5) that follows the
// main subject smoothly — and the ffmpeg crop expression for it — so vertical versions keep the subject in frame.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { FFMPEG, MODELS_DIR, VISION, probe } from './media'

export const COCO = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant',
  'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
  'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
  'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich',
  'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet',
  'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock',
  'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush']

export type Det = { t: number; x: number; y: number; w: number; h: number; score: number; kind: string }
export type Point = { t: number; x: number; y: number; w: number; h: number }
export type Track = { id: number; kind: string; points: Point[] }
export type Key = { t: number; x: number }

const cx = (p: { x: number; w: number }) => p.x + p.w / 2
const cy = (p: { y: number; h: number }) => p.y + p.h / 2
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Link detections into tracks: same kind, close to where the track was within the last second (pure, tested). */
export function track(dets: Det[], maxGap = 2): Track[] {
  const tracks: Track[] = []
  const times = [...new Set(dets.map(d => d.t))].sort((a, b) => a - b)
  for (const t of times) {
    const used = new Set<number>()
    for (const d of dets.filter(x => x.t === t).sort((a, b) => b.score - a.score)) {
      let best: Track | undefined, bestDist = Infinity
      for (const tr of tracks) {
        const last = tr.points[tr.points.length - 1]
        if (tr.kind !== d.kind || used.has(tr.id) || t - last.t > maxGap) continue
        const dist = Math.hypot(cx(d) - cx(last), cy(d) - cy(last))
        if (dist < Math.max(0.12, 0.6 * Math.max(last.w, last.h)) && dist < bestDist) { best = tr; bestDist = dist }
      }
      const p = { t, x: d.x, y: d.y, w: d.w, h: d.h }
      if (best) best.points.push(p)
      else { best = { id: tracks.length, kind: d.kind, points: [p] }; tracks.push(best) }
      used.add(best.id)
    }
  }
  return tracks
}

const weight = (kind: string) => (kind === 'face' ? 3 : kind === 'person' ? 1.5 : ['car', 'truck', 'bus', 'motorcycle', 'bicycle', 'boat', 'airplane',
  'train', 'dog', 'cat', 'horse', 'bird'].includes(kind) ? 1.2 : 1)

export type ShotSubjects = {
  s: number; e: number
  tracks: { kind: string; x: number; size: number; presence: number }[]
  main?: { kind: string; x: number }
  /** the crop's centre over time (fractions of the width; t from the shot's start), when a narrower shape needs one */
  crop?: Key[]
}

/**
 * The main subject's centre over a shot, frame by frame: from its first sighting, each sampled time takes the detection of
 * the same kind that best continues it — near where it was and of a similar size — so a subject whose track broke up is
 * still followed, while a small car parked in the background or a passer-by isn't mistaken for it.
 */
export function follow(dets: Det[], kind: string, start: { t: number; x: number; w: number }, s: number, e: number): Key[] {
  const times = [...new Set(dets.filter(d => d.kind === kind && d.t >= s && d.t < e).map(d => d.t))].sort((a, b) => a - b)
  const path: Key[] = []
  let x = start.x, w = start.w, seen = start.t
  for (const t of times) {
    const lost = t - seen >= 1.5 // gone long enough: take whatever is there
    const fits = dets.filter(d => d.kind === kind && d.t === t)
      .filter(d => lost || (Math.abs(cx(d) - x) <= 0.35 && d.w / w <= 3 && w / d.w <= 3))
      .sort((a, b) => (Math.abs(cx(a) - x) + 0.5 * Math.abs(Math.log(a.w / w))) - (Math.abs(cx(b) - x) + 0.5 * Math.abs(Math.log(b.w / w))))
    if (!fits.length) continue
    x = cx(fits[0]); w = fits[0].w; seen = t
    path.push({ t, x })
  }
  return path.length ? path : [{ t: start.t, x: start.x }]
}

/** Summarise a shot: what is in it, the main subject, and a smooth crop path for a frame `cw` wide (fraction of the width). */
export function shotSubjects(tracks: Track[], s: number, e: number, fps: number, cw: number, dets: Det[] = []): ShotSubjects {
  const frames = Math.max(1, Math.round((e - s) * fps))
  const inShot = tracks.map(tr => ({ tr, pts: tr.points.filter(p => p.t >= s && p.t < e) })).filter(x => x.pts.length > 0)
  const summary = inShot.map(({ tr, pts }) => ({
    tr, pts,
    kind: tr.kind,
    x: r3(pts.reduce((a, p) => a + cx(p), 0) / pts.length),
    size: r3(pts.reduce((a, p) => a + p.h, 0) / pts.length),
    presence: Math.min(1, pts.length / frames),
    area: pts.reduce((a, p) => a + p.w * p.h, 0) / pts.length,
  })).filter(x => x.presence >= 0.15 || x.kind === 'face')
  summary.sort((a, b) => b.presence * b.area * weight(b.kind) - a.presence * a.area * weight(a.kind))
  const out: ShotSubjects = { s, e, tracks: summary.slice(0, 12).map(({ kind, x, size, presence }) => ({ kind, x, size, presence: r3(presence) })) }
  // a face seen a quarter of the shot or more is the subject (a crop on the face beats one on a wide body box)
  const face = summary.filter(x => x.kind === 'face' && x.presence >= 0.25).sort((a, b) => b.size * b.presence - a.size * a.presence)[0]
  const main = face || summary[0]
  if (!main) return out
  out.main = { kind: main.kind, x: main.x }
  if (cw < 1) {
    const first = main.pts[0]
    const path = dets.length ? follow(dets, main.kind, { t: first.t, x: cx(first), w: first.w }, s, e) : main.pts.map(p => ({ t: p.t, x: cx(p) }))
    out.crop = cropPath(path, s, e, fps, cw)
  }
  return out
}

/** A crop centre that follows the subject: interpolated, smoothed over ~1 s, at most 15 % of the width per second, inside the frame. */
export function cropPath(points: Key[], s: number, e: number, fps: number, cw: number): Key[] {
  const n = Math.max(2, Math.round((e - s) * fps) + 1)
  const at = (t: number) => {
    if (t <= points[0].t) return points[0].x
    const last = points[points.length - 1]
    if (t >= last.t) return last.x
    const i = points.findIndex(p => p.t >= t)
    const a = points[i - 1], b = points[i]
    return a.x + ((b.x - a.x) * (t - a.t)) / (b.t - a.t || 1)
  }
  const ts = Array.from({ length: n }, (_, i) => s + ((e - s) * i) / (n - 1))
  let xs = ts.map(at)
  const half = Math.max(1, Math.round(fps / 2))
  xs = xs.map((_, i) => { const w = xs.slice(Math.max(0, i - half), i + half + 1); return w.reduce((a, b) => a + b, 0) / w.length })
  const step = 0.15 * ((e - s) / (n - 1))
  for (let i = 1; i < xs.length; i++) xs[i] = Math.min(xs[i - 1] + step, Math.max(xs[i - 1] - step, xs[i]))
  xs = xs.map(x => Math.min(1 - cw / 2, Math.max(cw / 2, x)))
  const keys = simplify(ts.map((t, i) => ({ t: t - s, x: xs[i] })), 0.015)
  return keys.map(k => ({ t: r3(k.t), x: r3(k.x) }))
}

/** Ramer–Douglas–Peucker on (t, x): the fewest keyframes that stay within `tol` of the path; one if it barely moves. */
export function simplify(p: Key[], tol: number): Key[] {
  if (p.length <= 2) return p
  const xs = p.map(k => k.x)
  if (Math.max(...xs) - Math.min(...xs) < 2 * tol) return [{ t: 0, x: xs.reduce((a, b) => a + b, 0) / xs.length }]
  const rec = (a: number, b: number): Key[] => {
    let far = -1, dist = tol
    for (let i = a + 1; i < b; i++) {
      const f = (p[i].t - p[a].t) / (p[b].t - p[a].t || 1)
      const d = Math.abs(p[i].x - (p[a].x + f * (p[b].x - p[a].x)))
      if (d > dist) { dist = d; far = i }
    }
    return far < 0 ? [p[a], p[b]] : [...rec(a, far).slice(0, -1), ...rec(far, b)]
  }
  return rec(0, p.length - 1)
}

/** The ffmpeg crop filter for a path (t = seconds from the start of the trimmed shot). aspect: e.g. "9/16". */
export function cropFilter(keys: Key[], aspect: string): string {
  const f = (n: number) => String(r3(n))
  let e = f(keys[keys.length - 1].x)
  for (let i = keys.length - 2; i >= 0; i--) {
    const a = keys[i], b = keys[i + 1]
    const seg = r3(b.x - a.x) === 0 ? f(a.x) : `${f(a.x)}+${f(b.x - a.x)}*(t-${f(a.t)})/${f(b.t - a.t)}`
    e = `if(lt(t,${f(b.t)}),${seg},${e})`
  }
  return `crop=w=ih*${aspect}:h=ih:x='max(0,min(iw-ow,iw*(${e})-ow/2))':y=0`
}

const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const pct = (n: number) => `${Math.round(n * 100)} %`
const where = (x: number) => (x < 0.38 ? 'left' : x > 0.62 ? 'right' : 'centre')

export function subjectsReport(rel: string, shots: ShotSubjects[], o: { aspect: string; fps: number; cw: number; file: string }) {
  const lines = [`${rel} · faces and objects, ${o.fps} frames/s · ${o.aspect.replace('/', ':')} crop = ${pct(Math.min(1, o.cw))} of the width`]
  if (o.cw >= 1) lines.push(`The source is already as narrow as ${o.aspect.replace('/', ':')}: no sideways crop needed.`)
  shots.forEach((sh, i) => {
    const faces = sh.tracks.filter(t => t.kind === 'face')
    const objects = sh.tracks.filter(t => t.kind !== 'face')
    const kinds = [...new Set(objects.map(t => t.kind))].map(k => {
      const of = objects.filter(t => t.kind === k)
      const pos = of.slice(0, 4).map(t => `${where(t.x)} ${t.x}${t.size > 0.5 ? ' big' : t.size < 0.15 ? ' small' : ''}`).join(', ')
      return `${of.length > 1 ? `${of.length}× ` : ''}${k} (${pos}${of.length > 4 ? '…' : ''})`
    })
    const desc = [
      faces.length ? `faces: ${faces.slice(0, 4).map(f => `${where(f.x)} x ${f.x} (${pct(f.size)} of the height, ${pct(f.presence)} of the time)`).join('; ')}` : 'no face',
      kinds.length ? `objects: ${kinds.join(', ')}` : '',
    ].filter(Boolean).join(' · ')
    lines.push(`Shot ${i + 1} ${ts(sh.s)}–${ts(sh.e)} · ${desc}`)
    if (sh.crop && sh.main) {
      const move = sh.crop.length === 1 ? `still, centred at x ${sh.crop[0].x}` : `follows it ${sh.crop.map(k => `${k.x}@${k.t}s`).join(' → ')}`
      lines.push(`  main subject: ${sh.main.kind} · crop ${move}`)
      lines.push(`  ${cropFilter(sh.crop, o.aspect)}`)
    } else if (o.cw < 1) lines.push('  no subject found: crop the centre, or look at the frames and choose')
  })
  lines.push('', 'Each crop filter goes on that shot after its trim (t counts from the shot\'s start), then scale to the output size.',
    `x = the centre as a fraction of the width (0 left … 1 right). Every detection: ${o.file}`)
  return lines.join('\n')
}

/** Run one model over sampled frames of a range. */
function detect(file: string, model: 'yunet' | 'yolox', t0: number, t1: number, fps: number, w: number, h: number, signal?: AbortSignal): Promise<Det[]> {
  return new Promise((ok, fail) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(t0), '-to', String(t1), '-i', file, '-an',
      '-vf', `fps=${fps},scale=${w}:${h}`, '-pix_fmt', 'bgr24', '-f', 'rawvideo', '-'], { signal })
    const vis = spawn(VISION, ['--model', model, '--file', join(MODELS_DIR, model === 'yunet' ? 'faces-yunet.onnx' : 'objects-yolox-tiny.onnx'),
      '--width', String(w), '--height', String(h)], { signal })
    ff.stdout.pipe(vis.stdin)
    vis.stdin.on('error', () => {}) // the runner may finish first
    let out = '', err = ''
    vis.stdout.on('data', d => { out += d })
    vis.stderr.on('data', d => { err += d })
    ff.stderr.on('data', d => { err += d })
    ff.on('error', fail); vis.on('error', fail)
    vis.on('close', code => {
      if (code) return fail(new Error(`manul-vision failed: ${err.slice(-800)}`))
      const dets: Det[] = []
      for (const line of out.split('\n')) {
        if (!line) continue
        const { i, d } = JSON.parse(line) as { i: number; d: number[][] }
        for (const [x, y, bw, bh, score, cls] of d) dets.push({ t: r3(t0 + i / fps), x, y, w: bw, h: bh, score, kind: model === 'yunet' ? 'face' : COCO[cls] || `class ${cls}` })
      }
      ok(dets)
    })
  })
}

/** Faces and objects over a range (cached in <project>/.cache/subjects). */
export async function findSubjects(projectDir: string, file: string, o: { t0?: number; t1?: number; fps?: number; signal?: AbortSignal } = {}) {
  const info = await probe(file)
  if (!info.width) throw new Error('This file has no picture.')
  const t0 = Math.max(0, o.t0 ?? 0), t1 = Math.min(info.duration, o.t1 ?? info.duration)
  const span = t1 - t0
  const fps = o.fps ?? (span > 600 ? 1 : span > 120 ? 2 : 5)
  const st = await stat(file)
  const key = createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:${t0}:${t1}:${fps}:v1`).digest('hex').slice(0, 16)
  const dir = join(projectDir, '.cache', 'subjects')
  const out = join(dir, `${basename(file).replace(/\.[^.]+$/, '')}-${key}.json`)
  try { return { ...(JSON.parse(await readFile(out, 'utf8')) as { dets: Det[] }), info, t0, t1, fps, file: out } } catch { /* detect */ }
  const landscape = info.width >= info.height
  const w = landscape ? 640 : Math.round((640 * info.width) / info.height / 2) * 2
  const h = landscape ? Math.round((640 * info.height) / info.width / 2) * 2 : 640
  const [faces, objects] = await Promise.all([detect(file, 'yunet', t0, t1, fps, w, h, o.signal), detect(file, 'yolox', t0, t1, fps, w, h, o.signal)])
  const dets = [...faces, ...objects]
  await mkdir(dir, { recursive: true })
  await writeFile(out, JSON.stringify({ dets }))
  return { dets, info, t0, t1, fps, file: out }
}
