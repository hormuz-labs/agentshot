// Background jobs in the title bar: quiet until something runs, one progress style for everything.
import { useEffect, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, Loader2, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Job } from '../../../shared/types'

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([])
  useEffect(() => { window.manul.jobs.list().then(setJobs); return window.manul.jobs.onChange(setJobs) }, [])
  return jobs
}

export function JobRow({ j }: { j: Job }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        {j.status === 'running' ? <Loader2 className="size-3.5 animate-spin text-amber" /> : j.status === 'done' ? <Check className="size-3.5 text-ok" /> : <TriangleAlert className="size-3.5 text-bad" />}
        <span className="flex-1 truncate">{j.status === 'done' && j.doneTitle ? j.doneTitle : j.title}</span>
        {j.status === 'running' && j.progress != null && <span className="tabular text-[11px] text-faint">{Math.round(j.progress * 100)}%</span>}
      </div>
      {j.status === 'running' && (
        <div className="h-1 overflow-hidden rounded-full bg-line">
          <div className={cn('h-full rounded-full bg-amber transition-[width]', j.progress == null && 'w-1/3 animate-pulse')} style={j.progress != null ? { width: `${j.progress * 100}%` } : undefined} />
        </div>
      )}
      {j.detail && <div className={cn('truncate text-[11px]', j.status === 'failed' ? 'whitespace-normal text-bad' : 'text-faint')} data-selectable>{j.detail}</div>}
    </div>
  )
}

export function JobsTray() {
  const jobs = useJobs()
  if (!jobs.length) return null
  const running = jobs.filter(j => j.status === 'running')
  const failed = jobs.some(j => j.status === 'failed')
  const avg = running.filter(j => j.progress != null)
  const pct = avg.length ? avg.reduce((s, j) => s + (j.progress || 0), 0) / avg.length : null
  return (
    <Popover.Root>
      <Popover.Trigger className="no-drag inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-dim hover:bg-hover hover:text-fg">
        {running.length ? <Loader2 className="size-3.5 animate-spin text-amber" /> : failed ? <TriangleAlert className="size-3.5 text-bad" /> : <Check className="size-3.5 text-ok" />}
        <span className="max-w-[180px] truncate">{running[0]?.title || (jobs[0].status === 'done' && jobs[0].doneTitle) || jobs[0].title}</span>
        {pct != null && <span className="tabular text-faint">{Math.round(pct * 100)}%</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 space-y-3 rounded-card border border-line bg-panel p-3 shadow-2xl shadow-shade">
          {jobs.map(j => <JobRow key={j.id} j={j} />)}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
