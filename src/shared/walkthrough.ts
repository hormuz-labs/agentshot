// A product walkthrough: one continuous take of a browser tab (its CDP screencast plus what happened on the page:
// clicks, typing, scrolling, page loads) condensed to the moments that matter and paced to its narration. Pure: the
// plan, the cursor and zoom tracks and the per-frame ffmpeg commands that draw them (src/main/walkthrough.ts renders).
//
// Times on a Take are seconds of its video. Positions on events are CSS pixels of the page's viewport; everything the
// plan returns is in pixels of the take's video (cursor, zoom, clicks) and seconds of the output (the condensed film).
import { mergeRanges, type TimeRange } from './demo'

export type TakeEventKind = 'move' | 'down' | 'click' | 'key' | 'input' | 'focus' | 'wheel' | 'scroll' | 'nav'
/** x, y, width, height */
export type Rect = [number, number, number, number]
export type TakeEvent = { t: number; k: TakeEventKind; x?: number; y?: number; r?: Rect }
export type TakeStep = { t: number; title: string }
export type Take = {
  id: string
  /** project-relative path of the recording */
  video: string
  duration: number
  /** the recording's pixels and frame rate */
  width: number; height: number; fps: number
  /** the page's viewport in CSS pixels (events are in these) */
  viewport: { width: number; height: number }
  steps: TakeStep[]
  events: TakeEvent[]
  /** stretches recorded while paused (sign-ins, private pages): never in the film */
  paused: TimeRange[]
  browser: 'manul' | 'chrome'
  url?: string
  startedAt: number
}

export type Pace = 'natural' | 'tight'
/** Source s–e at speed, after `pre` seconds of its first frame and before `hold` seconds of its last. */
export type Segment = { s: number; e: number; speed: number; pre: number; hold: number }
/** index: the step's place in the take (steps can be skipped) */
export type PlannedStep = { index: number; title: string; start: number; end: number; narration?: { at: number; dur: number } }
/** glide: eased from the key before (a synthesized move); otherwise the cursor jumps here at t (a recorded move). */
export type CursorKey = { t: number; x: number; y: number; glide: boolean }
export type ZoomKey = { t: number; z: number; cx: number; cy: number }
export type Click = { t: number; x: number; y: number }
export type WalkPlan = {
  segments: Segment[]; duration: number; steps: PlannedStep[]
  cursor: CursorKey[]; zoom: ZoomKey[]; clicks: Click[]
  /** seconds of the take left out (idle, paused), sped through (loading), and frozen to let narration finish */
  cut: number; spedUp: number; held: number
}
/** skip: step indexes (0-based) left out of the film, e.g. a step that went wrong and was done again */
export type PlanOptions = { pace?: Pace; zoom?: boolean; maxZoom?: number; skip?: number[] }

const PACE = {
  natural: { lead: 0.45, after: 0.9, gap: 0.7, idle: 1.0, passive: 2.5, passiveTo: 1.5, tail: 0.7 },
  tight: { lead: 0.3, after: 0.6, gap: 0.4, idle: 0.7, passive: 1.5, passiveTo: 0.8, tail: 0.45 },
}
const POINTER: TakeEventKind[] = ['move', 'down', 'click', 'wheel']
const ACTIONS: TakeEventKind[] = ['down', 'click', 'key', 'input', 'focus']
/** Narration starts this far into its step. */
export const NARRATION_LEAD = 0.3
const MAX_SPEED = 8
const round = (t: number) => Math.round(t * 1000) / 1000
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
export const ease = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2)

/** Whether a request with no footage asks for a product walkthrough (AgentShot films the product in a browser) rather than
 *  a motion video: a walkthrough, demo or tour of a site or app, unless it asks for animation. */
export function wantsWalkthrough(prompt: string) {
  const p = prompt.toLowerCase()
  if (/\b(motion|animated|animation|kinetic|explainer|logo reveal|3d)\b/.test(p)) return false
  if (/\b(walk-?\s?through|product (demo|tour|video)|screen ?cast)\b/.test(p)) return true
  const kind = /\b(demo|tour|tutorial|how-?to|onboarding video|show (me |people |users |viewers )?how)\b/.test(p)
  const product = /https?:\/\/|\b[a-z0-9-]+\.(com|io|app|ai|dev|so|co|net|org|xyz|tech|site|cloud|sh)\b|\b(my|our|the|this|a) (web ?app|app|site|website|product|dashboard|saas|tool)\b/.test(p)
  return kind && product
}

/** Seconds as a whole number of frames. */
const frames = (t: number, fps: number) => Math.round(t * fps) / fps
/** A segment that renders to a whole number of frames, so the film's times are the plan's times. */
function onGrid(g: Segment, fps: number): Segment {
  const s = frames(g.s, fps), speed = round(g.speed)
  const out = Math.max(1, Math.round(((g.e - g.s) / speed) * fps)) / fps
  return { s, e: round(s + out * speed), speed, pre: frames(g.pre, fps), hold: frames(g.hold, fps) }
}

/** What is left of ranges after taking out others. */
export function subtract(ranges: TimeRange[], out: TimeRange[]): TimeRange[] {
  let left = ranges.map(r => ({ ...r }))
  for (const o of mergeRanges(out)) {
    left = left.flatMap(r => (o.e <= r.s || o.s >= r.e ? [r] : [...(o.s > r.s ? [{ s: r.s, e: o.s }] : []), ...(o.e < r.e ? [{ s: o.e, e: r.e }] : [])]))
  }
  return left.filter(r => r.e - r.s > 1e-3)
}

/** Each step's stretch of the take: from its mark to the next (no steps: the whole take as one). */
export function stepRanges(take: Take): (TimeRange & { title: string })[] {
  const steps = [...take.steps].filter(s => s.t >= 0 && s.t < take.duration).sort((a, b) => a.t - b.t)
  if (!steps.length) return [{ s: 0, e: take.duration, title: '' }]
  return steps.map((s, i) => ({ s: s.t, e: steps[i + 1]?.t ?? take.duration, title: s.title }))
}

/** Where a moment of the take plays in the film, or null when the plan leaves it out. */
export function outTime(segments: Segment[], t: number): number | null {
  let at = 0
  for (const g of segments) {
    const start = at + g.pre
    if (t >= g.s - 1e-6 && t <= g.e + 1e-6) return round(start + (Math.min(t, g.e) - g.s) / g.speed)
    at = start + (g.e - g.s) / g.speed + g.hold
  }
  return null
}

export const filmLength = (segments: Segment[]) => round(segments.reduce((s, g) => s + g.pre + (g.e - g.s) / g.speed + g.hold, 0))

/**
 * Condense the take: per step, keep what happened (actions with a little lead-in and the result after, loads and
 * animations, sped up when long and nothing was done), drop the idle time between (the agent thinking), then make the
 * step long enough for its narration (narration[i], seconds) by holding its first frame (the voice leads the action
 * while the cursor glides to it) and its last (the voice finishes over the result).
 */
export function planWalkthrough(take: Take, active: TimeRange[], narration: (number | undefined)[], o: PlanOptions = {}): WalkPlan {
  const pace = PACE[o.pace || 'natural']
  const segments: Segment[] = [], steps: PlannedStep[] = []
  let spedUp = 0, held = 0
  const skipped = stepRanges(take).filter((_, i) => o.skip?.includes(i))
  const paused = [...take.paused, ...skipped]
  stepRanges(take).forEach((range, i) => {
    if (o.skip?.includes(i)) return
    const { s: a, e: b } = range
    const ev = take.events.filter(e => e.t >= a && e.t < b)
    const marks = mergeRanges(ev.map(e => e.k === 'move' ? { s: e.t - 0.1, e: e.t + 0.25 }
      : e.k === 'scroll' || e.k === 'wheel' ? { s: e.t - 0.15, e: e.t + 0.5 }
      : { s: e.t - pace.lead, e: e.t + pace.after }))
    const clip = (r: TimeRange) => ({ s: Math.max(a, r.s), e: Math.min(b, r.e) })
    let kept = subtract(mergeRanges([...marks, ...active].map(clip), pace.gap), paused)
    if (!kept.length) kept = subtract([{ s: a, e: Math.min(b, a + pace.idle) }], paused)
    if (!kept.length) return // the whole step was paused
    // leave the result on screen a moment before the next step
    const last = kept.at(-1)!
    last.e = Math.min(b, last.e + pace.tail)
    const pieces: Segment[] = []
    for (const k of kept) {
      // within a kept stretch, the parts where nothing was done (loading, an animation playing out) play faster when long
      const idle = subtract([k], marks)
      let at = k.s
      for (const r of [...idle, { s: k.e, e: k.e }]) {
        if (r.s > at) pieces.push({ s: at, e: r.s, speed: 1, pre: 0, hold: 0 })
        const len = r.e - r.s
        if (len > pace.passive) {
          const speed = Math.min(MAX_SPEED, len / pace.passiveTo)
          pieces.push({ s: r.s, e: r.e, speed, pre: 0, hold: 0 })
          spedUp += len - len / speed
        } else if (len > 0) pieces.push({ s: r.s, e: r.e, speed: 1, pre: 0, hold: 0 })
        at = r.e
      }
    }
    const merged = pieces.reduce<Segment[]>((acc, g) => {
      const p = acc.at(-1)
      if (p && p.speed === 1 && g.speed === 1 && Math.abs(p.e - g.s) < 1e-3) p.e = g.e
      else acc.push({ ...g })
      return acc
    }, []).map(g => onGrid(g, take.fps)).filter(g => g.e - g.s > 1e-3)
    if (!merged.length) return
    const n = narration[i] || 0
    // the voice leads the first action: hold the opening frame while it starts (and the cursor travels)
    const firstAction = ev.find(e => ACTIONS.includes(e.k))
    const preroll = n ? clamp(n * 0.3, 0.6, 1.6) : 0
    if (firstAction && preroll) {
      const into = (Math.max(firstAction.t, merged[0].s) - merged[0].s) / merged[0].speed
      merged[0].pre = frames(Math.max(0, preroll - into), take.fps)
    }
    const len = filmLength(merged)
    const need = n ? NARRATION_LEAD + n + 0.6 : 0
    if (need > len) merged.at(-1)!.hold = frames(need - len + 0.5 / take.fps, take.fps)
    held += merged[0].pre + merged.at(-1)!.hold
    const start = filmLength(segments)
    segments.push(...merged)
    steps.push({ index: i, title: range.title, start, end: filmLength(segments), ...(n ? { narration: { at: round(start + NARRATION_LEAD), dur: n } } : {}) })
  })
  const kept = segments.reduce((s, g) => s + g.e - g.s, 0)
  const tracks = tracksOf(take, segments, o)
  return { segments, duration: filmLength(segments), steps, ...tracks, cut: round(take.duration - kept), spedUp: round(spedUp), held: round(held) }
}

/** An event's point in the take's video pixels: the pointer, else the middle of its element. */
function pointOf(take: Take, e: TakeEvent): { x: number; y: number } | null {
  const sx = take.width / take.viewport.width, sy = take.height / take.viewport.height
  const real = e.x != null && e.y != null && (e.x !== 0 || e.y !== 0) // element.click() reports 0,0
  if (real) return { x: e.x! * sx, y: e.y! * sy }
  if (e.r && e.r[2] > 0 && e.r[3] > 0) return { x: (e.r[0] + e.r[2] / 2) * sx, y: (e.r[1] + e.r[3] / 2) * sy }
  return null
}

/** The box an action draws attention to, in video pixels: its element when that is small, else around the pointer. */
function focusOf(take: Take, e: TakeEvent): Rect | null {
  const sx = take.width / take.viewport.width, sy = take.height / take.viewport.height
  if (e.r && e.r[2] > 0 && e.r[3] > 0 && e.r[2] * e.r[3] < 0.2 * take.viewport.width * take.viewport.height) {
    const [x, y, w, h] = e.r
    const x0 = clamp(x, 0, take.viewport.width), y0 = clamp(y, 0, take.viewport.height)
    const x1 = clamp(x + w, 0, take.viewport.width), y1 = clamp(y + h, 0, take.viewport.height)
    if (x1 > x0 && y1 > y0) return [x0 * sx, y0 * sy, (x1 - x0) * sx, (y1 - y0) * sy]
  }
  const p = pointOf(take, e)
  return p ? [p.x - take.width * 0.08, p.y - take.height * 0.08, take.width * 0.16, take.height * 0.16] : null
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1])
  return [x, y, Math.max(a[0] + a[2], b[0] + b[2]) - x, Math.max(a[1] + a[3], b[1] + b[3]) - y]
}

function tracksOf(take: Take, segments: Segment[], o: PlanOptions) {
  const W = take.width, H = take.height
  const timed = take.events.map(e => ({ e, T: outTime(segments, e.t) })).filter((x): x is { e: TakeEvent; T: number } => x.T != null).sort((a, b) => a.T - b.T)

  // cursor: synthesized glides into each click (the screencast has no pointer, and an agent's clicks have no moves)
  const cursor: CursorKey[] = [{ t: 0, x: W / 2, y: H * 0.62, glide: false }]
  const clicks: Click[] = []
  let lastDown = -Infinity
  for (const { e, T } of timed) {
    if (!POINTER.includes(e.k)) continue
    const p = pointOf(take, e)
    if (!p) continue
    if (e.k === 'click' && T - lastDown < 0.4) continue // the click that ends a press already drawn
    const prev = cursor.at(-1)!
    if (e.k === 'move') { if (T > prev.t) cursor.push({ t: T, ...p, glide: false }); continue }
    const dist = Math.hypot(p.x - prev.x, p.y - prev.y)
    if (dist > 2) {
      const arrive = Math.max(prev.t, T - 0.06)
      const travel = clamp(0.25 + dist / (W * 1.4), 0.3, 0.8)
      const leave = Math.max(prev.t, arrive - travel)
      if (leave > prev.t) cursor.push({ t: leave, x: prev.x, y: prev.y, glide: false })
      cursor.push({ t: Math.max(leave + 0.01, arrive), ...p, glide: true })
    }
    if (e.k === 'down' || e.k === 'click') { clicks.push({ t: T, ...p }); if (e.k === 'down') lastDown = T }
  }

  // zoom: in on clusters of nearby actions, out for scrolls and page loads (and between steps that are far apart)
  const zoom: ZoomKey[] = [{ t: 0, z: 1, cx: W / 2, cy: H / 2 }]
  if (o.zoom !== false) {
    const maxZ = clamp(o.maxZoom ?? 1.8, 1, 3)
    const zoomFor = (r: Rect) => Math.min(maxZ, W / (r[2] + W * 0.16), H / (r[3] + H * 0.16))
    const breaks = timed.filter(x => x.e.k === 'scroll' || x.e.k === 'wheel' || x.e.k === 'nav').map(x => x.T)
    type Cluster = { first: number; last: number; box: Rect }
    const clusters: Cluster[] = []
    let cur: Cluster | null = null
    for (const { e, T } of timed) {
      if (!ACTIONS.includes(e.k)) continue
      const box = focusOf(take, e)
      if (!box) continue
      const broken = cur && breaks.some(b => b > cur!.last && b < T)
      if (cur && !broken && T - cur.last < 3 && zoomFor(union(cur.box, box)) >= 1.3) { cur.last = T; cur.box = union(cur.box, box); continue }
      if (cur) clusters.push(cur)
      cur = { first: T, last: T, box }
    }
    if (cur) clusters.push(cur)
    const TR = 0.7
    const holds = clusters.map(c => {
      const before = Math.max(-Infinity, ...breaks.filter(b => b <= c.first))
      const after = Math.min(Infinity, ...breaks.filter(b => b > c.last))
      // transitions finish before a scroll or load and start after one
      return { from: Math.max(c.first - 0.9, before + 0.2 + TR), to: Math.min(c.last + 1.4, after - 0.1 - TR), z: zoomFor(c.box), cx: c.box[0] + c.box[2] / 2, cy: c.box[1] + c.box[3] / 2 }
    }).filter(h => h.z >= 1.3 && h.to - h.from > 0.6)
    holds.forEach((h, i) => {
      const prev = zoom.at(-1)!
      const z = round(h.z), half = { w: W / z / 2, h: H / z / 2 }
      const state = { z, cx: round(clamp(h.cx, half.w, W - half.w)), cy: round(clamp(h.cy, half.h, H - half.h)) }
      const begin = Math.max(prev.t, h.from - TR)
      if (begin > prev.t) zoom.push({ ...prev, t: round(begin) })
      zoom.push({ t: round(Math.max(begin + 0.25, h.from)), ...state })
      if (h.to > zoom.at(-1)!.t) zoom.push({ t: round(h.to), ...state })
      const next = holds[i + 1]
      if (!next || next.from - TR - h.to > TR * 1.5) zoom.push({ t: round(zoom.at(-1)!.t + TR), z: 1, cx: W / 2, cy: H / 2 })
    })
  }
  return { cursor, zoom, clicks }
}

/** Interpolate keys at t (eased); before the first key, the first; after the last, the last. */
function at<K extends { t: number }>(keys: K[], t: number, mix: (a: K, b: K, p: number) => K, glide: (b: K) => boolean = () => true): K {
  if (t <= keys[0].t) return keys[0]
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i]
    if (t < b.t) return glide(b) ? mix(a, b, ease((t - a.t) / (b.t - a.t))) : a
  }
  return keys.at(-1)!
}
export const cursorAt = (keys: CursorKey[], t: number) =>
  at(keys, t, (a, b, p) => ({ t, x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, glide: true }), k => k.glide)
export const zoomAt = (keys: ZoomKey[], t: number) =>
  at(keys, t, (a, b, p) => ({ t, z: a.z + (b.z - a.z) * p, cx: a.cx + (b.cx - a.cx) * p, cy: a.cy + (b.cy - a.cy) * p }))

/** The part of the take's frame on screen at t (zoom), in its pixels. */
export function cropAt(keys: ZoomKey[], t: number, W: number, H: number) {
  const k = zoomAt(keys, t), z = Math.max(1, k.z)
  const w = Math.round(W / z), h = Math.round(H / z)
  return { w, h, x: Math.round(clamp(k.cx - w / 2, 0, W - w)), y: Math.round(clamp(k.cy - h / 2, 0, H - h)) }
}

export type DrawOptions = {
  /** the take's frame */ width: number; height: number
  /** the film's frame */ outWidth: number; outHeight: number; fps: number
  cursor?: { hotX: number; hotY: number } | null
  ripple?: { size: number; dur: number } | null
}

/**
 * sendcmd lines that draw the plan frame by frame: crop@zoom (the zoom, in take pixels), overlay@cursor and
 * overlay@ripple (positions in film pixels, after the zoom). Only changes are written.
 */
export function drawCommands(plan: Pick<WalkPlan, 'duration' | 'cursor' | 'zoom' | 'clicks'>, o: DrawOptions): string {
  const lines: string[] = []
  let last: Record<string, number> = {}
  const frames = Math.ceil(plan.duration * o.fps)
  for (let f = 0; f <= frames; f++) {
    const t = f / o.fps
    const c = cropAt(plan.zoom, t, o.width, o.height)
    const kx = o.outWidth / c.w, ky = o.outHeight / c.h
    const want: Record<string, number> = { 'crop@zoom w': c.w, 'crop@zoom h': c.h, 'crop@zoom x': c.x, 'crop@zoom y': c.y }
    if (o.cursor) {
      const p = cursorAt(plan.cursor, t)
      want['overlay@cursor x'] = Math.round((p.x - c.x) * kx - o.cursor.hotX)
      want['overlay@cursor y'] = Math.round((p.y - c.y) * ky - o.cursor.hotY)
    }
    if (o.ripple) {
      const click = [...plan.clicks].reverse().find(k => k.t <= t + 1e-6 && t < k.t + o.ripple!.dur)
      if (click) {
        want['overlay@ripple x'] = Math.round((click.x - c.x) * kx - o.ripple.size / 2)
        want['overlay@ripple y'] = Math.round((click.y - c.y) * ky - o.ripple.size / 2)
      }
    }
    const parts = Object.entries(want).filter(([k, v]) => last[k] !== v).map(([k, v]) => `${k} ${v}`)
    if (parts.length) lines.push(`${t.toFixed(4)} ${parts.join(', ')};`)
    last = { ...last, ...want }
  }
  return lines.join('\n') + '\n'
}

/**
 * The ripple layer as an ffconcat list: a transparent frame between clicks and the ripple's frames from each click
 * (cut short when the next click comes first). Every file is in the same folder as the list.
 */
export function rippleTrack(clicks: Click[], duration: number, o: { fps: number; frames: number; blank: string; frame: (i: number) => string }): string {
  const out: string[] = ['ffconcat version 1.0']
  const add = (file: string, d: number) => { if (d > 1e-4) out.push(`file '${file}'`, `duration ${d.toFixed(4)}`) }
  let at = 0
  const times = [...new Set(clicks.map(c => Math.round(c.t * o.fps) / o.fps))].sort((a, b) => a - b).filter(t => t < duration)
  times.forEach((t, i) => {
    add(o.blank, t - at)
    const end = Math.min(t + o.frames / o.fps, times[i + 1] ?? Infinity, duration)
    for (let f = 0; t + f / o.fps < end - 1e-6; f++) add(o.frame(f), Math.min(1 / o.fps, end - (t + f / o.fps)))
    at = end
  })
  add(o.blank, Math.max(1 / o.fps, duration - at))
  out.push(`file '${o.blank}'`) // the concat demuxer drops the last entry's duration
  return out.join('\n') + '\n'
}

/** A line per step for the agent: where it plays, how long it is, its narration. */
export function describePlan(plan: WalkPlan) {
  const f = (s: number) => s.toFixed(1)
  return plan.steps.map((s, i) => `${i + 1}. ${f(s.start)}–${f(s.end)} s${s.title ? ` · ${s.title}` : ''}${s.narration ? ` · voice ${f(s.narration.dur)} s at ${f(s.narration.at)} s` : ''}`)
}
