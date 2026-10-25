// The same measured, non-destructive demo plan powers the chat tool and the one-click guided UI.
import { cameraLayout, cameraRange, demoCleanup, demoCuts, demoSummary, mergeRanges, type DemoRequest, type MediaSync, type TimeRange } from '../shared/demo'
import { applyEdit, duration, fromMedia, type Timeline } from '../shared/timeline'
import { speechRegions } from '../shared/mix'
import type { Project, Transcript } from '../shared/types'
import { analyzeScreen } from './screen-activity'
import { syncMedia } from './sync'
import { analyze } from './analysis'
import { join } from 'node:path'

export type DemoOptions = Omit<DemoRequest, 'sync'> & { manualOffset?: number }
export type DemoPlan = { timeline: Timeline; sync: MediaSync; cuts: TimeRange[]; removed: number; duration: number; audio: 'screen' | 'camera'; warning?: string }

/** Transcription may be a shared background job; stop waiting immediately without cancelling another consumer. */
function abortable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work
  return new Promise((ok, fail) => {
    const abort = () => fail(signal.reason || new Error('Demo stopped.'))
    signal.addEventListener('abort', abort, { once: true })
    work.then(ok, fail).finally(() => signal.removeEventListener('abort', abort))
    if (signal.aborted) abort()
  })
}

export async function planDemo(p: Project, req: DemoOptions, transcript: (media: string) => Promise<Transcript | null>, signal?: AbortSignal): Promise<DemoPlan> {
  const screen = p.media[req.screen], camera = p.media[req.camera]
  if (!p.files?.[req.screen] || !screen?.width || !p.files?.[req.camera] || !camera?.width || req.screen === req.camera) throw new Error('Choose two different imported video recordings: screen and face camera.')
  const cleanup = demoCleanup(req.cleanup)
  if (req.audio && !['screen', 'camera'].includes(req.audio)) throw new Error('Choose the screen or camera microphone.')
  if (req.manualOffset != null && !Number.isFinite(req.manualOffset)) throw new Error('Manual sync needs a finite offset in seconds.')
  for (const n of Object.values(req.layout || {}).filter(x => typeof x === 'number')) if (!Number.isFinite(n)) throw new Error('Camera dimensions and position must be finite numbers.')
  const sync: MediaSync = req.manualOffset != null ? {
    offset: req.manualOffset, rate: 1, confidence: 1, reliable: true, residual: 0, anchors: [], method: 'manual user alignment',
    overlap: [Math.max(0, req.manualOffset), Math.min(screen.duration, req.manualOffset + camera.duration)],
  } : await syncMedia(p.dir, req.screen, req.camera, signal)
  if (!Number.isFinite(sync.offset) || !Number.isFinite(sync.rate) || sync.rate <= 0 || sync.overlap[1] <= sync.overlap[0]) throw new Error('These recordings have no usable overlap. Check the selected files or matching moments.')
  if (!sync.reliable) throw new Error('The audio match is uncertain. Pick the same spoken word or clap in both videos and give its screen/camera times; AgentShot will use that manual alignment.')
  const audio = req.audio || (screen.hasAudio ? 'screen' : 'camera')
  if (!(audio === 'screen' ? screen : camera).hasAudio) throw new Error(`The ${audio} recording has no audio. Choose the other recording for narration.`)
  const width = Math.max(2, Math.round(screen.width / 2) * 2), height = Math.max(2, Math.round(screen.height / 2) * 2)
  let timeline: Timeline = { ...fromMedia(req.screen, screen.duration, { width, height, fps: screen.fps || 30 }),
    demo: { screen: req.screen, camera: req.camera, cameraDuration: camera.duration, sync, layout: cameraLayout(width, height, req.layout, req.corner), audio } }
  let cuts: TimeRange[] = [], warning: string | undefined
  let staleRanges: TimeRange[] = []
  if (cleanup !== 'none') {
    signal?.throwIfAborted()
    const [activity, t, sound] = await Promise.all([
      analyzeScreen(p.dir, req.screen, signal), abortable(transcript(audio === 'screen' ? req.screen : req.camera), signal),
      analyze(p.dir, join(p.dir, audio === 'screen' ? req.screen : req.camera), signal),
    ])
    signal?.throwIfAborted()
    if (!t) throw new Error('Speech recognition is needed to safely clean the demo. Set up transcription or choose “Keep everything”.')
    const map = (r: TimeRange) => audio === 'camera' ? { s: sync.offset + sync.rate * r.s, e: sync.offset + sync.rate * r.e } : r
    const speech = speechRegions(t).map(([s, e]) => map({ s, e }))
    // A transcript can miss speech; preserve all audible intervals as well. Conservative with noisy recordings.
    const audible: TimeRange[] = []
    let at = 0
    for (const r of [...(sound.audio?.silence || []), { s: sound.info.duration, e: sound.info.duration }]) {
      if (r.s > at) audible.push(map({ s: at, e: r.s }))
      at = Math.max(at, r.e)
    }
    if (audio === 'camera' && screen.hasAudio && !req.overlapOnly) {
      const fallback = await analyze(p.dir, join(p.dir, req.screen), signal)
      let start = 0
      for (const r of [...(fallback.audio?.silence || []), { s: screen.duration, e: screen.duration }]) {
        if (r.s > start) {
          if (start < sync.overlap[0]) audible.push({ s: start, e: Math.min(r.s, sync.overlap[0]) })
          if (r.s > sync.overlap[1]) audible.push({ s: Math.max(start, sync.overlap[1]), e: r.s })
        }
        start = Math.max(start, r.e)
      }
    }
    cuts = demoCuts(screen.duration, [...speech, ...audible], activity.active, cleanup)
    staleRanges = cuts.map(r => ({ ...r }))
    if (!cuts.length) warning = 'No clearly idle stretches were found; narration and screen actions were preserved.'
  }
  if (req.overlapOnly) cuts.push({ s: 0, e: sync.overlap[0] }, { s: sync.overlap[1], e: screen.duration })
  cuts = mergeRanges(cuts)
  // Snap once to the master frame grid. Both sources use this exact shared plan.
  cuts = cuts.map(c => ({ s: Math.ceil(c.s * timeline.fps) / timeline.fps, e: Math.floor(c.e * timeline.fps) / timeline.fps })).filter(c => c.e > c.s)
  for (const c of [...cuts].reverse()) timeline = applyEdit(timeline, { op: 'cut', from: c.s, to: c.e })
  if (audio === 'camera' && !req.overlapOnly) {
    const missing = timeline.items.some(it => it.kind === 'media' && (() => { const cam = cameraRange(timeline.demo!, it.in, it.out); return !cam || cam.s > it.in + 0.01 || cam.e < it.out - 0.01 })())
    if (missing && !screen.hasAudio) warning = 'Some retained screen footage has no camera narration outside the overlap.'
  }
  signal?.throwIfAborted()
  timeline.demo!.warning = warning
  const staleRemoved = staleRanges.reduce((s, r) => s + Math.max(0, Math.floor(r.e * timeline.fps) / timeline.fps - Math.ceil(r.s * timeline.fps) / timeline.fps), 0)
  timeline.demo!.summary = demoSummary(screen.duration, duration(timeline), staleRemoved, Math.max(0, screen.duration - duration(timeline) - staleRemoved), cleanup)
  return { timeline, sync, cuts, removed: screen.duration - duration(timeline), duration: duration(timeline), audio, warning }
}
