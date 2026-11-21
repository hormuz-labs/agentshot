// The playhead's time, which is also a box to type a moment into and go there: on a long film the strip is too coarse
// to land on an exact second by dragging.
import { forwardRef, useState } from 'react'
import { cn, timecode } from '@/lib/utils'
import { parseSeekTime } from '@/lib/seekTime'

export const GoToTime = forwardRef<HTMLInputElement, { time: number; duration: number; disabled?: boolean; onGo(t: number): void }>(
  function GoToTime({ time, duration, disabled, onGo }, ref) {
    // null: not editing, the box follows the playhead
    const [text, setText] = useState<string | null>(null)
    const [bad, setBad] = useState(false)
    const go = () => {
      const t = parseSeekTime(text ?? '')
      if (t == null) { setBad(true); return }
      onGo(Math.max(0, Math.min(duration > 0 ? duration : t, t)))
      setText(null); setBad(false)
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
    return (
      <span className="flex items-center gap-1 tabular text-xs text-dim">
        <input
          ref={ref}
          data-testid="go-to-time"
          aria-label="Go to time"
          title="Type a time and press Enter to go there (20, 1:20, 1:02:03.5, 1h2m3s) · G"
          disabled={disabled}
          value={text ?? timecode(time)}
          size={Math.max(6, (text ?? timecode(time)).length + 1)}
          aria-invalid={bad || undefined}
          onFocus={e => { setText(timecode(time)); setBad(false); requestAnimationFrame(() => e.target.select()) }}
          onBlur={() => { setText(null); setBad(false) }}
          onChange={e => { setText(e.target.value); setBad(false) }}
          onKeyDown={e => {
            e.stopPropagation()
            if (e.key === 'Enter') { e.preventDefault(); go() }
            else if (e.key === 'Escape') { e.preventDefault(); setText(null); e.currentTarget.blur() }
          }}
          className={cn('rounded border bg-transparent px-1 py-0.5 text-xs text-dim outline-none hover:border-line focus:border-amber focus:text-fg',
            bad ? 'border-red-500 text-fg' : 'border-transparent')}
        />
        <span className="text-faint">/ {timecode(duration)}</span>
      </span>
    )
  })
