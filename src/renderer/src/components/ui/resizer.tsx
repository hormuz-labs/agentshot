// Panes the user can widen or narrow: a width remembered per pane, and the divider that drags it
// (double-click puts it back, arrow keys nudge it). As in Claude's app, dragging well past a pane's minimum snaps it
// shut, and dragging back (in the same drag) opens it again.
import { useCallback, useEffect, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '@/lib/utils'

type Bound = number | (() => number)
const value = (b: Bound) => (typeof b === 'function' ? b() : b)

export type PaneWidth = { width: number; min: number; max(): number; set(w: number): void; reset(): void }

/** A pane's width, kept between launches under `key`. `max` can be a function (a share of the window, say). */
export function useWidth(key: string, initial: number, min: number, max: Bound): PaneWidth {
  const clamp = useCallback((w: number) => Math.round(Math.min(Math.max(min, value(max)), Math.max(min, w))), [min, max])
  const [width, setWidth] = useState(() => {
    try { const v = Number(localStorage.getItem(key)); if (v) return clamp(v) } catch { /* private mode */ }
    return initial
  })
  useEffect(() => { try { localStorage.setItem(key, String(width)) } catch { /* private mode */ } }, [key, width])
  return { width, min, max: () => Math.max(min, value(max)), set: w => setWidth(clamp(w)), reset: () => setWidth(clamp(initial)) }
}

/** A pane's size in the row: its width, giving way (down to its minimum) when the window is too narrow for every pane. */
export const paneStyle = (p: PaneWidth) => ({ width: p.width, minWidth: p.min, flexShrink: 1 })

/** How far past a limit a drag goes before a pane snaps shut. */
export const SNAP = 72

/** What snaps: `self` when the pane is dragged well below its minimum, `other` (the pane across the divider) when it is
 *  dragged well past its maximum. `otherCollapsed`: the other pane is shut now, so dragging back opens it. */
export type Snap = { self?(collapsed: boolean): void; other?(collapsed: boolean): void; otherCollapsed?: boolean }

/** The divider on one edge of a pane (the pane is `relative`): 'right' for a pane on the left of the window, and so on. */
export function Resizer({ pane, edge, label, snap }: { pane: PaneWidth; edge: 'left' | 'right'; label: string; snap?: Snap }) {
  const [dragging, setDragging] = useState(false)
  const sign = edge === 'right' ? 1 : -1
  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    // from the width on screen: a pane can be narrower than asked when the window has no room for it
    const x0 = e.clientX
    // the other pane shut: start just past the point it snapped at, so a short drag back opens it
    let otherShut = !!snap?.otherCollapsed, selfShut = false
    const w0 = otherShut ? pane.max() + SNAP : e.currentTarget.parentElement?.getBoundingClientRect().width ?? pane.width
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    // followed on the window, so the drag holds even if the divider loses the pointer (a re-render, a dialog opening)
    const move = (ev: globalThis.PointerEvent) => {
      const w = w0 + sign * (ev.clientX - x0)
      if (snap?.self) {
        if (!selfShut && w < pane.min - SNAP) { selfShut = true; snap.self(true) }
        else if (selfShut && w > pane.min - SNAP / 2) { selfShut = false; snap.self(false) }
        if (selfShut) return
      }
      if (snap?.other) {
        if (!otherShut && w > pane.max() + SNAP) { otherShut = true; snap.other(true) }
        else if (otherShut && w < pane.max() + SNAP / 2) { otherShut = false; snap.other(false) }
        if (otherShut) return
      }
      pane.set(w)
    }
    const up = () => {
      setDragging(false)
      document.body.style.cursor = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') { e.preventDefault(); pane.set(pane.width - sign * step) }
    else if (e.key === 'ArrowRight') { e.preventDefault(); pane.set(pane.width + sign * step) }
  }
  return (
    <div
      role="separator" aria-orientation="vertical" aria-label={label} aria-valuenow={pane.width} tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={down} onDoubleClick={pane.reset} onKeyDown={key}
      // inside the pane, over its border: never on top of the pane next to it
      className={cn('no-drag group absolute inset-y-0 z-30 w-1.5 cursor-col-resize outline-none', edge === 'right' ? 'right-0' : 'left-0')}
    >
      <div className={cn('h-full w-px transition-colors', edge === 'right' ? 'ml-auto' : 'mr-auto', dragging ? 'bg-amber' : 'bg-transparent group-hover:bg-amber/60 group-focus-visible:bg-amber')} />
    </div>
  )
}
