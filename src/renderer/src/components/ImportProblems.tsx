// An import that didn't work (added here, or sent from the phone): a card in view saying which file and why, in plain
// words, with what to do next. Not a line in the jobs tray that's easy to miss.
import { useEffect, useState } from 'react'
import { FileWarning, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pickFiles } from '@/lib/attach'

type Problem = { id: number; file: string; why: string }
let seq = 0

export function ImportProblems({ project }: { project: string | null }) {
  const [problems, setProblems] = useState<Problem[]>([])
  useEffect(() => window.agentshot.onImportFailed(p => setProblems(list => [...list.slice(-2), { ...p, id: ++seq }])), [])
  const dismiss = (id: number) => setProblems(list => list.filter(p => p.id !== id))
  if (!problems.length) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex flex-col items-center gap-2 px-4" role="alert" aria-live="assertive">
      {problems.map(p => (
        <div key={p.id} data-import-problem={p.file}
          className="pointer-events-auto flex w-full max-w-[460px] gap-3 rounded-xl border border-bad/30 bg-surface p-4 shadow-2xl shadow-shade">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-bad/10 text-bad"><FileWarning className="size-4" /></div>
          <div className="min-w-0 flex-1 space-y-1">
            <div className="truncate font-medium" title={p.file}>Couldn’t add {p.file}</div>
            <p className="text-[13px] leading-snug text-dim" data-selectable>{p.why}</p>
            <div className="flex gap-2 pt-2">
              {project && <Button size="sm" variant="secondary" onClick={() => { dismiss(p.id); void pickFiles(project) }}>Choose another file…</Button>}
              <Button size="sm" variant="ghost" onClick={() => dismiss(p.id)}>Dismiss</Button>
            </div>
          </div>
          <button type="button" aria-label="Dismiss" className="self-start rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={() => dismiss(p.id)}><X className="size-3.5" /></button>
        </div>
      ))}
    </div>
  )
}
