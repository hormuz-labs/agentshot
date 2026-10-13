import { useEffect, useRef, useState } from 'react'
import { framing, placedVideo, type VideoFraming } from '../../../shared/framing'
import type { CameraLayout } from '../../../shared/demo'

/** Full uncropped original source, with the output shape overlaid as a guide. No proxy, no mask clipping. */
export function SourceFraming({ url, layout, time, onChange }: { url: string; layout: CameraLayout; time: number; onChange(f: VideoFraming): void }) {
  const video = useRef<HTMLVideoElement>(null), frame = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 }), [view, setView] = useState({ w: 0, h: 0 })
  const [draft, setDraft] = useState<VideoFraming | null>(null)
  const drag = useRef<{ x: number; y: number; f: VideoFraming; factor: number; next?: VideoFraming } | null>(null)
  const f = draft || layout.framing || framing({}, 'cover')
  useEffect(() => { const el = video.current; if (el?.readyState && Math.abs(el.currentTime - time) > 0.04) el.currentTime = Math.max(0, Math.min(el.duration - 0.04, time)) }, [time, url])
  useEffect(() => { const ro = new ResizeObserver(([r]) => setView({ w: r.contentRect.width, h: r.contentRect.height })); if (frame.current) ro.observe(frame.current); return () => ro.disconnect() }, [])
  const source = placedVideo(size.w, size.h, view.w, view.h, framing())
  const inside = placedVideo(size.w, size.h, layout.width, layout.height, f)
  const factor = inside.width > 0 ? source.width / inside.width : 1
  return <div className="col-span-2 space-y-2" data-source-framing>
    <div className="text-xs text-dim">Original video · {size.w} × {size.h} · full source</div>
    <div ref={frame} className="relative h-64 touch-none overflow-hidden rounded-lg bg-black" aria-label="Reframe full original video" style={{ cursor: 'grab' }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, f, factor } }}
      onPointerMove={e => { const d = drag.current; if (!d) return; const next = framing({ ...d.f, x: d.f.x + (e.clientX - d.x) / (layout.width * d.factor), y: d.f.y + (e.clientY - d.y) / (layout.height * d.factor) }, 'cover'); d.next = next; setDraft(next) }}
      onPointerUp={() => { const next = drag.current?.next; drag.current = null; setDraft(null); if (next) onChange(next) }}
      onPointerCancel={() => { drag.current = null; setDraft(null) }}
      onWheel={e => { e.preventDefault(); onChange(framing({ ...f, zoom: f.zoom * (e.deltaY < 0 ? 1.05 : 0.95) }, 'cover')) }}>
      <video ref={video} src={url} muted playsInline crossOrigin="anonymous" preload="auto" data-full-source-video className="pointer-events-none absolute" style={source}
        onLoadedMetadata={e => { const el = e.currentTarget; setSize({ w: el.videoWidth, h: el.videoHeight }); el.currentTime = Math.max(0, Math.min(el.duration - 0.04, time)) }} />
      {size.w > 0 && <div data-source-mask-guide className="pointer-events-none absolute border-2 border-amber" style={{ left: source.left - inside.left * factor, top: source.top - inside.top * factor,
        width: layout.width * factor, height: layout.height * factor, borderRadius: layout.shape === 'circle' ? '50%' : layout.shape === 'rounded' ? 16 * factor : 0, boxShadow: '0 0 0 1000px rgba(0,0,0,.35)' }} />}
    </div>
    <p className="text-[11px] text-dim">The complete original is visible. Drag to move it relative to the gold shape guide; scroll or use zoom to resize. The preview on the right shows the final masked result.</p>
  </div>
}
