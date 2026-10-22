// A sub-frame interval cannot contain eight distinct pictures. Quantize/deduplicate and stop repeated inspections.
export function inspectionTimes(info: { duration: number; fps: number }, args: { times?: number[]; t0?: number; t1?: number; count?: number }) {
  const fps = info.fps > 0 ? info.fps : 30, last = Math.max(0, Math.ceil(info.duration * fps) - 1)
  let requested = args.times?.length ? args.times : []
  if (!requested.length) {
    const a = Math.max(0, Math.min(info.duration, args.t0 ?? 0)), b = Math.max(a, Math.min(info.duration, args.t1 ?? info.duration))
    const n = Math.max(1, Math.min(16, Math.round(args.count ?? 6)))
    requested = Array.from({ length: n }, (_, i) => a + (b - a) * (i + 0.5) / n)
  }
  const frames = [...new Set(requested.slice(0, 16).filter(Number.isFinite).map(t => Math.max(0, Math.min(last, Math.round(t * fps)))))].sort((a, b) => a - b)
  return { times: frames.map(f => f / fps), note: frames.length < requested.length ? `Requested ${requested.length} samples resolve to only ${frames.length} distinct frame-grid positions at ${fps} fps. Smaller time steps cannot add picture information; use transcript word boundaries for speech cuts.` : '' }
}

export class InspectionGuard {
  private sessions = new Map<string, { total: number; seen: Map<string, number>; blocked: number; last?: string; sameRegion: number }>()
  reset(conversation: string) { this.sessions.delete(conversation) }
  inspect(conversation: string, media: string, times: number[], box?: unknown) {
    const s = this.sessions.get(conversation) || { total: 0, seen: new Map<string, number>(), blocked: 0, sameRegion: 0, last: undefined as string | undefined }
    const region = `${media}|${Math.floor((times[0] || 0) / 0.5)}|${JSON.stringify(box || null)}`
    s.sameRegion = region === s.last ? s.sameRegion + 1 : 1; s.last = region
    const key = `${media}|${times.map(t => t.toFixed(4)).join(',')}|${JSON.stringify(box || null)}`
    const repeat = (s.seen.get(key) || 0) + 1
    s.seen.set(key, repeat); s.total++
    const blocked = repeat > 2 || s.sameRegion > 3 || s.total > 16
    if (blocked) s.blocked++
    this.sessions.set(conversation, s)
    return { blocked, stop: s.blocked >= 2, total: s.total }
  }
}
