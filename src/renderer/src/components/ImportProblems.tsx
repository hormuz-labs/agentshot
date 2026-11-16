// Something that didn't work (a file added here or sent from the phone that couldn't come in, the agent or the browser
// not starting): a red box in the middle of the window saying what and why, in plain words, with what to do next and
// an × to close it. Not a line in a corner that's easy to miss.
import { useEffect, useState } from 'react'
import * as D from '@radix-ui/react-dialog'
import { AlertTriangle, FileWarning, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pickFiles } from '@/lib/attach'

/** A file that didn't come in has a name; anything else is a plain message ([why] only). */
export type Problem = { id: number; file?: string; why: string }
let seq = 0

/** The problems in view: the newest three, an identical one not shown twice. */
export function addProblem(list: Problem[], p: Omit<Problem, 'id'>): Problem[] {
  const rest = list.filter(q => !(q.file === p.file && q.why === p.why))
  return [...rest.slice(-2), { ...p, id: ++seq }]
}

/** The box's heading: about files when every problem is a file that didn't come in. */
export function problemsTitle(list: Pick<Problem, 'file'>[]) {
  if (list.length && list.every(p => p.file)) return list.length === 1 ? 'Couldn’t add a file' : `Couldn’t add ${list.length} files`
  return list.length > 1 ? `${list.length} things didn’t work` : 'Something didn’t work'
}

export function ImportProblems({ project, notice, onNoticeSeen }: { project: string | null; notice?: string | null; onNoticeSeen?: () => void }) {
  const [problems, setProblems] = useState<Problem[]>([])
  useEffect(() => window.agentshot.onImportFailed(p => setProblems(list => addProblem(list, p))), [])
  // a message from elsewhere in the app (App's notice) joins the same box, then is handed back as seen
  useEffect(() => {
    if (!notice) return
    setProblems(list => addProblem(list, { why: notice }))
    onNoticeSeen?.()
  }, [notice, onNoticeSeen])
  const dismiss = (id: number) => setProblems(list => list.filter(p => p.id !== id))
  const title = problemsTitle(problems)
  return (
    <D.Root open={problems.length > 0} onOpenChange={open => { if (!open) setProblems([]) }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-scrim backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content role="alertdialog" aria-live="assertive" data-testid="problem-dialog"
          className="fixed left-1/2 top-1/2 z-50 w-[460px] max-w-[calc(100vw-32px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-bad/50 bg-panel p-5 shadow-2xl shadow-shade focus:outline-none">
          <div className="mb-3 flex items-start gap-3">
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-bad/15 text-bad"><AlertTriangle className="size-4" /></div>
            <D.Title className="min-w-0 flex-1 self-center truncate text-[16px] font-bold text-bad" title={title}>{title}</D.Title>
            <D.Close aria-label="Close" className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></D.Close>
          </div>
          <D.Description className="sr-only">What went wrong and what to do next.</D.Description>
          <div className="space-y-3">
            {problems.map(p => (
              <div key={p.id} {...(p.file ? { 'data-import-problem': p.file } : { 'data-notice': '' })}
                className="rounded-xl border border-bad/30 bg-bad/5 p-3">
                {p.file && (
                  <div className="mb-1 flex items-center gap-1.5 font-medium" title={p.file}>
                    <FileWarning className="size-3.5 shrink-0 text-bad" /><span className="truncate">Couldn’t add {p.file}</span>
                  </div>
                )}
                <p className="text-[13px] leading-snug text-fg" data-selectable>{p.why}</p>
                <div className="flex gap-2 pt-3">
                  {p.file && project && <Button size="sm" variant="secondary" onClick={() => { dismiss(p.id); void pickFiles(project) }}>Choose another file…</Button>}
                  <Button size="sm" variant="ghost" onClick={() => dismiss(p.id)}>Dismiss</Button>
                </div>
              </div>
            ))}
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
