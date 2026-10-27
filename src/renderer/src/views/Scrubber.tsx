// The timeline: the film's pieces in order, each with its frames, the overlays laid over it, the playhead and note pins,
// and a drag to select a range to point the agent at. A piece's name drags it somewhere else in the film; footage
// dragged from the sidebar's Files drops in where it lands; a motion clip's name opens it on the picture to adjust.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Maximize2, Sparkles, VolumeX } from 'lucide-react'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { Tip } from '@/components/ui/tooltip'
import { duration as lengthOf, length, starts, itemAt, type Edit, type Item, type Timeline } from '../../../shared/timeline'
import { ClipActions } from '@/components/ClipActions'
import { DRAG_FILE, dragKind } from './FilesPanel'
import type { ClipInfo, Note } from '../../../shared/types'
import { Filmstrip } from './Filmstrip'
import { frameZoom } from '@/lib/timelineScale'

type Props = {
  dir: string
  /** changes when another version is on screen (the zoom resets) */
  revision: number
  fps: number
  duration: number
  time: number
  notes: Note[]
  range?: { t0: number; t1?: number }
  ranges?: { t0: number; t1: number }[]
  /** what the film is made of */
  track: Timeline
  clips: Record<string, ClipInfo>
  /** the motion clip open on the picture, outlined */
  selected?: string | null
  onSelect?(id: string): void
  moveMode?: boolean
  onExitMove?(): void
  /** what to say on the right of the header (an edit not yet saved as a version) */
  status?: ReactNode
  onSeek(t: number): void
  onRange(r: { t0: number; t1: number } | null): void
  /** a drag across the strip ended with a range selected */
  onRangeEnd?(range: { t0: number; t1: number }): void
  /** a message box to show above the selection (a range, or a note's moment) */
  ask?: ReactNode
  onNote(n: Note): void
  /** a motion clip (a piece or an overlay) clicked: adjust it on the picture */
  onOpenClip(id: string, clip: string, start: number): void
  /** pieces can be dragged to another place (not while a proposal waits) */
  movable?: boolean
  /** a piece dragged before another (null: to the end) */
  onMove?(id: string, before: string | null): void
  /** footage dragged from the sidebar's Files, dropped at t */
  onInsert?(rel: string, t: number): void
  onEdit?(edits: Edit[]): Promise<void>
}

type Move = { id: string; x0: number; y0: number; x: number; y: number; moved: boolean; before: string | null;
  width: number; height: number; grabX: number; grabY: number; frames: { src: string; left: string; width: string }[] }

export function Scrubber({ dir, revision, fps: rate, duration, time, notes, range, ranges = [], track, clips, selected = null, onSelect, moveMode = false, onExitMove, status, onSeek, onRange, onRangeEnd, ask, onNote, onOpenClip, movable = false, onMove, onInsert, onEdit }: Props) {
  const bar = useRef<HTMLDivElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  const [view, setView] = useState({ width: 1, left: 0 })
  const center = useRef<number | null>(null)
  const [drag, setDrag] = useState<{ start: number; moved: boolean } | null>(null)
  const [move, setMove] = useState<Move | null>(null)
  const [drop, setDrop] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [actions, setActions] = useState<string | null>(null)
  const actionItem = track.items.find(it => it.id === actions)
  useEffect(() => { if (moveMode) setActions(null) }, [moveMode])
  useEffect(() => { setActions(null); setMove(null) }, [track, movable])
  useEffect(() => {
    if (!actions && !moveMode) return
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { setActions(null); setMove(null); onExitMove?.() } }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [actions, moveMode, onExitMove])
  const shown = track
  const at0 = starts(shown)
  const d = (duration || lengthOf(track)) || 1
  const fps = rate || 30
  const maxZoom = frameZoom(view.width, d, fps)
  const changeZoom = (value: number) => {
    const el = viewport.current!
    center.current = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth
    setZoom(Math.max(1, Math.min(maxZoom, value)))
  }
  useLayoutEffect(() => {
    const el = viewport.current
    if (el && center.current != null) el.scrollLeft = center.current * el.scrollWidth - el.clientWidth / 2
    center.current = null
  }, [zoom])
  useLayoutEffect(() => { setZoom(1); if (viewport.current) viewport.current.scrollLeft = 0 }, [revision])
  useEffect(() => {
    const el = viewport.current!
    const measure = () => setView({ width: el.clientWidth, left: el.scrollLeft })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    el.addEventListener('scroll', measure, { passive: true })
    return () => { observer.disconnect(); el.removeEventListener('scroll', measure) }
  }, [])
  useEffect(() => { setZoom(z => Math.min(z, maxZoom)) }, [maxZoom])
  useEffect(() => {
    const el = viewport.current!
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      changeZoom(zoom * Math.exp(-e.deltaY * 0.01))
    }
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
  }, [zoom, maxZoom])
  const at = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect()
    const t = Math.min(d, Math.max(0, ((clientX - r.left) / r.width) * d))
    return Math.floor(t * fps + 1e-6) / fps
  }
  const pct = (t: number) => `${(t / d) * 100}%`
  const ticks = Math.ceil(zoom * 4)
  // Only render visible ruler marks; frame-level zoom can span hours of footage.
  const firstTick = Math.max(0, Math.floor(view.left / (view.width * zoom) * ticks) - 1)
  const lastTick = Math.min(ticks, Math.ceil((view.left + view.width) / (view.width * zoom) * ticks) + 1)
  const rulerTime = (t: number) => {
    if (d / ticks >= 0.1) return timecode(t, d / zoom < 10)
    return `${timecode(t, false)}:${Math.floor((t % 1) * fps + 1e-6).toString().padStart(2, '0')}`
  }

  // ---- moving a piece by its name
  const canMove = movable && !!onMove && shown.items.length > 1
  /** the piece the dragged one would go before (null: the end), from the pointer's time */
  const gapAt = (t: number, id: string) => {
    for (let k = 0; k < shown.items.length; k++) {
      const it = shown.items[k]
      if (it.id !== id && t < at0[k] + length(it) / 2) return it.id
    }
    return null
  }
  const startMove = (e: PointerEvent, it: Item) => {
    e.stopPropagation()
    if (e.button !== 0 || !canMove) return
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    onSelect?.(it.id)
    setActions(null)
    const piece = (e.currentTarget as HTMLElement).closest<HTMLElement>('[data-piece]')!
    const bounds = piece.getBoundingClientRect()
    const frames = [...piece.querySelectorAll('img')].map(img => ({ src: img.src, left: img.style.left || '0%', width: img.style.width || '100%' }))
    setMove({ id: it.id, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, before: null,
      width: bounds.width, height: bounds.height, grabX: e.clientX - bounds.left, grabY: e.clientY - bounds.top, frames })
  }
  const moveTo = (e: PointerEvent) => {
    if (!move || (!move.moved && Math.hypot(e.clientX - move.x0, e.clientY - move.y0) < 4)) return
    const el = viewport.current!
    const bounds = el.getBoundingClientRect()
    if (e.clientX < bounds.left + 32) el.scrollLeft -= 24
    else if (e.clientX > bounds.right - 32) el.scrollLeft += 24
    setMove({ ...move, x: e.clientX, y: e.clientY, moved: true, before: gapAt(at(e.clientX), move.id) })
  }
  /** let go: where it was dropped, if it moved; a click otherwise (a motion clip opens, footage is gone to) */
  const endMove = (it: Item, start: number) => {
    const m = move
    setMove(null)
    if (m?.moved) {
      const k = shown.items.findIndex(x => x.id === m.id)
      const next = shown.items[k + 1]?.id ?? null
      if (m.before !== next && m.before !== m.id) onMove?.(m.id, m.before)
      return
    }
    onSelect?.(it.id)
    if (it.kind === 'clip' && !moveMode) onOpenClip(it.id, it.clip, start)
    else onSeek(start)
  }
  const gapX = move?.moved ? (move.before ? at0[shown.items.findIndex(x => x.id === move.before)] : d) : null

  const sel = shown.items.findIndex(x => x.id === selected)
  const selItem = sel >= 0 ? shown.items[sel] : undefined
  const overlays = shown.overlays || []

  return (
    <div data-tour="timeline" ref={root} className="relative shrink-0 select-none rounded-lg border border-line bg-panel px-2 pb-2">
      {move?.moved && (() => {
        const item = shown.items.find(it => it.id === move.id)
        if (!item) return null
        const name = item.kind === 'media' ? item.src.split('/').pop() : clips[item.clip]?.title || item.clip
        return createPortal(<div data-lifted-clip className="pointer-events-none fixed z-[100] overflow-hidden rounded-md border border-orange-500 bg-raised text-fg shadow-[0_16px_32px_rgba(0,0,0,0.5)]" style={{ left: move.x - move.grabX, top: move.y - move.grabY - 14, width: move.width, height: move.height, transform: 'scale(1.025) rotate(-1deg)', transformOrigin: `${move.grabX}px ${move.grabY}px` }}>
          {move.frames.map((frame, i) => <img key={i} src={frame.src} alt="" className="absolute inset-y-0 h-full object-cover" style={{ left: frame.left, width: frame.width }} />)}
          <div className="absolute inset-x-0 bottom-0 truncate bg-panel/90 px-2 py-0.5 text-[10px] font-medium">{name} · {length(item).toFixed(2)}s</div>
        </div>, document.body)
      })()}
      {actionItem && movable && onEdit && <div className="absolute bottom-full right-0 z-40 mb-2 w-[360px] max-w-full">
        <ClipActions key={`${actionItem.id}:${JSON.stringify(actionItem)}`} item={actionItem} items={track.items} start={at0[track.items.indexOf(actionItem)]} time={time} onEdit={onEdit} onClose={() => setActions(null)} onOpen={actionItem.kind === 'clip' ? () => { onOpenClip(actionItem.id, actionItem.clip, at0[track.items.indexOf(actionItem)]); setActions(null) } : undefined} />
      </div>}
      {ask && range && (() => {
        // above the selection's middle (or the note's moment), where the strip shows it now, kept inside the box
        const r = root.current?.getBoundingClientRect(), b = bar.current?.getBoundingClientRect()
        if (!r || !b) return null
        const t = range.t1 != null ? (range.t0 + range.t1) / 2 : range.t0
        const x = b.left - r.left + (t / d) * b.width, W = Math.min(320, r.width - 8)
        return <div className="absolute bottom-full z-30 mb-2" style={{ left: Math.max(4, Math.min(r.width - W - 4, x - W / 2)), width: W }}>{ask}</div>
      })()}
      {/* wraps onto a second row when the film is narrow, rather than spilling out of the box */}
      <div className="flex min-h-8 flex-wrap items-center gap-1 border-b border-line py-0.5 text-dim">
        <span className="mr-1 text-[10px] font-medium uppercase tracking-wider">Timeline</span>
        <span className="flex-1" />
        {status}
        <span className="mx-2 whitespace-nowrap text-[10px] text-faint tabular" title="Source video frame rate">{fps} fps</span>
        <span data-testid="timeline-scale" className="mr-1 text-[10px] tabular" title="Pinch or hold Ctrl/⌘ and scroll to zoom">{zoom > 1 ? `${(d / zoom).toFixed(d / zoom < 1 ? 3 : 1)} s visible` : ''}{zoom > 1 && zoom >= maxZoom - 1e-6 ? ' · Frame view' : ''}</span>
        <button type="button" aria-label="Fit timeline" title="Fit entire video" onClick={() => changeZoom(1)} className="ml-1 rounded p-1 hover:bg-hover hover:text-fg"><Maximize2 className="size-3.5" /></button>
      </div>
      <div ref={viewport} data-testid="timeline-viewport" className="overflow-x-auto overflow-y-hidden">
      <div className="relative pt-5" style={{ width: `${zoom * 100}%` }}>
      {/* note pins */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-5">
        {notes.map(n => (
          <Tip key={n.id} label={<span>{timecode(n.anchor.t0)} · {n.text}{n.reply ? <><br /><span className="text-dim">↳ {n.reply}</span></> : null}</span>}>
            <button
              onClick={() => onNote(n)}
              className={cn('pointer-events-auto absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-bg', n.status === 'open' ? 'bg-note' : 'bg-faint')}
              style={{ left: pct(n.anchor.t0) }}
            />
          </Tip>
        ))}
      </div>
      <div className="relative mb-1 h-5 border-b border-line text-[9px] text-dim tabular" aria-hidden="true">
        {Array.from({ length: lastTick - firstTick + 1 }, (_, index) => { const i = firstTick + index; return <div key={i} className="absolute inset-y-0 border-l border-line-strong" style={{ left: `${100 * i / ticks}%` }}><span className={cn('absolute whitespace-nowrap bg-panel pb-1', i === 0 ? 'left-0' : i === ticks ? 'right-0' : '-translate-x-1/2')}>{rulerTime(d * i / ticks)}</span></div> })}
      </div>
      {/* overlays: lower thirds, captions, callouts laid over the footage */}
      {overlays.length > 0 && (
        <div className="relative mb-1 h-5">
          {overlays.map(o => (
            <button key={o.id} onClick={() => onOpenClip(o.id, o.clip, o.start)} title={`${clips[o.clip]?.title || o.clip} (over the footage) · click to edit`}
              style={{ left: pct(o.start), width: pct(o.dur) }}
              className={cn('absolute inset-y-0 min-w-4 truncate rounded-sm border px-1 text-left text-[10px] font-medium', selected === o.id ? 'border-note bg-note/30 text-fg' : 'border-note/40 bg-note/15 text-note hover:border-note')}>
              {clips[o.clip]?.title || o.clip}
            </button>
          ))}
        </div>
      )}
      <div
        ref={bar}
        data-testid="timeline-scrubber"
        aria-label="Video timeline — click to seek, drag to select a range"
        className="relative h-[72px] touch-none cursor-crosshair rounded border border-amber/40 bg-raised shadow-sm"
        onPointerDown={e => { if (e.button !== 0) return; setActions(null); e.currentTarget.setPointerCapture(e.pointerId); const t = at(e.clientX); const it = itemAt(track, t).item; if (it) onSelect?.(it.id); setDrag({ start: t, moved: false }); onSeek(t) }}
        onContextMenu={e => { e.preventDefault(); if (movable && onEdit) { const t = at(e.clientX); onSeek(t); setActions(itemAt(track, t).item?.id ?? null) } }}
        onPointerMove={e => {
          const t = at(e.clientX)
          setHover(t)
          if (!drag) return
          if (Math.abs(t - drag.start) >= Math.max(1 / fps, d / zoom * 0.004)) { setDrag({ ...drag, moved: true }); onRange({ t0: Math.min(t, drag.start), t1: Math.max(t, drag.start) }) }
          onSeek(t)
        }}
        onPointerUp={e => {
          // a click seeks (and drops the range); a drag leaves a range to point at
          if (drag && !drag.moved) onRange(null)
          else if (drag?.moved) {
            const t = at(e.clientX)
            if (Math.abs(t - drag.start) >= 1 / fps) onRangeEnd?.({ t0: Math.min(t, drag.start), t1: Math.max(t, drag.start) })
            else onRange(null)
          }
          setDrag(null)
        }}
        onPointerCancel={() => { setDrag(null); setHover(null); onRange(null) }}
        onPointerLeave={() => setHover(null)}
        // footage from the sidebar's Files: it goes into the film where it's dropped
        onDragOver={e => {
          if (!onInsert || dragKind(e.dataTransfer.types) !== 'video') return
          e.preventDefault(); e.dataTransfer.dropEffect = 'copy'
          setDrop(at(e.clientX))
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={e => {
          const rel = e.dataTransfer.getData(DRAG_FILE)
          setDrop(null)
          if (!rel || !onInsert) return
          e.preventDefault()
          onInsert(rel, at(e.clientX))
        }}
      >
        {/* the pieces */}
        {shown.items.map((it, k) => {
          const c = it.kind === 'clip' ? clips[it.clip] : undefined
          const name = it.kind === 'media' ? it.src.split('/').pop() : c?.title || it.clip
          return (
            <div key={it.id} data-piece={it.id} data-move-enabled={moveMode && canMove ? '' : undefined} className={cn('absolute inset-y-0 overflow-hidden rounded-sm', k < shown.items.length - 1 && 'border-r-[3px] border-panel', moveMode && canMove && 'cursor-grab active:cursor-grabbing', move?.moved && move.id === it.id && 'opacity-20')}
              onPointerDown={e => { if (moveMode && canMove) startMove(e, it) }}
              onPointerMove={e => { if (moveMode && canMove) { e.stopPropagation(); moveTo(e) } }}
              onPointerUp={e => { if (moveMode && canMove) { e.stopPropagation(); endMove(it, at0[k]) } }}
              onPointerCancel={e => { if (moveMode) { e.stopPropagation(); setMove(null) } }}
              style={{ left: pct(at0[k]), width: pct(length(it)), minWidth: 2 }}>
              {it.kind === 'media' ? (
                <Filmstrip dir={dir} src={it.src} revision={revision} from={it.in} to={it.out} fps={fps} viewport={viewport} />
              ) : (
                <div className="pointer-events-none absolute inset-0 bg-amber/15">
                  {c?.poster && <img src={`${mediaUrl(`${dir}/${c.poster}`)}?v=${c.updatedAt}`} alt="" draggable={false} className="absolute inset-0 size-full object-cover opacity-70" />}
                </div>
              )}
              <button
                type="button"
                data-grip
                title={it.kind === 'clip' ? `${name} · click to edit${canMove ? ', drag to move' : ''}` : canMove ? `${name} · drag to move` : name}
                className={cn('absolute inset-x-0 bottom-0 flex items-center gap-1 truncate bg-panel/90 px-2 py-0.5 text-left text-[10px] font-medium text-fg', canMove ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer')}
                // the name: drag it to move the piece; a click opens a motion clip, or goes to where footage starts
                onPointerDown={e => startMove(e, it)}
                onPointerMove={e => { e.stopPropagation(); moveTo(e) }}
                onPointerUp={e => { e.stopPropagation(); endMove(it, at0[k]) }}
                onPointerCancel={() => setMove(null)}
              >
                {it.kind === 'clip' && <Sparkles className="size-3 shrink-0 text-amber" />}
                <span className="truncate">{name}</span>
                {it.kind === 'media' && it.muted && <VolumeX className="size-3 shrink-0 text-amber" aria-label="muted" />}
                {it.kind === 'media' && !it.muted && !!it.db && <span className="shrink-0 tabular text-amber">{it.db > 0 ? '+' : ''}{it.db} dB</span>}
              </button>
            </div>
          )
        })}
        {/* resolved and open note ranges */}
        {notes.filter(n => n.anchor.t1 != null).map(n => (
          <div key={n.id} className={cn('pointer-events-none absolute inset-y-0 rounded-sm', n.status === 'open' ? 'bg-note/15' : 'bg-fg/5')} style={{ left: pct(n.anchor.t0), width: pct(n.anchor.t1! - n.anchor.t0) }} />
        ))}
        {/* played part */}
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-fg/[0.04]" style={{ width: pct(time) }} />
        {/* the motion clip open on the picture */}
        {selItem && <div className="pointer-events-none absolute inset-y-0 z-[5] rounded-sm ring-2 ring-inset ring-fg" style={{ left: pct(at0[sel]), width: pct(length(selItem)) }} data-selected-piece={selItem.id} />}
        {/* selection */}
        {range?.t1 != null && <div className="pointer-events-none absolute inset-y-0 border-x-2 border-amber bg-amber/20" style={{ left: pct(range.t0), width: pct(range.t1 - range.t0) }} />}
        {ranges.filter(r => Number.isFinite(r.t0) && Number.isFinite(r.t1) && r.t1 > r.t0).map((r, i) => <div key={i} data-draft-range className="pointer-events-none absolute inset-y-0 border-x-2 border-orange-500 bg-orange-500/30 text-xs font-bold text-black" style={{ left: pct(r.t0), width: pct(r.t1 - r.t0) }}>{i + 1}</div>)}
        {/* hover time */}
        {/* where a moved piece would go, or where dropped footage would go in */}
        {gapX != null && <div data-move-insertion className="pointer-events-none absolute -inset-y-1 z-10 w-1 -translate-x-1/2 rounded bg-orange-500" style={{ left: pct(gapX) }} />}
        {drop != null && (
          <div className="pointer-events-none absolute -inset-y-1 z-10 w-0.5 -translate-x-1/2 bg-note" style={{ left: pct(drop) }}>
            <span className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap rounded bg-note px-1.5 py-0.5 text-[10px] font-medium text-white">Insert at {rulerTime(drop)}</span>
          </div>
        )}
        {hover != null && !drag && !move && (
          <div className="pointer-events-none absolute inset-y-0 border-l border-fg/50" style={{ left: pct(hover) }}><span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap rounded bg-raised px-1.5 py-0.5 text-[10px] text-fg tabular">{rulerTime(hover)}</span></div>
        )}
        {/* playhead */}
        <div className="pointer-events-none absolute -inset-y-1 z-[6] w-0.5 -translate-x-1/2 bg-amber shadow-[0_0_3px_#000]" style={{ left: pct(Math.max(0, Math.min(time, d))) }}><span className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-b-sm bg-amber" /></div>
      </div>
      </div>
      </div>
    </div>
  )
}
