// A demo's camera is linked to moments of the original screen file, never to the flattened render.
import type { Box } from './types'
import type { Timeline } from './timeline'
import { framing, placedVideo, type VideoFraming } from './framing'

export type SyncAnchor = { camera: number; screen: number; score: number }
export type MediaSync = { offset: number; rate: number; confidence: number; reliable: boolean; anchors: SyncAnchor[]; residual: number; overlap: [number, number]; method: string }
export type CameraShape = 'circle' | 'square' | 'rectangle' | 'rounded'
export type CameraCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'
export type CameraLayout = { shape: CameraShape; x: number; y: number; width: number; height: number; border: number; crop?: Box | null; hidden?: boolean; framing?: VideoFraming }
/** Remove a legacy source crop without changing the visible framing; the entire source becomes available to pan. */
export function fullSourceLayout(l: CameraLayout, sourceW: number, sourceH: number): Partial<CameraLayout> {
  if (!l.crop || !sourceW || !sourceH) return { crop: null }
  const c = l.crop, f = l.framing || framing({}, 'cover')
  const old = placedVideo(sourceW * c.w, sourceH * c.h, l.width, l.height, f)
  const scale = old.width / (sourceW * c.w), base = placedVideo(sourceW, sourceH, l.width, l.height, framing({}, f.fit))
  const width = sourceW * scale, height = sourceH * scale
  return { crop: null, framing: framing({ fit: f.fit, zoom: width / base.width,
    x: (old.left - c.x * width - (l.width - width) / 2) / l.width,
    y: (old.top - c.y * height - (l.height - height) / 2) / l.height }, 'cover') }
}
export type Demo = { screen: string; camera: string; cameraDuration: number; sync: MediaSync; layout: CameraLayout; audio: 'screen' | 'camera'; warning?: string; summary?: DemoSummary }
export type DemoSummary = { removed: number; staleRemoved: number; coverageRemoved: number; original: number; final: number; message: string; cleanup?: 'none' | 'natural' | 'tight'; additionalTrimmed?: number }
/** Subsequent edits must not retain an obsolete final duration or claim that user cuts were automatic stale detection. */
export function refreshDemoSummary(d: Demo, final: number): Demo {
  const s = d.summary
  if (!s || Math.abs(s.final - final) < 0.05) return d
  const updated = demoSummary(s.original, final, s.staleRemoved, s.coverageRemoved, s.cleanup)
  const additionalTrimmed = Math.max(0, Math.round((s.original - final - s.staleRemoved - s.coverageRemoved) * 10) / 10)
  if (additionalTrimmed) updated.message += ` Also trimmed ${additionalTrimmed} seconds in subsequent timeline edits.`
  return { ...d, summary: { ...updated, additionalTrimmed } }
}
export function demoSummary(original: number, final: number, staleRemoved: number, coverageRemoved = 0, cleanup?: DemoSummary['cleanup']): DemoSummary {
  const r = (n: number) => Math.max(0, Math.round(n * 10) / 10)
  const stale = r(staleRemoved), coverage = r(coverageRemoved)
  const message = cleanup === 'none' ? 'Dead-time cleanup was skipped because Keep everything was selected.'
    : stale > 0 ? `We removed ${stale} seconds of stale footage (dead time), keeping your speech and screen actions.` : 'No clearly idle stretches were found by the cleanup analysis; your speech and screen actions were preserved.'
  return { original: r(original), final: r(final), removed: r(original - final), staleRemoved: stale, coverageRemoved: coverage, cleanup, message: message + (coverage ? ` Also removed ${coverage} seconds outside the shared recording coverage.` : '') }
}
export type DemoRequest = { screen: string; camera: string; sync?: MediaSync; layout?: Partial<CameraLayout>; corner?: CameraCorner; audio?: 'screen' | 'camera'; cleanup?: 'none' | 'natural' | 'tight'; overlapOnly?: boolean }
export type TimeRange = { s: number; e: number }

/** Human-facing labels and agent retries normalize to the same three editing modes. */
export function demoCleanup(value?: string): 'none' | 'natural' | 'tight' {
  if (!value) return 'natural'
  const mode = value.trim().toLowerCase().replace(/[ _]+/g, '-')
  if (['none', 'keep-all', 'keep-everything', 'off'].includes(mode)) return 'none'
  if (mode === 'natural' || mode === 'tight') return mode
  throw new Error('cleanup must be "natural", "tight", or "none" (keep everything).')
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
export function cameraLayout(W: number, H: number, patch: Partial<CameraLayout> = {}, corner: CameraCorner = 'top-right'): CameraLayout {
  for (const key of ['width', 'height', 'x', 'y', 'border'] as const) if (patch[key] != null && !Number.isFinite(patch[key])) throw new Error('Camera layout values must be finite numbers.')
  if (patch.shape && !['circle', 'square', 'rectangle', 'rounded'].includes(patch.shape)) throw new Error('Choose a supported camera shape.')
  if (patch.crop && (!Object.values(patch.crop).every(Number.isFinite) || patch.crop.x < 0 || patch.crop.y < 0 || patch.crop.w <= 0 || patch.crop.h <= 0 || patch.crop.x + patch.crop.w > 1.001 || patch.crop.y + patch.crop.h > 1.001)) throw new Error('The camera crop must fit inside its source frame.')
  const shape = patch.shape || 'circle'
  const width = Math.min(W, even(patch.width ?? W * 0.2))
  let height = Math.min(H, even(shape === 'circle' || shape === 'square' ? width : patch.height ?? width * 9 / 16))
  // A circle/square must remain square even on a narrow output.
  const w = shape === 'circle' || shape === 'square' ? Math.min(width, height) : width
  if (shape === 'circle' || shape === 'square') height = w
  const margin = Math.round(Math.min(W, H) * 0.03)
  const x = patch.x ?? (corner.endsWith('right') ? W - w - margin : margin)
  const y = patch.y ?? (corner.startsWith('bottom') ? H - height - margin : margin)
  return { ...patch, ...(patch.framing ? { framing: framing(patch.framing, 'cover') } : {}), shape, width: w, height, x: Math.round(Math.max(0, Math.min(W - w, x))), y: Math.round(Math.max(0, Math.min(H - height, y))), border: Math.max(0, Math.min(12, patch.border ?? 2)) }
}

/** The camera interval that actually exists for a screen interval. */
export function cameraRange(d: Demo, s: number, e: number) {
  const a = Math.max(s, d.sync.offset), b = Math.min(e, d.sync.offset + d.sync.rate * d.cameraDuration)
  if (b - a < 0.001) return null
  return { s: a, e: b, in: Math.max(0, (a - d.sync.offset) / d.sync.rate), out: Math.min(d.cameraDuration, (b - d.sync.offset) / d.sync.rate) }
}

/** Same mapping for live playback and export, including after a ripple cut, reorder or restoration. */
export function cameraAt(tl: Timeline, t: number) {
  const d = tl.demo
  if (!d) return null
  let start = 0
  for (const it of tl.items) {
    const len = it.kind === 'media' ? it.out - it.in : it.dur
    if (t >= start && t < start + len) {
      if (it.kind !== 'media' || it.src !== d.screen) return null
      const s = it.in + t - start, at = (s - d.sync.offset) / d.sync.rate
      return at >= 0 && at < d.cameraDuration ? { at, rate: 1 / d.sync.rate } : null
    }
    start += len
  }
  return null
}

export function mergeRanges(ranges: TimeRange[], gap = 0): TimeRange[] {
  const out: TimeRange[] = []
  for (const r of [...ranges].filter(r => Number.isFinite(r.s) && Number.isFinite(r.e) && r.e > r.s).sort((a, b) => a.s - b.s)) {
    const last = out.at(-1)
    if (last && r.s <= last.e + gap) last.e = Math.max(last.e, r.e)
    else out.push({ ...r })
  }
  return out
}

/** Keep useful activity and narration; shorten only unprotected, jointly idle gaps. */
export function demoCuts(duration: number, speech: TimeRange[], activity: TimeRange[], mode: 'natural' | 'tight'): TimeRange[] {
  const pad = mode === 'natural' ? 0.3 : 0.18, minGap = mode === 'natural' ? 2 : 1.2, retain = mode === 'natural' ? 0.6 : 0.35
  const protectedRanges = mergeRanges([...speech.map(r => ({ s: Math.max(0, r.s - pad), e: Math.min(duration, r.e + pad) })), ...activity.map(r => ({ s: Math.max(0, r.s - 0.4), e: Math.min(duration, r.e + 0.8) }))], retain)
  // No speech or action evidence: never turn a failed analysis into deleting a whole recording.
  if (!protectedRanges.length) return []
  const cuts: TimeRange[] = []
  let end = 0
  for (const r of [...protectedRanges, { s: duration, e: duration }]) {
    if (r.s - end > minGap) {
      const edge = end === 0 || r.s === duration
      cuts.push({ s: end + (end === 0 ? 0 : retain / 2), e: r.s - (r.s === duration ? 0 : retain / 2) })
      if (!edge && cuts.at(-1)!.e <= cuts.at(-1)!.s) cuts.pop()
    }
    end = Math.max(end, r.e)
  }
  return cuts
}

/** A lightweight routing hint: it is evidence of a pair, not a claim about the recordings' roles. */
export function demoHint(files: string[], media: Record<string, { width: number }>, enabled: boolean): string {
  const videos = [...new Set(files)].filter(f => media[f]?.width > 0)
  return enabled && videos.length === 2 ? '\n\n[editor context] Two video recordings are attached. If they are a screen/demo and a separate face-camera recording, read demo-editor and use sync_media + compose_demo. Confirm ambiguous roles; unrelated footage should follow the usual editing workflow.' : ''
}
