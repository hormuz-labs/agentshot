// Measuring a video before editing it: shots, camera shake and motion, exposure, contrast, colour, black and frozen
// frames, loudness and silence. One decode at 640 px through one filter graph (scdet, signalstats, blackdetect,
// freezedetect, vidstabdetect, ebur128, silencedetect), so the agent starts from numbers rather than guesses.
// Then contact sheets: frames with their time burned in, for what only a look can tell.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FFMPEG, FONTS_DIR, probe } from './media'
import type { MediaInfo } from '../shared/types'

/** Width the video is measured at; motion and shake are reported as a share of it. */
const W = 640
const STATS_FPS = 5
/** Inter Bold for the time labels. */
const FONT = join(FONTS_DIR, 'Inter-Bold.ttf')

export type Range = { s: number; e: number }
export type Shot = Range & {
  luma: number; low: number; high: number; sat: number; u: number; v: number
  /** camera path wobble around its smoothed path, % of frame width (RMS) */
  shake: number
  /** smoothed camera speed, % of frame width per second */
  motion: number
  /** a long shot (over ~8 s) in stretches that look alike: a continuous take moving from inside to outside, steady then shaky… */
  parts?: Part[]
}
export type Part = Range & { luma: number; shake: number; motion: number }
export type Analysis = {
  file: string
  info: MediaInfo
  shots: Shot[]
  black: Range[]
  frozen: Range[]
  audio?: { lufs: number; lra: number; peak: number; silence: Range[] }
  /** vid.stab found no motion data (very dark or blank picture): shake/motion unknown */
  noMotion: boolean
}

// ---------------------------------------------------------------- parsing the filters' output (pure, tested)

/** `metadata=mode=print` output: one record per frame, `frame:N pts:… pts_time:T` then `key=value` lines. */
export function parseMetadata(text: string): { t: number; v: Record<string, number> }[] {
  const out: { t: number; v: Record<string, number> }[] = []
  for (const line of text.split('\n')) {
    const f = /pts_time:([\d.e+-]+)/.exec(line)
    if (f) { out.push({ t: Number(f[1]), v: {} }); continue }
    const kv = /^lavfi\.([\w.]+)=(-?[\d.e+-]+|inf|-inf|nan)\s*$/.exec(line.trim())
    if (kv && out.length) out[out.length - 1].v[kv[1]] = Number(kv[2])
  }
  return out
}

/** blackdetect / freezedetect / silencedetect log lines → ranges. */
export function parseRanges(log: string, kind: 'black' | 'freeze' | 'silence', end: number): Range[] {
  const out: Range[] = []
  if (kind === 'black') {
    for (const m of log.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)) out.push({ s: Number(m[1]), e: Number(m[2]) })
    return out
  }
  const key = kind === 'freeze' ? 'freezedetect' : 'silencedetect'
  let start: number | null = null
  for (const line of log.split('\n')) {
    if (!line.includes(key)) continue
    const s = new RegExp(`${kind === 'freeze' ? 'lavfi.freezedetect.freeze_start' : 'silence_start'}: ?(-?[\\d.]+)`).exec(line)
    const e = new RegExp(`${kind === 'freeze' ? 'lavfi.freezedetect.freeze_end' : 'silence_end'}: ?([\\d.]+)`).exec(line)
    if (s) start = Math.max(0, Number(s[1]))
    if (e && start != null) { out.push({ s: start, e: Number(e[1]) }); start = null }
  }
  if (start != null) out.push({ s: start, e: end }) // still silent / frozen at the end
  return out
}

/** ebur128's summary: integrated loudness, loudness range, true peak. */
export function parseLoudness(log: string) {
  const sum = log.slice(log.lastIndexOf('Summary:'))
  const num = (re: RegExp) => { const m = re.exec(sum); return m ? Number(m[1]) : NaN }
  return { lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), lra: num(/LRA:\s+(-?[\d.]+) LU/), peak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) }
}

/**
 * vid.stab's ASCII transforms file: per frame a list of local motions `(LM dx dy x y size contrast match)`.
 * The camera's motion for a frame is the median of its local motions (robust against things moving in the shot).
 */
export function parseTransforms(text: string): ({ dx: number; dy: number } | null)[] {
  const out: ({ dx: number; dy: number } | null)[] = []
  for (const line of text.split('\n')) {
    const f = /^Frame (\d+) \(List \d+ \[(.*)\]\)/.exec(line)
    if (!f) continue
    const dxs: number[] = [], dys: number[] = []
    for (const m of f[2].matchAll(/\(LM (-?\d+) (-?\d+) /g)) { dxs.push(Number(m[1])); dys.push(Number(m[2])) }
    out[Number(f[1]) - 1] = dxs.length ? { dx: median(dxs), dy: median(dys) } : null
  }
  return Array.from(out, x => x ?? null)
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN)

/** Shake and motion of a stretch of per-frame camera moves: wobble of the path around its ~0.5 s average, and the average's speed. */
export function shakeOf(moves: ({ dx: number; dy: number } | null)[], fps: number) {
  const known = moves.filter(Boolean) as { dx: number; dy: number }[]
  if (known.length < 3) return { shake: 0, motion: 0 }
  const px: number[] = [], py: number[] = []
  let x = 0, y = 0
  for (const m of known) { x += m.dx; y += m.dy; px.push(x); py.push(y) }
  const half = Math.max(1, Math.round(fps / 4))
  const smooth = (p: number[]) => p.map((_, i) => mean(p.slice(Math.max(0, i - half), i + half + 1)))
  const sx = smooth(px), sy = smooth(py)
  // only where the whole window fits: a truncated window lags behind a steady move and would read as shake
  const inner = px.map((_, i) => i).filter(i => i >= half && i < px.length - half)
  const at = inner.length >= 3 ? inner : px.map((_, i) => i)
  const wobble = Math.sqrt(mean(at.map(i => (px[i] - sx[i]) ** 2 + (py[i] - sy[i]) ** 2)))
  const speed = mean(at.slice(1).map((i, k) => Math.hypot(sx[i] - sx[at[k]], sy[i] - sy[at[k]]))) * fps
  return { shake: (wobble / W) * 100, motion: (speed / W) * 100 }
}

/** Join neighbouring stretches that look alike (exposure within ~25, same shake and motion words). */
export function mergeParts(windows: Part[]): Part[] {
  const out: (Part & { n: number })[] = []
  for (const w of windows) {
    const last = out[out.length - 1]
    const same = last && Math.abs(last.luma - w.luma) < 25 && shakeWord(last.shake) === shakeWord(w.shake) && motionWord(last.motion) === motionWord(w.motion)
    if (same) {
      const n = last.n + 1
      Object.assign(last, { e: w.e, n, luma: (last.luma * last.n + w.luma) / n, shake: (last.shake * last.n + w.shake) / n, motion: (last.motion * last.n + w.motion) / n })
    } else out.push({ ...w, n: 1 })
  }
  return out.map(({ n: _n, ...p }) => ({ ...p, s: round(p.s, 2), e: round(p.e, 2), luma: Math.round(p.luma), shake: round(p.shake, 2), motion: round(p.motion, 1) }))
}

const shakeWord = (x: number) => (x < 0.25 ? 'steady' : x < 0.6 ? 'slight shake' : x < 1.2 ? 'shaky' : 'very shaky')
const motionWord = (x: number) => (x < 2 ? 'static camera' : x < 12 ? 'slow camera move' : x < 35 ? 'camera moving' : 'fast camera move')
const exposureWord = (l: number) => (l < 50 ? 'dark' : l > 190 ? 'bright' : 'exposure ok')

/** Cut times into shots, dropping cuts closer than 0.3 s (a flash or a dissolve's frames are one change). */
export function shotsOf(cuts: number[], duration: number): Range[] {
  const at = [0]
  for (const c of [...cuts].sort((a, b) => a - b)) if (c - at[at.length - 1] >= 0.3 && duration - c >= 0.3) at.push(c)
  return at.map((s, i) => ({ s, e: at[i + 1] ?? duration }))
}

// ---------------------------------------------------------------- running it

const run = (args: string[], cwd: string, signal?: AbortSignal) =>
  new Promise<string>((ok, fail) =>
    execFile(FFMPEG, args, { cwd, maxBuffer: 1 << 26, signal }, (err, _o, stderr) => (err ? fail(new Error(`ffmpeg failed: ${String(stderr).slice(-2000) || err.message}`)) : ok(String(stderr)))))

/** Measure a video (cached in <project>/.cache/analysis by file size and time). */
export async function analyze(projectDir: string, file: string, signal?: AbortSignal): Promise<Analysis> {
  const st = await stat(file)
  const key = createHash('sha256').update(`${file}:${st.size}:${st.mtimeMs}:v3-audio-origin`).digest('hex').slice(0, 24)
  const cacheDir = join(projectDir, '.cache', 'analysis')
  const cached = join(cacheDir, `${key}.json`)
  try { return JSON.parse(await readFile(cached, 'utf8')) } catch { /* measure it */ }

  const info = await probe(file)
  const tmp = await mkdtemp(join(tmpdir(), 'manul-analysis-'))
  try {
    const video = info.width > 0
    const graph = [
      ...(video ? [
        `[0:v]scale=${W}:-2:flags=fast_bilinear,format=yuv420p,split=3[a][b][c]`,
        `[a]scdet=threshold=10,metadata=mode=print:key=lavfi.scd.time:file=cuts.txt,blackdetect=d=0.1:pix_th=0.1,freezedetect=n=-60dB:d=0.5,nullsink`,
        `[b]fps=${STATS_FPS},signalstats,metadata=mode=print:file=stats.txt,nullsink`,
        `[c]vidstabdetect=shakiness=6:accuracy=9:stepsize=6:fileformat=ascii:result=shake.trf[v]`,
      ] : []),
      ...(info.hasAudio ? ['[0:a]aresample=48000:async=1:first_pts=0,ebur128=peak=true:framelog=verbose,silencedetect=n=-45dB:d=0.6[aud]'] : []),
    ]
    if (!graph.length) throw new Error('This file has neither picture nor sound.')
    const log = await run(['-hide_banner', '-nostats', '-loglevel', 'info', '-i', file, '-filter_complex', graph.join(';'),
      ...(video ? ['-map', '[v]', '-f', 'null', '-'] : []), ...(info.hasAudio ? ['-map', '[aud]', '-f', 'null', '-'] : [])], tmp, signal)
    const text = (f: string) => readFile(join(tmp, f), 'utf8').catch(() => '')

    let shots: Shot[] = [], noMotion = false
    if (video) {
      const cuts = parseMetadata(await text('cuts.txt')).map(r => r.v['scd.time'] ?? r.t)
      const stats = parseMetadata(await text('stats.txt'))
      const moves = parseTransforms(await text('shake.trf'))
      const fps = info.fps || 25
      noMotion = moves.every(m => !m)
      const lumaIn = (a: number, b: number) => Math.round(mean(stats.filter(x => x.t >= a && x.t < b).map(x => x.v['signalstats.YAVG']).filter(Number.isFinite)))
      shots = shotsOf(cuts, info.duration).map(r => {
        const inShot = stats.filter(x => x.t >= r.s && x.t < r.e).map(x => x.v)
        const avg = (k: string) => Math.round(mean(inShot.map(v => v[`signalstats.${k}`]).filter(Number.isFinite)))
        // trim 0.2 s at each cut: the frames either side of a cut aren't camera motion
        const { shake, motion } = shakeOf(moves.slice(Math.ceil((r.s + 0.2) * fps), Math.floor((r.e - 0.2) * fps)), fps)
        const shot: Shot = { ...r, luma: avg('YAVG'), low: avg('YLOW'), high: avg('YHIGH'), sat: avg('SATAVG'), u: avg('UAVG'), v: avg('VAVG'),
          shake: round(shake, 2), motion: round(motion, 1) }
        if (r.e - r.s > 8) {
          const windows: Part[] = []
          for (let a = r.s; a < r.e - 0.5; a += 2) {
            const b = Math.min(r.e, a + 2)
            const m = shakeOf(moves.slice(Math.ceil(a * fps), Math.floor(b * fps)), fps)
            windows.push({ s: a, e: b, luma: lumaIn(a, b), shake: m.shake, motion: m.motion })
          }
          shot.parts = mergeParts(windows)
        }
        return shot
      })
    }
    const result: Analysis = {
      file, info, shots, noMotion,
      black: video ? parseRanges(log, 'black', info.duration) : [],
      frozen: video ? parseRanges(log, 'freeze', info.duration) : [],
      ...(info.hasAudio ? { audio: { ...parseLoudness(log), silence: parseRanges(log, 'silence', info.duration) } } : {}),
    }
    await mkdir(cacheDir, { recursive: true })
    await writeFile(cached, JSON.stringify(result))
    return result
  } finally { await rm(tmp, { recursive: true, force: true }) }
}

const round = (n: number, d = 0) => Math.round(n * 10 ** d) / 10 ** d
const ts = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** Words for a shot's numbers, with the thresholds the agent's suggestions rest on. */
export function describeShot(s: Shot) {
  const notes: string[] = []
  if (s.luma < 50) notes.push(`dark (luma ${s.luma})`)
  else if (s.luma > 190) notes.push(`bright (luma ${s.luma})`)
  if (s.high - s.low < 90) notes.push(`flat contrast (${s.low}–${s.high})`)
  if (s.high >= 235) notes.push('highlights near clipping')
  if (s.low <= 16 && s.luma < 80) notes.push('blacks crushed')
  if (s.sat < 10) notes.push(`almost no colour (sat ${s.sat}): a flat/log camera profile or grey scene — a grade brings colour back`)
  else if (s.sat < 20) notes.push(`muted colour (sat ${s.sat})`)
  else if (s.sat > 70) notes.push(`very saturated (sat ${s.sat})`)
  const du = s.u - 128, dv = s.v - 128
  if (Math.hypot(du, dv) > 6) notes.push(`${dv > 0 ? (du < 0 ? 'warm' : 'magenta') : du > 0 ? 'cool/blue' : 'green'} cast (U${du >= 0 ? '+' : ''}${du} V${dv >= 0 ? '+' : ''}${dv})`)
  return { shake: shakeWord(s.shake), motion: motionWord(s.motion), notes }
}

/** The analysis as the agent reads it. */
export function report(a: Analysis, rel: string) {
  const i = a.info
  const lines = [`${rel} · ${ts(i.duration)} (${i.duration.toFixed(2)} s) · ${i.width}x${i.height} · ${i.fps} fps · ${i.codec}${i.hasAudio ? '' : ' · no audio'}`]
  if (a.shots.length) {
    lines.push('', `Shots (${a.shots.length}). shake = camera wobble as % of frame width (≥0.6 shaky); motion = camera speed in % of width per second:`)
    a.shots.forEach((s, n) => {
      const d = describeShot(s)
      lines.push(`${n + 1}. ${ts(s.s)}–${ts(s.e)} (${(s.e - s.s).toFixed(1)} s) · ${d.motion} (${s.motion}) · ${d.shake} (${s.shake})` +
        (d.notes.length ? ` · ${d.notes.join(', ')}` : ' · exposure and colour fine'))
      if (s.parts && s.parts.length > 1) {
        lines.push(`   one continuous take; along it:`)
        for (const p of s.parts) lines.push(`   ${ts(p.s)}–${ts(p.e)} ${exposureWord(p.luma)} (luma ${p.luma}) · ${motionWord(p.motion)} (${p.motion}) · ${shakeWord(p.shake)} (${p.shake})`)
      }
    })
    if (a.noMotion) lines.push('(vid.stab found nothing to track: shake and motion are unknown)')
  }
  if (a.black.length) lines.push('', `Black: ${a.black.map(r => `${ts(r.s)}–${ts(r.e)}`).join(', ')}`)
  if (a.frozen.length) lines.push(`Frozen picture: ${a.frozen.map(r => `${ts(r.s)}–${ts(r.e)}`).join(', ')}`)
  if (a.audio) {
    const au = a.audio
    const silent = au.silence.reduce((t, r) => t + r.e - r.s, 0)
    lines.push('', `Audio: ${Number.isFinite(au.lufs) ? `${au.lufs} LUFS integrated` : 'silent'}, loudness range ${au.lra} LU, peak ${au.peak} dBFS` +
      `${au.peak > -1 ? ' (too hot: clipping risk)' : ''}${Number.isFinite(au.lufs) && au.lufs < -20 ? ' (quiet for web: target -14)' : ''}` +
      `; silent ${silent.toFixed(1)} s of ${i.duration.toFixed(1)} s${au.silence.length && au.silence.length <= 12 ? ` (${au.silence.map(r => `${ts(r.s)}–${ts(r.e)}`).join(', ')})` : ''}.` +
      ' Speech: read the transcript tool.')
  }
  return lines.join('\n')
}

/** Frames at times, labelled, tiled into one JPEG. box (0–1 fractions) crops every frame first, to look closely. */
export async function contactSheet(file: string, frames: { t: number; label: string }[], out: string,
  opts: { fontFile?: string; box?: { x: number; y: number; w: number; h: number }; signal?: AbortSignal } = {}) {
  if (!frames.length) throw new Error('No frames to show.')
  const n = frames.length
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4
  const cell = n <= 1 ? 1280 : n <= 4 ? 768 : n <= 9 ? 512 : 400
  const tmp = await mkdtemp(join(tmpdir(), 'manul-sheet-'))
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/:/g, '\\:').replace(/%/g, '\\%')
  const b = opts.box
  const crop = b ? `crop=iw*${b.w}:ih*${b.h}:iw*${b.x}:ih*${b.y},` : ''
  try {
    let next = 0
    const worker = async () => {
      for (let k = next++; k < n; k = next++) {
        const f = frames[k]
        await run(['-hide_banner', '-loglevel', 'error', '-ss', Math.max(0, f.t).toFixed(3), '-i', file, '-frames:v', '1', '-an',
          '-vf', `${crop}scale=${cell}:-2,drawtext=fontfile='${esc(opts.fontFile || FONT)}':text='${esc(f.label)}':x=8:y=8:fontsize=${Math.round(cell / 22)}:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=5`,
          '-q:v', '3', join(tmp, `${String(k + 1).padStart(3, '0')}.jpg`)], tmp, opts.signal)
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, n) }, worker))
    const rows = Math.ceil(n / cols)
    await run(['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '1', '-start_number', '1', '-i', '%03d.jpg',
      '-vf', `tile=${cols}x${rows}:padding=4:color=black`, '-frames:v', '1', '-q:v', '3', out], tmp, opts.signal)
    return out
  } finally { await rm(tmp, { recursive: true, force: true }) }
}

/** Frames for a sheet of the whole video: one in the middle of each shot (most even spread if there are more than max), at least `min`. */
export function sheetFrames(a: Analysis, max = 16, min = 8) {
  const d = a.info.duration
  let picks = a.shots.map((s, i) => ({ t: (s.s + s.e) / 2, label: `#${i + 1}  ${ts((s.s + s.e) / 2)}` }))
  if (picks.length > max) picks = Array.from({ length: max }, (_, k) => picks[Math.round((k * (picks.length - 1)) / (max - 1))])
  if (picks.length < min) {
    picks = Array.from({ length: min }, (_, k) => {
      const t = (d * (k + 0.5)) / min
      const shot = a.shots.findIndex(s => t >= s.s && t < s.e)
      return { t, label: `${shot >= 0 ? `#${shot + 1}  ` : ''}${ts(t)}` }
    })
  }
  return picks
}
