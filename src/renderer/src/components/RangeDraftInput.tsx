import { useLayoutEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react'
import { rangeMarkers } from '../../../shared/range-notes'

/** A native editable textarea with a matching styled text layer. Monospace keeps bold range
 * labels and the native caret aligned, including wrapped lines and horizontal scrolling. */
export function RangeDraftInput({ className = '', onScroll, ...props }: ComponentPropsWithRef<'textarea'>) {
  const layer = useRef<HTMLDivElement>(null)
  const text = String(props.value ?? '')
  const parts: ReactNode[] = []
  let end = 0
  for (const m of rangeMarkers(text)) {
    parts.push(text.slice(end, m.index))
    parts.push(<mark key={m.index} data-range-stamp className="rounded bg-amber-soft font-bold text-amber">{m[0]}</mark>)
    end = m.index! + m[0].length
  }
  parts.push(text.slice(end), '\n')
  useLayoutEffect(() => {
    const input = layer.current?.nextElementSibling as HTMLTextAreaElement | null
    if (layer.current && input) { layer.current.scrollTop = input.scrollTop; layer.current.scrollLeft = input.scrollLeft }
  }, [text])
  return <div className="relative">
    <div ref={layer} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-1.5 py-1.5 font-mono text-[15px] leading-6 text-fg">{parts}</div>
    <textarea {...props} className={`${className} relative block font-mono leading-6 text-transparent caret-[var(--color-fg)]`} onScroll={e => {
      if (layer.current) { layer.current.scrollTop = e.currentTarget.scrollTop; layer.current.scrollLeft = e.currentTarget.scrollLeft }
      onScroll?.(e)
    }} />
  </div>
}
