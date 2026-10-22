// Background jobs (downloads, installs, transcriptions, renders): one list, one progress style, shown in the tray.
import type { Job } from '../shared/types'

type Listener = (jobs: Job[]) => void
const jobs = new Map<string, Job>()
const listeners = new Set<Listener>()
let seq = 0

const emit = () => { const list = [...jobs.values()]; listeners.forEach(l => l(list)) }

export const onJobs = (l: Listener) => { listeners.add(l); return () => listeners.delete(l) }
export const listJobs = () => [...jobs.values()]

export type JobHandle = {
  id: string
  /** progress 0–1, or null for "working, no estimate" */
  progress(p: number | null, detail?: string): void
  done(detail?: string): void
  fail(err: unknown): void
}

export type JobOptions = { project?: string; doneTitle?: string }

export function startJob(title: string, kind: Job['kind'], opts: JobOptions = {}): JobHandle {
  const id = `job${++seq}`
  jobs.set(id, { id, title, kind, ...opts, status: 'running', progress: null, startedAt: Date.now() })
  emit()
  const set = (patch: Partial<Job>) => { const j = jobs.get(id); if (j) { jobs.set(id, { ...j, ...patch }); emit() } }
  const settle = (patch: Partial<Job>) => {
    set({ ...patch, endedAt: Date.now() })
    setTimeout(() => { jobs.delete(id); emit() }, patch.status === 'failed' ? 60_000 : 8_000) // finished jobs linger briefly
  }
  let last = 0
  return {
    id,
    progress(p, detail) {
      const now = Date.now()
      if (now - last < 150 && p !== 1) return // throttle IPC
      last = now
      set({ progress: p, ...(detail !== undefined ? { detail } : {}) })
    },
    done: detail => settle({ status: 'done', progress: 1, detail }),
    fail: err => settle({ status: 'failed', detail: err instanceof Error ? err.message : String(err) }),
  }
}

/** Run fn as a job: progress, done and failure are reported for you (doneDetail: a line under it when done, from fn's result). */
export async function asJob<T>(title: string, kind: Job['kind'], fn: (j: JobHandle) => Promise<T>, opts: JobOptions & { doneDetail?(r: T): string | undefined } = {}): Promise<T> {
  const { doneDetail, ...job } = opts
  const j = startJob(title, kind, job)
  try {
    const r = await fn(j)
    j.done(doneDetail?.(r))
    return r
  } catch (e) {
    j.fail(e)
    throw e
  }
}
