// ⌘K: every command, fuzzy search, and "Ask Manul" for anything else (sent to the agent in the open project).
import { useEffect, useMemo, useState } from 'react'
import * as D from '@radix-ui/react-dialog'
import { CornerDownLeft, Search, Sparkles } from 'lucide-react'
import { rank, useAllCommands } from '@/lib/commands'
import { cn } from '@/lib/utils'

export function CommandPalette({ open, onOpenChange, onAsk }: { open: boolean; onOpenChange(v: boolean): void; onAsk?: (q: string) => void }) {
  const all = useAllCommands().filter(c => c.id !== 'palette')
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const list = useMemo(() => rank(all, q), [all, q])
  const rows = [...list.map(c => ({ key: c.id, title: c.title, shortcut: c.shortcut, run: c.run, ask: false })),
    ...(q.trim() && onAsk ? [{ key: '__ask', title: `Ask Manul: “${q.trim()}”`, shortcut: undefined, run: () => onAsk(q.trim()), ask: true }] : [])]
  useEffect(() => { setI(0) }, [q])
  useEffect(() => { if (!open) setQ('') }, [open])
  const go = (r?: typeof rows[number]) => { if (!r) return; onOpenChange(false); setTimeout(() => r.run?.(), 0) }

  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/50" />
        <D.Content className="fixed left-1/2 top-[18vh] z-50 w-[560px] max-w-[calc(100vw-32px)] -translate-x-1/2 overflow-hidden rounded-card border border-line bg-panel shadow-2xl shadow-shade focus:outline-none">
          <D.Title className="sr-only">Command palette</D.Title>
          <div className="flex items-center gap-2 bg-bg/40 px-3">
            <Search className="size-4 text-faint" />
            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a command, or ask Manul…"
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setI(x => Math.min(rows.length - 1, x + 1)) }
                if (e.key === 'ArrowUp') { e.preventDefault(); setI(x => Math.max(0, x - 1)) }
                if (e.key === 'Enter') { e.preventDefault(); go(rows[i]) }
              }}
              className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-faint" />
          </div>
          <div className="max-h-[50vh] overflow-y-auto p-1">
            {rows.map((r, n) => (
              <button key={r.key} onMouseEnter={() => setI(n)} onClick={() => go(r)}
                className={cn('flex w-full items-center gap-2 rounded-md px-3 py-2 text-left', n === i ? 'bg-raised text-fg' : 'text-dim')}>
                {r.ask && <Sparkles className="size-3.5 text-amber" />}
                <span className="flex-1 truncate">{r.title}</span>
                {r.shortcut && <kbd className="font-mono text-[10.5px] text-faint">{r.shortcut}</kbd>}
                {n === i && <CornerDownLeft className="size-3.5 text-faint" />}
              </button>
            ))}
            {rows.length === 0 && <div className="px-3 py-6 text-center text-dim">No commands</div>}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
