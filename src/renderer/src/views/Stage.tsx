// The picture: the current (or proposed) version, or the edit playing from its pieces (with the overlays laid over it
// live), notes' boxes while their moment plays, and the box-drawing tool.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { EditPlayer, type Piece, type PlayerLike } from '@/lib/editPlayer'
import type { MixSource } from '@/lib/liveMix'
import type { Box, Note } from '../../../shared/types'
import { cameraAt } from '../../../shared/demo'
import type { CameraLayout } from '../../../shared/demo'
import { sourceAt, type Timeline } from '../../../shared/timeline'
import { framing, placedVideo, type VideoFraming } from '../../../shared/framing'

export type StageHandle = {
  /** what plays: the <video>, or the edit player */
  video: PlayerLike | null
  /** A JPEG of the frame on screen with the box drawn on it (for the agent). */
  still(box?: Box): string | undefined
}

/** An overlay clip laid over the edit while it plays from its pieces: its HTML, live, seeked to the film's time. */
export type LiveOverlay = { id: string; url: string; start: number; dur: number }
/** The edit to play from its pieces (instead of a rendered file). */
export type LiveEdit = { pieces: Piece[]; fps: number; width: number; height: number; overlays: LiveOverlay[]; timeline?: Timeline; cameraUrl?: string }

type Props = {
  src: string
  notes: Note[]
  time: number
  drawing: boolean
  box?: Box
  working: boolean
  onBox(b: Box): void
  onTime(t: number): void
  onDuration(d: number): void
  onPlaying(p: boolean): void
  /** play this edit from its pieces instead of src */
  edit?: LiveEdit | null
  /** what plays, for the live mix (a new one each time the source changes) */
  onSource?(s: MixSource | null): void
  /** a message box to show at the box drawn on the picture (under it, or over it near the bottom) */
  ask?: ReactNode
  cameraEditing?: boolean
  cameraMode?: 'move' | 'frame' | null
  videoEditing?: boolean
  onVideoFraming?(framing: Partial<VideoFraming>): void
  onCameraLayout?(layout: Partial<CameraLayout>): void
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

const sources = new WeakMap<HTMLVideoElement, MixSource>()
const sourceOf = (el: HTMLVideoElement) => { let s = sources.get(el); if (!s) { s = { clock: el, elements: [el] }; sources.set(el, s) } return s }

export const Stage = forwardRef<StageHandle, Props>(function Stage(p, ref) {
  const video = useRef<HTMLVideoElement>(null)
  const frame = useRef<HTMLDivElement>(null)
  const a = useRef<HTMLVideoElement>(null), b = useRef<HTMLVideoElement>(null)
  const camera = useRef<HTMLVideoElement>(null)
  const [cameraSize, setCameraSize] = useState({ width: 0, height: 0 })
  const [sourceSize, setSourceSize] = useState({ width: 0, height: 0 })
  const cameraBox = useRef<HTMLDivElement>(null)
  const cameraDrag = useRef<{ x: number; y: number; layout: CameraLayout; resize: boolean; source: boolean; next?: Partial<CameraLayout> } | null>(null)
  const videoDrag = useRef<{ x: number; y: number; framing: VideoFraming; resize: boolean; next?: VideoFraming } | null>(null)
  const [draftFrame, setDraftFrame] = useState<VideoFraming | null>(null)
  const [draftCameraFrame, setDraftCameraFrame] = useState<VideoFraming | null>(null)
  const [player, setPlayer] = useState<EditPlayer | null>(null)
  const playerRef = useRef<EditPlayer | null>(null)
  playerRef.current = player
  const live = !!p.edit
  const [drag, setDrag] = useState<{ x: number; y: number; box: Box } | null>(null)
  /** the element showing the picture */
  const picture = () => (playerRef.current ? playerRef.current.element : video.current)
  const latest = useRef(p)
  latest.current = p
  // A clock update changes props, not the media element or the audio graph connected to it.
  const setVideo = useCallback((el: HTMLVideoElement | null) => {
    video.current = el
    latest.current.onSource?.(el ? sourceOf(el) : null)
  }, [])

  // the edit, from its pieces: one player while the edit is on screen
  useEffect(() => {
    if (!live || !a.current || !b.current) return
    const pl = new EditPlayer([a.current, b.current], latest.current.edit!.fps)
    const on = (type: string, fn: () => void) => pl.addEventListener(type, fn)
    on('timeupdate', () => latest.current.onTime(pl.currentTime))
    on('seeked', () => latest.current.onTime(pl.currentTime))
    on('durationchange', () => latest.current.onDuration(pl.duration))
    on('play', () => latest.current.onPlaying(true))
    on('pause', () => latest.current.onPlaying(false))
    pl.setPieces(latest.current.edit!.pieces, latest.current.time)
    playerRef.current = pl
    setPlayer(pl)
    latest.current.onSource?.({ clock: pl, elements: pl.elements, gainOf: el => pl.gainOf(el) })
    return () => { latest.current.onSource?.(null); pl.dispose(); playerRef.current = null; setPlayer(null); latest.current.onPlaying(false) }
  }, [live])
  const piecesKey = JSON.stringify(p.edit?.pieces)
  useEffect(() => { if (player && p.edit) player.setPieces(p.edit.pieces) }, [player, piecesKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    get video() { return player || video.current },
    still(box) {
      const v = picture()
      if (!v || !v.videoWidth) return undefined
      const outputW = latest.current.edit?.width || v.videoWidth, outputH = latest.current.edit?.height || v.videoHeight
      const scale = Math.min(1, 1280 / outputW)
      const c = document.createElement('canvas')
      c.width = Math.round(outputW * scale)
      c.height = Math.round(outputH * scale)
      const g = c.getContext('2d')!
      g.fillRect(0, 0, c.width, c.height)
      const it = latest.current.edit?.timeline && sourceAt(latest.current.edit.timeline, playerRef.current?.currentTime || 0)?.item
      const place = placedVideo(v.videoWidth, v.videoHeight, c.width, c.height, it?.kind === 'media' ? it.framing || framing() : framing())
      g.drawImage(v, place.left, place.top, place.width, place.height)
      const demo = latest.current.edit?.timeline?.demo, cam = camera.current
      if (demo && cam?.videoWidth && !demo.layout.hidden && cameraAt(latest.current.edit!.timeline!, playerRef.current?.currentTime || 0)) {
        const l = demo.layout, sx = c.width / latest.current.edit!.width, sy = c.height / latest.current.edit!.height
        g.save(); g.beginPath()
        if (l.shape === 'circle') g.ellipse((l.x + l.width / 2) * sx, (l.y + l.height / 2) * sy, l.width * sx / 2, l.height * sy / 2, 0, 0, Math.PI * 2)
        else g.roundRect(l.x * sx, l.y * sy, l.width * sx, l.height * sy, l.shape === 'rounded' ? 16 * sx : 0)
        g.clip()
        const crop = l.crop || { x: 0, y: 0, w: 1, h: 1 }
        let sw = cam.videoWidth * crop.w, sh = cam.videoHeight * crop.h, x = cam.videoWidth * crop.x, y = cam.videoHeight * crop.y
        const place = placedVideo(sw, sh, l.width * sx, l.height * sy, l.framing || framing({}, 'cover'))
        g.fillRect(l.x * sx, l.y * sy, l.width * sx, l.height * sy)
        g.drawImage(cam, x, y, sw, sh, l.x * sx + place.left, l.y * sy + place.top, place.width, place.height); g.restore()
      }
      if (box) {
        g.strokeStyle = '#f2a541'
        g.lineWidth = Math.max(3, c.width / 300)
        g.strokeRect(box.x * c.width, box.y * c.height, box.w * c.width, box.h * c.height)
      }
      try { return c.toDataURL('image/jpeg', 0.85) } catch { return undefined }
    },
  }))

  // the picture's rectangle inside the letterboxed frame, as 0–1 fractions
  const toPicture = (e: PointerEvent) => {
    const v = picture()!, r = frame.current!.getBoundingClientRect()
    const ar = latest.current.edit ? latest.current.edit.width / latest.current.edit.height : (v.videoWidth || 16) / (v.videoHeight || 9)
    const w = Math.min(r.width, r.height * ar), h = w / ar
    const left = r.left + (r.width - w) / 2, top = r.top + (r.height - h) / 2
    return { x: clamp((e.clientX - left) / w), y: clamp((e.clientY - top) / h), rect: { left: (r.width - w) / 2, top: (r.height - h) / 2, w, h } }
  }

  const [rect, setRect] = useState({ left: 0, top: 0, w: 0, h: 0 })
  const measure = () => {
    const v = picture(), f = frame.current
    if (!v || !f) return
    const r = f.getBoundingClientRect(), ar = latest.current.edit ? latest.current.edit.width / latest.current.edit.height : (v.videoWidth || 16) / (v.videoHeight || 9)
    const w = Math.min(r.width, r.height * ar), h = w / ar
    setRect({ left: (r.width - w) / 2, top: (r.height - h) / 2, w, h })
  }

  useEffect(() => {
    const ro = new ResizeObserver(measure)
    if (frame.current) ro.observe(frame.current)
    return () => ro.disconnect()
  }, [])
  useEffect(measure, [live, p.edit?.width, p.edit?.height])
  const mediaItem = p.edit?.timeline && sourceAt(p.edit.timeline, p.time)?.item
  const videoFrame = draftFrame || (mediaItem?.kind === 'media' ? mediaItem.framing : undefined) || framing()
  const sourceRect = placedVideo(sourceSize.width, sourceSize.height, rect.w, rect.h, videoFrame)
  useEffect(() => {
    if (!player) return
    const measureSource = () => {
      const el = player.element
      if (el.videoWidth) setSourceSize(old => old.width === el.videoWidth && old.height === el.videoHeight ? old : { width: el.videoWidth, height: el.videoHeight })
    }
    player.addEventListener('timeupdate', measureSource)
    measureSource()
    return () => player.removeEventListener('timeupdate', measureSource)
  }, [player])

  useEffect(() => {
    if (!player || !p.edit?.timeline?.demo || !camera.current) return
    const el = camera.current, tl = p.edit.timeline, d = tl.demo!
    let raf = 0
    const tick = () => {
      const target = cameraAt(tl, player.currentTime), audible = d.audio === 'camera' && !!target
      if (cameraBox.current) cameraBox.current.style.visibility = target && !d.layout.hidden ? 'visible' : 'hidden'
      player.elements.forEach(v => { v.muted = audible })
      el.muted = !audible
      if (target) {
        el.playbackRate = target.rate
        if (Math.abs(el.currentTime - target.at) > (player.paused ? 0.015 : 0.08)) el.currentTime = target.at
        if (player.paused) el.pause(); else if (el.paused) el.play().catch(() => {})
      } else el.pause()
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.pause(); el.muted = true; player.elements.forEach(v => { v.muted = false }) }
  }, [player, p.edit?.timeline])
  useEffect(() => {
    if (!player || !p.edit?.timeline?.demo || !camera.current) return
    const el = camera.current, tl = p.edit.timeline
    p.onSource?.({ clock: player, elements: [...player.elements, el], gainOf: v => {
      if (v !== el) return player.gainOf(v)
      let at = 0
      for (const it of tl.items) {
        const len = it.kind === 'media' ? it.out - it.in : it.dur
        if (player.currentTime < at + len) return it.kind === 'media' && !it.muted ? Math.pow(10, (it.db || 0) / 20) : 0
        at += len
      }
      return 0
    } })
    return () => p.onSource?.({ clock: player, elements: player.elements, gainOf: v => player.gainOf(v) })
  }, [player, p.edit?.timeline])

  const visible = p.notes.filter(n => n.anchor.box && p.time >= n.anchor.t0 - 0.05 && p.time <= (n.anchor.t1 ?? n.anchor.t0 + 2))
  const boxStyle = (b: Box) => ({ left: rect.left + b.x * rect.w, top: rect.top + b.y * rect.h, width: b.w * rect.w, height: b.h * rect.h })
  const shown = drag?.box || p.box

  return (
    <div
      ref={frame}
      className={cn('relative h-full w-full overflow-hidden rounded-xl bg-black', p.working && 'beam', p.drawing && 'cursor-crosshair')}
      onPointerDown={e => {
        if (p.videoEditing && !p.drawing && rect.w > 0) {
          e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); player?.pause()
          videoDrag.current = { x: e.clientX, y: e.clientY, framing: videoFrame, resize: !!(e.target as HTMLElement).closest('[data-video-resize]') }; return
        }
        if (!p.drawing) { const v = player || video.current; if (v) v.paused ? v.play() : v.pause(); return }
        const { x, y } = toPicture(e)
        ;(e.target as Element).setPointerCapture(e.pointerId)
        setDrag({ x, y, box: { x, y, w: 0, h: 0 } })
      }}
      onPointerMove={e => {
        const placement = videoDrag.current
        if (placement) {
          const next = placement.resize ? framing({ ...placement.framing, zoom: placement.framing.zoom * Math.max(0.25, 1 + (e.clientX - placement.x) / Math.max(1, sourceRect.width)) })
            : framing({ ...placement.framing, x: placement.framing.x + (e.clientX - placement.x) / rect.w, y: placement.framing.y + (e.clientY - placement.y) / rect.h })
          placement.next = next; setDraftFrame(next); return
        }
        if (!drag) return
        const { x, y } = toPicture(e)
        setDrag({ ...drag, box: { x: Math.min(x, drag.x), y: Math.min(y, drag.y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) } })
      }}
      onPointerUp={() => {
        if (videoDrag.current) { const next = videoDrag.current.next; videoDrag.current = null; setDraftFrame(null); if (next) p.onVideoFraming?.(next); return }
        if (drag && drag.box.w > 0.01 && drag.box.h > 0.01) p.onBox(drag.box)
        setDrag(null)
      }}
      onPointerCancel={() => { videoDrag.current = null; setDraftFrame(null) }}
      onWheel={e => { if (p.videoEditing) { e.preventDefault(); p.onVideoFraming?.(framing({ ...videoFrame, zoom: videoFrame.zoom * (e.deltaY < 0 ? 1.05 : 0.95) })) } }}
    >
      {live ? (
        <>
          <div className="absolute overflow-hidden" data-video-viewport style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
            {[a, b].map((r, k) => (
              <video key={`edit-${k}`} ref={r} crossOrigin="anonymous" playsInline preload="auto" className="invisible absolute" style={sourceRect}
                onLoadedMetadata={e => { measure(); setSourceSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight }) }} data-edit-player={k} />
            ))}
          </div>
          {p.videoEditing && <span data-video-resize className="absolute z-10 size-3 cursor-nwse-resize rounded-sm bg-amber shadow" title="Drag to resize video" style={{ left: rect.left + Math.max(8, Math.min(rect.w - 20, sourceRect.left + sourceRect.width - 12)), top: rect.top + Math.max(8, Math.min(rect.h - 20, sourceRect.top + sourceRect.height - 12)) }} />}
          {player && p.edit!.overlays.length > 0 && <Overlays player={player} edit={p.edit!} rect={rect} />}
          {p.edit!.timeline?.demo && (() => {
            const l = p.edit!.timeline!.demo!.layout, scale = rect.w / p.edit!.width
            // Matching cover crop in CSS and FFmpeg. A crop box becomes a clipped, oversized video.
            const crop = l.crop
            const f = draftCameraFrame || l.framing || framing({}, 'cover')
            const croppedW = cameraSize.width * (crop?.w || 1), croppedH = cameraSize.height * (crop?.h || 1)
            const place = placedVideo(croppedW, croppedH, l.width * scale, l.height * scale, f)
            const cropScale = croppedW ? place.width / croppedW : 1
            return <div ref={cameraBox} className={cn('absolute overflow-hidden', p.cameraEditing ? 'cursor-move ring-2 ring-amber' : 'pointer-events-none')} style={{ left: rect.left + l.x * scale, top: rect.top + l.y * scale,
              width: l.width * scale, height: l.height * scale, borderRadius: l.shape === 'circle' ? '50%' : l.shape === 'rounded' ? 16 * scale : 0,
              outline: `${l.border * scale}px solid rgba(255,255,255,.85)`, visibility: 'hidden', background: 'black' }}
              onPointerDown={e => {
                if (!p.cameraEditing) return
                e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId)
                player?.pause()
                cameraDrag.current = { x: e.clientX, y: e.clientY, layout: l, resize: !!(e.target as HTMLElement).closest('[data-camera-resize]'), source: p.cameraMode === 'frame' }
              }}
              onPointerMove={e => {
                const drag = cameraDrag.current
                if (!drag || !cameraBox.current) return
                e.stopPropagation()
                const dx = (e.clientX - drag.x) / scale, dy = (e.clientY - drag.y) / scale
                if (drag.source) {
                  const original = drag.layout.framing || framing({}, 'cover')
                  const next = framing({ ...original, x: original.x + dx / l.width, y: original.y + dy / l.height }, 'cover')
                  drag.next = { framing: next }; setDraftCameraFrame(next); return
                }
                const next = drag.resize ? { width: Math.max(48, Math.min(p.edit!.width - l.x, drag.layout.width + dx)), height: Math.max(48, Math.min(p.edit!.height - l.y, drag.layout.height + dy)) }
                  : { x: Math.max(0, Math.min(p.edit!.width - l.width, drag.layout.x + dx)), y: Math.max(0, Math.min(p.edit!.height - l.height, drag.layout.y + dy)) }
                if (drag.resize && (l.shape === 'circle' || l.shape === 'square')) { next.height = Math.min(next.width!, p.edit!.height - l.y); next.width = next.height }
                drag.next = next
                cameraBox.current.style.left = `${rect.left + (next.x ?? l.x) * scale}px`; cameraBox.current.style.top = `${rect.top + (next.y ?? l.y) * scale}px`
                cameraBox.current.style.width = `${(next.width ?? l.width) * scale}px`; cameraBox.current.style.height = `${(next.height ?? l.height) * scale}px`
              }}
              onPointerUp={e => { e.stopPropagation(); const next = cameraDrag.current?.next; cameraDrag.current = null; setDraftCameraFrame(null); if (next) p.onCameraLayout?.(next) }}
              onPointerCancel={() => { cameraDrag.current = null; setDraftCameraFrame(null) }}
              onWheel={e => { if (p.cameraMode === 'frame') { e.stopPropagation(); e.preventDefault(); p.onCameraLayout?.({ framing: framing({ ...f, zoom: f.zoom * (e.deltaY < 0 ? 1.05 : 0.95) }, 'cover') }) } }}>
              <video ref={camera} src={p.edit!.cameraUrl} crossOrigin="anonymous" playsInline preload="auto" muted data-demo-camera
                onLoadedMetadata={e => setCameraSize({ width: e.currentTarget.videoWidth, height: e.currentTarget.videoHeight })}
                style={{ position: 'absolute', width: cameraSize.width * cropScale, height: cameraSize.height * cropScale,
                  clipPath: crop ? `inset(${crop.y * 100}% ${(1 - crop.x - crop.w) * 100}% ${(1 - crop.y - crop.h) * 100}% ${crop.x * 100}%)` : undefined,
                  left: place.left - (crop?.x || 0) * cameraSize.width * cropScale,
                  top: place.top - (crop?.y || 0) * cameraSize.height * cropScale }} />
              {p.cameraMode === 'move' && <span data-camera-resize className="absolute bottom-[15%] right-[15%] size-3 cursor-nwse-resize rounded-sm bg-amber shadow" title="Drag to resize" />}
            </div>
          })()}
        </>
      ) : (
        <video
          ref={setVideo}
          key={p.src}
          src={p.src}
          crossOrigin="anonymous"
          className="size-full object-contain"
          onLoadedMetadata={e => { const v = e.currentTarget; p.onDuration(v.duration); if (p.time) v.currentTime = Math.min(p.time, v.duration); measure() }}
          onTimeUpdate={e => p.onTime(e.currentTarget.currentTime)}
          onSeeked={e => p.onTime(e.currentTarget.currentTime)}
          onPlay={() => p.onPlaying(true)}
          onPause={() => p.onPlaying(false)}
        />
      )}
      {visible.map(n => (
        <div key={n.id} className={cn('pointer-events-none absolute rounded border-2', n.status === 'open' ? 'border-note' : 'border-faint/60')} style={boxStyle(n.anchor.box!)}>
          <span className={cn('absolute -top-6 left-0 max-w-[260px] truncate rounded px-1.5 py-0.5 text-[11px]', n.status === 'open' ? 'bg-note text-[#0b1424]' : 'bg-raised text-dim')}>
            {n.status === 'resolved' ? '✓ ' : ''}{n.text}
          </span>
        </div>
      ))}
      {shown && <div className="pointer-events-none absolute rounded border-2 border-amber bg-amber/10" style={boxStyle(shown)} />}
      {p.ask && p.box && !drag && (() => {
        // under the box if it fits, else over it; kept inside the frame
        const b = boxStyle(p.box), fw = rect.left * 2 + rect.w, fh = rect.top * 2 + rect.h, W = Math.min(320, fw - 16)
        const below = b.top + b.height + 8 + 130 <= fh
        const left = Math.max(8, Math.min(fw - W - 8, b.left + b.width / 2 - W / 2))
        return <div className="absolute z-20" style={below ? { left, top: b.top + b.height + 8, width: W } : { left, bottom: Math.max(8, fh - b.top + 8), width: W }}>{p.ask}</div>
      })()}
      {p.drawing && !shown && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full bg-black/70 px-3 py-1 text-xs text-fg">Drag a box around what you want to change</div>
      )}
    </div>
  )
})

/** Overlay clips over the edit while it plays from its pieces: each clip's HTML (transparent), seeked to the film's
 *  time every frame and shown only during its time; the render lays the same clips over the same moments. */
function Overlays({ player, edit, rect }: { player: EditPlayer; edit: LiveEdit; rect: { left: number; top: number; w: number; h: number } }) {
  const frames = useRef<(HTMLIFrameElement | null)[]>([])
  useEffect(() => {
    let raf = 0, last = -1
    const tick = () => {
      const t = player.currentTime
      if (t !== last) {
        last = t
        edit.overlays.forEach((o, i) => {
          const f = frames.current[i]
          if (!f) return
          const on = t >= o.start && t < o.start + o.dur
          f.style.visibility = on ? 'visible' : 'hidden'
          if (on) f.contentWindow?.postMessage({ manul: 'seek', t: t - o.start }, '*')
        })
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [player, edit.overlays])
  const scale = rect.w / edit.width
  return (
    <div className="pointer-events-none absolute overflow-hidden" style={{ left: rect.left, top: rect.top, width: rect.w, height: rect.h }}>
      {edit.overlays.map((o, i) => (
        <iframe key={o.id} ref={el => { frames.current[i] = el }} src={o.url} sandbox="allow-scripts" title={o.id} data-overlay={o.id}
          style={{ width: edit.width, height: edit.height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0, visibility: 'hidden', background: 'transparent', colorScheme: 'normal' }}
          className="absolute left-0 top-0" />
      ))}
    </div>
  )
}
