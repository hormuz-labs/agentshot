// The timeline: what the film is made of, in order. Media segments (a range of an imported or rendered file) and
// motion clips (agent-made HTML, rendered frame-exact). Pure functions, shared by the main process and the UI;
// a render turns a timeline into one MP4 (composeArgs; an edit that only cuts one file is mostly copied, main/cuts.ts).
import { cameraLayout, cameraRange, refreshDemoSummary, type CameraLayout, type Demo } from './demo'
import { framing, framingGraph, type VideoFraming } from './framing'

/** A range of a file. db: its sound louder or quieter (0 = as it is); muted: silent. */
export type MediaItem = { id: string; kind: 'media'; src: string; in: number; out: number; db?: number; muted?: boolean; framing?: VideoFraming }
export type ClipItem = { id: string; kind: 'clip'; clip: string; dur: number }
export type Item = MediaItem | ClipItem
export type Format = { width: number; height: number; fps: number }
/** A clip laid over the film (transparent background) from start for dur seconds: lower thirds, captions, callouts. */
export type Overlay = { id: string; clip: string; start: number; dur: number }
export type Timeline = Format & { items: Item[]; overlays?: Overlay[]; demo?: Demo; /** film level, music and ducking (see mix.ts) */ mix?: import('./mix').Mix }

let seq = 0
const newId = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`
const round = (t: number) => Math.round(t * 1000) / 1000

export const length = (i: Item) => (i.kind === 'media' ? i.out - i.in : i.dur)
export const duration = (tl: Timeline) => round(tl.items.reduce((s, i) => s + length(i), 0))

/** A timeline that is just one file, start to end. */
export const fromMedia = (src: string, dur: number, format: Format): Timeline => ({ ...format, items: [{ id: newId(), kind: 'media', src, in: 0, out: round(dur) }] })

/** A timeline that is just this file, in its own size and frame rate (even sizes, sane rate). */
export const timelineOfFile = (src: string, info: { duration: number; width: number; height: number; fps: number }) => fromMedia(src, info.duration, {
  width: Math.max(2, Math.round((info.width || 1920) / 2) * 2),
  height: Math.max(2, Math.round((info.height || 1080) / 2) * 2),
  fps: info.fps > 0 && info.fps <= 120 ? Math.round(info.fps * 100) / 100 : 30,
})

/** Where each item starts on the timeline. */
export function starts(tl: Timeline) {
  let at = 0
  return tl.items.map(i => { const s = at; at += length(i); return round(s) })
}

/** The item playing at time t (the last one past the end), with its start time on the timeline. */
export function itemAt(tl: Timeline, t: number) {
  let start = 0
  for (let index = 0; index < tl.items.length; index++) {
    const len = length(tl.items[index])
    if (t < start + len || index === tl.items.length - 1) return { index, item: tl.items[index], start }
    start += len
  }
  return { index: -1, item: undefined, start: 0 }
}

/** Cut the media item under t in two. Edges and clips are left alone (clips are never cut). */
export function splitAt(tl: Timeline, t: number): Timeline {
  const { index, item, start } = itemAt(tl, t)
  if (!item || item.kind !== 'media') return tl
  const at = round(item.in + (t - start))
  if (at <= item.in + 1e-3 || at >= item.out - 1e-3) return tl
  const items = [...tl.items]
  items.splice(index, 1, { ...item, out: at }, { ...item, id: newId(), in: at })
  return { ...tl, items }
}

/** Open a gap at t and put an item there. Inside a clip, the new item goes right after it. */
export function insertAt(tl: Timeline, t: number, add: Omit<MediaItem, 'id'> | Omit<ClipItem, 'id'>) {
  const split = splitAt(tl, t)
  let start = 0, index = split.items.length
  for (let i = 0; i < split.items.length; i++) {
    const it = split.items[i], len = length(it)
    if (t <= start + 1e-3) { index = i; break }
    if (t < start + len - 1e-3) { index = i + 1; break } // inside an uncut item (a clip): after it
    start += len
  }
  const items = [...split.items]
  items.splice(index, 0, { ...add, id: newId() } as Item)
  return { timeline: { ...split, items }, index }
}

export const removeItem = (tl: Timeline, id: string): Timeline => ({ ...tl, items: tl.items.filter(i => i.id !== id) })

// ---------------------------------------------------------------- editing by hand (and by the agent's edit_timeline)
// Every edit ripples: there are no gaps, so what follows a cut or a trim moves up. Overlays stay on the footage they
// were laid over (see keepOverlays).

export type Edit =
  | { op: 'frame'; ids: string[]; framing: Partial<VideoFraming> | null }
  | { op: 'camera'; layout: Partial<CameraLayout> }
  | { op: 'split'; at: number }
  /** take out from–to; clips are only taken out when entirely inside */
  | { op: 'cut'; from: number; to: number }
  | { op: 'delete'; ids: string[] }
  /** put an item before another (by id), or at the end */
  | { op: 'move'; id: string; before?: string }
  /** new source in/out for a media item; out is the length of a clip */
  | { op: 'trim'; id: string; in?: number; out?: number }
  | { op: 'level'; ids: string[]; db?: number; muted?: boolean }
  | { op: 'insert'; at: number; src: string; in: number; out: number }
  | { op: 'mix'; mix: NonNullable<Timeline['mix']> }
  | { op: 'voiceover'; id: string; track: import('./voiceover').Voiceover | null }

const MIN_DB = -40, MAX_DB = 12
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** What plays at t: the item, where it starts, and the moment of its source (media: in + offset; clip: offset). */
export function sourceAt(tl: Timeline, t: number) {
  const { index, item, start } = itemAt(tl, t)
  if (!item) return null
  const off = clamp(t - start, 0, length(item))
  return { index, item, start, at: round((item.kind === 'media' ? item.in : 0) + off) }
}

/** Where a moment of a file plays in the film (its first use), or null when the edit leaves it out. */
export function timeOf(tl: Timeline, src: string, s: number): number | null {
  let at = 0
  for (const it of tl.items) {
    if (it.kind === 'media' && it.src === src && s >= it.in - 1e-3 && s < it.out) return round(at + Math.max(0, s - it.in))
    at += length(it)
  }
  return null
}

/** The next moment of a file the edit keeps at or after s (for a click on a word that was cut). */
export function nextKept(tl: Timeline, src: string, s: number): number | null {
  const exact = timeOf(tl, src, s)
  if (exact != null) return exact
  let best: { in: number; at: number } | null = null, at = 0
  for (const it of tl.items) {
    if (it.kind === 'media' && it.src === src && it.in >= s && (!best || it.in < best.in)) best = { in: it.in, at }
    at += length(it)
  }
  return best ? round(best.at) : null
}

/** Where the moments from–to of a file play in the film (one range per piece that uses some of them). */
export function rangesOf(tl: Timeline, src: string, from: number, to: number): [number, number][] {
  const out: [number, number][] = []
  let at = 0
  for (const it of tl.items) {
    if (it.kind === 'media' && it.src === src) {
      const a = Math.max(from, it.in), b = Math.min(to, it.out)
      if (b - a > 1e-3) out.push([round(at + a - it.in), round(at + b - it.in)])
    }
    at += length(it)
  }
  return out
}

/**
 * Many edits given against the same film (the agent's edit_timeline): the ones at a time (cut, split, insert) go from
 * the last to the first so each time still means what it meant, overlapping cuts joined; then the ones by id, in order.
 */
export function batch(tl: Timeline, edits: (Edit | { op: 'cut'; from: number; to: number; src: string })[]): Edit[] {
  const cuts: [number, number][] = []
  const timed: { t: number; e: Edit }[] = []
  const byId: Edit[] = []
  for (const e of edits) {
    if (e.op === 'cut') {
      if ('src' in e && e.src) cuts.push(...rangesOf(tl, e.src, Math.min(e.from, e.to), Math.max(e.from, e.to)))
      else cuts.push([Math.min(e.from, e.to), Math.max(e.from, e.to)])
    } else if (e.op === 'split' || e.op === 'insert') timed.push({ t: e.at, e })
    else byId.push(e)
  }
  cuts.sort((a, b) => a[0] - b[0])
  const joined: [number, number][] = []
  for (const [a, b] of cuts) { const last = joined.at(-1); if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b); else joined.push([a, b]) }
  for (const [a, b] of joined) timed.push({ t: a, e: { op: 'cut', from: a, to: b } })
  return [...timed.sort((x, y) => y.t - x.t).map(x => x.e), ...byId]
}

/** The parts of a file the edit uses, in file order, joined where they touch. */
export function keptOf(tl: Timeline, src: string): [number, number][] {
  const parts = tl.items.flatMap(i => (i.kind === 'media' && i.src === src ? [[i.in, i.out] as [number, number]] : [])).sort((a, b) => a[0] - b[0])
  const out: [number, number][] = []
  for (const [a, b] of parts) {
    const last = out.at(-1)
    if (last && a <= last[1] + 1e-3) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out
}

/** Take out from–to: split at both ends, drop what lies between. */
export function cutRange(tl: Timeline, from: number, to: number): Timeline {
  const a = Math.max(0, Math.min(from, to)), b = Math.min(duration(tl), Math.max(from, to))
  if (b - a < 1e-3) return tl
  const split = splitAt(splitAt(tl, b), a)
  const at = starts(split)
  return { ...split, items: split.items.filter((it, i) => !(at[i] >= a - 1e-3 && at[i] + length(it) <= b + 1e-3)) }
}

/**
 * Overlays after an edit: each stays on the footage it was laid over. It starts where its first moment that is still
 * in the film now plays, and lasts as long as the footage under it that was kept; one whose footage is all gone goes.
 */
export function keepOverlays(before: Timeline, after: Timeline): Overlay[] | undefined {
  if (!before.overlays?.length) return after.overlays
  const bs = starts(before), as = starts(after), total = duration(after)
  const out: Overlay[] = []
  for (const o of before.overlays) {
    let first: { b: number; a: number } | null = null, kept = 0
    before.items.forEach((bi, i) => {
      const t0 = Math.max(o.start, bs[i]), t1 = Math.min(o.start + o.dur, bs[i] + length(bi))
      if (t1 - t0 <= 1e-3) return
      const s0 = (bi.kind === 'media' ? bi.in : 0) + (t0 - bs[i]), s1 = s0 + (t1 - t0)
      after.items.forEach((ai, k) => {
        const same = bi.kind === 'media' ? ai.kind === 'media' && ai.src === bi.src : ai.id === bi.id
        if (!same) return
        const lo = ai.kind === 'media' ? ai.in : 0, hi = ai.kind === 'media' ? ai.out : ai.dur
        const x0 = Math.max(s0, lo), x1 = Math.min(s1, hi)
        if (x1 - x0 <= 1e-3) return
        kept += x1 - x0
        const b = t0 + (x0 - s0)
        if (!first || b < first.b) first = { b, a: as[k] + (x0 - lo) }
      })
    })
    if (!first) continue
    const start = round(Math.min((first as { a: number }).a, total))
    const dur = round(Math.min(o.dur, kept, total - start))
    if (dur > 1e-3) out.push({ ...o, start, dur })
  }
  return out
}

/**
 * One edit. maxOf gives an item's longest possible length (its file's or clip's duration) for trims; an edit that
 * would leave the film empty throws.
 */
export function applyEdit(tl: Timeline, e: Edit, maxOf: (it: Item) => number | undefined = () => undefined): Timeline {
  const minLen = Math.max(1 / (tl.fps || 30), 0.04)
  let after: Timeline
  switch (e.op) {
    case 'frame': return { ...tl, items: tl.items.map(it => {
      if (it.kind !== 'media' || !e.ids.includes(it.id)) return it
      const next = { ...it }
      if (e.framing == null) delete next.framing
      else next.framing = framing({ ...it.framing, ...e.framing })
      return next
    }) }
    case 'camera': {
      if (!tl.demo) throw new Error('This edit has no face-camera layer yet.')
      const patch = { ...tl.demo.layout, ...e.layout }
      if (e.layout.shape && e.layout.shape !== tl.demo.layout.shape && e.layout.height == null) delete (patch as Partial<CameraLayout>).height
      return { ...tl, demo: { ...tl.demo, layout: cameraLayout(tl.width, tl.height, patch) } }
    }
    case 'split': after = splitAt(tl, e.at); break
    case 'cut': after = cutRange(tl, e.from, e.to); break
    case 'delete': after = { ...tl, items: tl.items.filter(i => !e.ids.includes(i.id)) }; break
    case 'move': {
      const it = tl.items.find(i => i.id === e.id)
      if (!it || e.before === e.id) return tl
      const items = tl.items.filter(i => i.id !== e.id)
      const k = e.before ? items.findIndex(i => i.id === e.before) : -1
      items.splice(k < 0 ? items.length : k, 0, it)
      after = { ...tl, items }
      break
    }
    case 'trim': after = {
      ...tl, items: tl.items.map(it => {
        if (it.id !== e.id) return it
        const max = maxOf(it) ?? Infinity
        if (it.kind === 'clip') return { ...it, dur: round(clamp(e.out ?? it.dur, minLen, max)) }
        const a = round(clamp(e.in ?? it.in, 0, (e.out ?? it.out) - minLen))
        return { ...it, in: a, out: round(clamp(e.out ?? it.out, a + minLen, max)) }
      }),
    }; break
    case 'level': after = {
      ...tl, items: tl.items.map(it => {
        if (it.kind !== 'media' || !e.ids.includes(it.id)) return it
        const next: MediaItem = { ...it }
        if (e.db != null) { const db = Math.round(clamp(e.db, MIN_DB, MAX_DB) * 10) / 10; if (db) next.db = db; else delete next.db }
        if (e.muted != null) { if (e.muted) next.muted = true; else delete next.muted }
        return next
      }),
    }; break
    case 'insert': after = insertAt(tl, e.at, { kind: 'media', src: e.src, in: round(e.in), out: round(e.out) }).timeline; break
    case 'mix': return { ...tl, mix: e.mix }
    case 'voiceover': return { ...tl, mix: { filmDb: 0, ...tl.mix, voiceovers: [...(tl.mix?.voiceovers || []).filter(v => v.id !== e.id), ...(e.track ? [e.track] : [])] } }
  }
  if (!after.items.length) throw new Error('The film needs at least one piece: that would take out all of it.')
  return { ...after, ...(after.demo ? { demo: refreshDemoSummary(after.demo, duration(after)) } : {}), overlays: keepOverlays(tl, after) }
}

const clock = (t: number) => { const s = Math.round(t); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
/** A few words for the history and the version's title. */
export function describeEdit(e: Edit): string {
  switch (e.op) {
    case 'frame': return 'Adjusted video framing'
    case 'camera': return 'Adjusted face camera'
    case 'split': return `Split at ${clock(e.at)}`
    case 'cut': return `Cut ${clock(Math.min(e.from, e.to))}–${clock(Math.max(e.from, e.to))}`
    case 'delete': return e.ids.length === 1 ? 'Deleted a piece' : `Deleted ${e.ids.length} pieces`
    case 'move': return 'Moved a piece'
    case 'trim': return 'Trimmed a piece'
    case 'level': return e.muted ? 'Muted a piece' : e.db != null ? `Volume ${e.db > 0 ? '+' : ''}${Math.round(e.db)} dB` : 'Unmuted a piece'
    case 'insert': return `Inserted ${e.src.split('/').pop()} at ${clock(e.at)}`
    case 'mix': return 'Mix'
    case 'voiceover': return e.track ? 'Adjusted voiceover' : 'Removed voiceover'
  }
}

/** Whether two timelines make the same film (ids aside): what it is made of, the overlays, the mix. */
export function sameCut(a?: Timeline, b?: Timeline) {
  const key = (tl?: Timeline) => tl && JSON.stringify([
    tl.width, tl.height, tl.fps, tl.demo,
    tl.items.map(i => (i.kind === 'media' ? ['m', i.src, round(i.in), round(i.out), i.db || 0, !!i.muted, i.framing] : ['c', i.clip, round(i.dur)])),
    (tl.overlays || []).map(o => [o.clip, round(o.start), round(o.dur)]),
    tl.mix && (tl.mix.filmDb || tl.mix.music || tl.mix.voiceovers?.length) ? tl.mix : null,
  ])
  return key(a) === key(b)
}

/** Lay a clip over the film from start for dur seconds (kept inside the film). */
export function addOverlay(tl: Timeline, o: Omit<Overlay, 'id'>): Timeline {
  const total = duration(tl)
  const start = round(Math.min(Math.max(0, o.start), total))
  const dur = round(Math.max(0, Math.min(o.dur, total - start)))
  return { ...tl, overlays: [...(tl.overlays || []), { ...o, id: newId(), start, dur }] }
}

export const removeOverlay = (tl: Timeline, id: string): Timeline => ({ ...tl, overlays: (tl.overlays || []).filter(o => o.id !== id) })

const A_NORM = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'

/**
 * A piece's sound, from a to b of input k's audio: 48 kHz stereo at the piece's level, with 10 ms fades where pieces
 * meet (so a cut never clicks). Shared by the full render and the fast one for cuts (main/cuts.ts).
 */
export function soundOf(k: number, it: Item, a: number, b: number, fades: boolean, label: string) {
  const len = round(b - a)
  const level = it.kind === 'media' && it.muted ? ',volume=0' : it.kind === 'media' && it.db ? `,volume=${it.db}dB` : ''
  const fade = fades ? `,afade=t=in:d=0.01,afade=t=out:st=${round(Math.max(0, len - 0.01))}:d=0.01` : ''
  // Preserve the source's audio/video start offset. STARTPTS would pull a late microphone earlier at each cut.
  // Reset to the planned segment start, then synthesize only the missing leading/trailing samples.
  return `[${k}:a]atrim=start=${round(a)}:end=${round(b)},asetpts=PTS-${round(a)}/TB,aresample=48000:async=1:first_pts=0,${A_NORM},apad,atrim=duration=${len}${fade}${level}[${label}]`
}

/**
 * One ffmpeg command for the whole timeline: every item scaled/padded to the timeline's size and rate, with a stereo
 * 48 kHz track (silence for items without audio), then concatenated. Paths are as the caller gives them (usually
 * project-relative, run with cwd = project folder).
 */
export function composeArgs(tl: Timeline, o: { inputOf(i: Item): string; hasAudio(i: Item): boolean; overlayOf?(ov: Overlay): string; out: string }): string[] {
  const { width: W, height: H, fps } = tl
  const inputs: string[] = []
  const inputIndex = (path: string) => { let k = inputs.indexOf(path); if (k < 0) { inputs.push(path); k = inputs.length - 1 } return k }
  const parts: string[] = []
  const norm = `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
  tl.items.forEach((it, n) => {
    const k = inputIndex(o.inputOf(it))
    const len = round(length(it))
    const [a, b] = it.kind === 'media' ? [it.in, it.out] : [0, it.dur]
    const demo = it.kind === 'media' && it.src === tl.demo?.screen ? tl.demo : undefined
    const cam = demo && cameraRange(demo, a, b)
    const showCamera = demo && cam && !demo.layout.hidden
    const videoLabel = showCamera ? `screen${n}` : `v${n}`
    const screenLabel = `${videoLabel}bounded`
    if (it.kind === 'media' && it.framing) {
      parts.push(`[${k}:v]trim=start=${round(a)}:end=${round(b)},setpts=PTS-STARTPTS,fps=${fps}[raw${n}]`)
      parts.push(...framingGraph(`raw${n}`, screenLabel, W, H, fps, len, it.framing))
    } else parts.push(`[${k}:v]trim=start=${round(a)}:end=${round(b)},setpts=PTS-STARTPTS,${norm}[${screenLabel}]`)
    parts.push(`[${screenLabel}]trim=duration=${len},setpts=PTS-STARTPTS[${videoLabel}]`)
    if (showCamera) {
      const ck = inputIndex(demo.camera), l = demo.layout
      const crop = l.crop ? `crop=iw*${l.crop.w}:ih*${l.crop.h}:iw*${l.crop.x}:ih*${l.crop.y},` : ''
      const alpha = l.shape === 'circle' ? `,geq=r='if(gte(hypot(X-W/2,Y-H/2),min(W,H)/2-${l.border}),255,r(X,Y))':g='if(gte(hypot(X-W/2,Y-H/2),min(W,H)/2-${l.border}),255,g(X,Y))':b='if(gte(hypot(X-W/2,Y-H/2),min(W,H)/2-${l.border}),255,b(X,Y))':a='if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2,2)),255,0)'`
        : l.shape === 'rounded' ? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lte(pow(max(abs(X-W/2)-(W/2-16),0),2)+pow(max(abs(Y-H/2)-(H/2-16),0),2),256),255,0)'` : ''
      parts.push(`[${ck}:v]trim=start=${cam.in}:end=${cam.out},setpts=${demo.sync.rate}*(PTS-STARTPTS),${crop}setsar=1,fps=${fps}[craw${n}]`)
      parts.push(...framingGraph(`craw${n}`, `cframed${n}`, l.width, l.height, fps, cam.e - cam.s, l.framing || framing({}, 'cover')))
      parts.push(`[cframed${n}]setpts=PTS-STARTPTS+${cam.s - a}/TB,format=rgba${l.border && l.shape !== 'circle' ? `,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.85:t=${l.border}` : ''}${alpha}[cam${n}]`)
      parts.push(`[screen${n}][cam${n}]overlay=x=${l.x}:y=${l.y}:eof_action=pass:repeatlast=0:enable='gte(t,${cam.s - a})*lt(t,${cam.e - a})',format=yuv420p[v${n}]`)
    }
    if (demo?.audio === 'camera' && cam) {
      const ck = inputIndex(demo.camera), offset = cam.s - a
      const level = it.kind === 'media' && it.muted ? ',volume=0' : it.kind === 'media' && it.db ? `,volume=${it.db}dB` : ''
      const cameraLabel = o.hasAudio(it) && (cam.s > a || cam.e < b) ? `ca${n}` : `a${n}`
      // adelay emits leading silence before it receives an input frame; its PTS can be unset depending on graph
      // scheduling. Re-clock all emitted samples (including that silence) before mixing against the screen audio.
      parts.push(`[${ck}:a]atrim=start=${cam.in}:end=${cam.out},asetpts=PTS-STARTPTS,atempo=${1 / demo.sync.rate},${A_NORM}${level},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, cam.e - cam.s - 0.01)}:d=0.01,adelay=${Math.round(offset * 1000)}:all=1,asetpts=N/SR/TB,apad,atrim=0:${len}[${cameraLabel}]`)
      if (cameraLabel !== `a${n}`) {
        parts.push(soundOf(k, it, a, b, true, `fallback${n}`))
        parts.push(`[fallback${n}]volume=0:enable='gte(t,${offset})*lt(t,${cam.e - a})'[outside${n}]`)
        parts.push(`[outside${n}][ca${n}]amix=inputs=2:duration=first:normalize=0[a${n}]`)
      }
    } else parts.push(o.hasAudio(it) ? soundOf(k, it, a, b, tl.items.length > 1, `a${n}`) : `anullsrc=r=48000:cl=stereo,atrim=0:${len},${A_NORM}[a${n}]`)
  })
  parts.push(`${tl.items.map((_, n) => `[v${n}][a${n}]`).join('')}concat=n=${tl.items.length}:v=1:a=1[v][a]`)
  // overlays on top, each shifted to its start and shown only during its time; the footage shows through transparency
  let video = 'v'
  ;(tl.overlays || []).forEach((ov, n) => {
    if (!o.overlayOf) return
    const k = inputIndex(o.overlayOf(ov))
    parts.push(`[${k}:v]scale=${W}:${H},format=yuva420p,setpts=PTS-STARTPTS+${round(ov.start)}/TB[ov${n}]`)
    parts.push(`[${video}][ov${n}]overlay=eof_action=pass:enable='between(t,${round(ov.start)},${round(ov.start + ov.dur)})',format=yuv420p[vo${n + 1}]`)
    video = `vo${n + 1}`
  })
  return [
    ...inputs.flatMap(p => ['-i', p]),
    '-filter_complex', parts.join(';'),
    '-map', `[${video}]`, '-map', '[a]',
    '-c:v', 'libx264', '-crf', tl.demo ? '16' : '18', '-preset', tl.demo ? 'medium' : 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    o.out,
  ]
}
