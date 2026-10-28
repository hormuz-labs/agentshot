import { MessageSquareText } from 'lucide-react'
import { type ReactNode } from 'react'

/** A point or box note in the composer header. */
export function NoteBadge({ children }: { children: ReactNode }) {
  return <span data-note-badge className="inline-flex items-center gap-1 rounded bg-amber-soft px-1.5 py-0.5 text-[11px] text-amber">
    <MessageSquareText className="size-3" />Note at
    {children}
  </span>
}
