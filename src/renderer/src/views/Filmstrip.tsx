import { memo, useEffect, useRef, useState, type RefObject } from 'react'
import { Film } from 'lucide-react'
import { mediaUrl } from '@/lib/utils'
import { thumbnailCount } from '@/lib/timelineScale'

/** A piece's frames (from–to of its file), sampling just the visible tiles (plus overscan), even on a heavily zoomed timeline. */
export const Filmstrip = memo(function Filmstrip({ dir, src, revision, from = 0, to, fps, viewport }: {
  dir: string; src: string; revision: number; from?: number; to: number; fps: number; viewport: RefObject<HTMLDivElement | null>
}) {
  const duration = Math.max(0, to - from)
  const strip = useRef<HTMLDivElement>(null)
  const [window, setWindow] = useState({ total: 0, first: 0, count: 0 })
  const [result, setResult] = useState<{ key: string; total: number; first: number; frames: string[]; failed: boolean }>()
  const key = `${dir}/${src}:${revision}:${from}:${to}:${fps}`
  const current = result?.key === key && result.total === window.total ? result : undefined
  useEffect(() => {
    const el = strip.current!, scroll = viewport.current!
    let timer: ReturnType<typeof setTimeout>
    const measure = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const r = el.getBoundingClientRect(), view = scroll.getBoundingClientRect()
        if (r.width <= 0 || view.width <= 0) return
        // At least four samples when fitted; more samples per second as the strip grows.
        const total = thumbnailCount(r.width, view.width, duration, fps)
        const tile = r.width / total
        const first = Math.max(0, Math.floor((view.left - r.left) / tile) - 1)
        const last = Math.min(total, Math.ceil((view.right - r.left) / tile) + 1)
        // a piece scrolled out of view loads nothing
        const count = r.right < view.left || r.left > view.right ? 0 : Math.min(24, Math.max(1, last - first))
        setWindow(old => old.total === total && old.first === first && old.count === count ? old : { total, first, count })
      }, 120)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    observer.observe(scroll)
    scroll.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); scroll.removeEventListener('scroll', measure); clearTimeout(timer) }
  }, [viewport, duration, fps])
  useEffect(() => {
    if (!window.count || duration <= 0) return
    let cancelled = false
    const { total, first, count } = window
    globalThis.window.agentshot.thumbnails(dir, src, count, from + duration * first / total, from + duration * (first + count) / total).then(frames => {
      if (!cancelled) setResult({ key, total, first, frames, failed: frames.length === 0 })
    }).catch(() => { if (!cancelled) setResult({ key, total, first, frames: [], failed: true }) })
    return () => { cancelled = true }
  }, [dir, src, key, from, duration, window])

  return (
    <div ref={strip} data-testid="timeline-filmstrip" data-frame-count={window.total} className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit] bg-raised" aria-hidden="true">
      <div className="sticky left-0 flex h-full w-fit items-center gap-2 px-4 text-[10px] text-dim">
        <Film className="size-3.5" />{current?.failed ? 'Preview unavailable' : 'Loading frames…'}
      </div>
      {current?.frames.map((frame, i) => (
        <img key={`${frame}:${i}`} src={mediaUrl(frame)} alt="" draggable={false} className="absolute inset-y-0 h-full border-r border-black/20 object-cover" style={{ left: `${100 * (current.first + i) / current.total}%`, width: `${100 / current.total}%` }} />
      ))}
    </div>
  )
})
