// The project's history: every proposal, accept, reject, clip edit and note, newest first. Restore any point.
import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { History as HistoryIcon, Loader2, RotateCcw } from 'lucide-react'
import type { Project } from '../../../shared/types'

type Entry = { id: string; message: string; at: number }

export function HistoryButton({ project, onRestored, open, onOpenChange }: { project: Project; onRestored(p: Project): void; open: boolean; onOpenChange(v: boolean): void }) {
  const setOpen = onOpenChange
  const [log, setLog] = useState<Entry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => { if (open) window.manul.history.log(project.dir).then(setLog) }, [open, project])
  const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="no-drag inline-flex size-7 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg" title="History"><HistoryIcon className="size-4" /></Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 rounded-card border border-line bg-panel p-1 shadow-2xl shadow-shade">
          <div className="px-2 py-1.5 text-xs font-medium uppercase tracking-wider text-faint">History</div>
          <div className="max-h-96 overflow-y-auto">
            {log.map((e, i) => (
              <div key={e.id} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover">
                <span className={i === 0 ? 'size-1.5 shrink-0 rounded-full bg-amber' : 'size-1.5 shrink-0 rounded-full bg-line-strong'} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-fg">{e.message}</div>
                  <div className="text-[10.5px] text-faint">{when(e.at)}{i === 0 ? ' · now' : ''}</div>
                </div>
                {i > 0 && (
                  <button disabled={!!busy} title="Go back to this point" className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-dim opacity-0 hover:bg-raised hover:text-fg group-hover:opacity-100"
                    onClick={async () => { setBusy(e.id); try { onRestored(await window.manul.history.restore(project.dir, e.id)); setOpen(false) } finally { setBusy(null) } }}>
                    {busy === e.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}Restore
                  </button>
                )}
              </div>
            ))}
            {log.length === 0 && <div className="px-2 py-3 text-xs text-dim">Nothing yet.</div>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
