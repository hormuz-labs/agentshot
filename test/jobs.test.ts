import { describe, expect, it, vi } from 'vitest'
import { asJob, listJobs, onJobs, startJob } from '../src/main/jobs'

describe('jobs', () => {
  it('reports progress, then done with its finished title', async () => {
    const seen: string[] = []
    const off = onJobs(js => js.forEach(j => seen.push(`${j.status}:${j.progress}`)))
    const j = startJob('Installing X', 'install', { doneTitle: 'Installed X' })
    j.progress(0.5, 'half')
    j.done()
    off()
    expect(seen[0]).toBe('running:null')
    expect(seen).toContain('running:0.5')
    expect(listJobs().find(x => x.id === j.id)).toMatchObject({ status: 'done', progress: 1, doneTitle: 'Installed X' })
  })

  it('asJob marks failures and rethrows', async () => {
    await expect(asJob('Boom', 'render', async () => { throw new Error('nope') })).rejects.toThrow('nope')
    // the tray says why in plain words (the raw error goes to the log)
    expect(listJobs().find(j => j.title === 'Boom')).toMatchObject({ status: 'failed', detail: expect.stringMatching(/^Something went wrong on the computer/) })
    await expect(asJob('Full', 'render', async () => { throw Object.assign(new Error('ENOSPC: no space left on device'), { code: 'ENOSPC' }) })).rejects.toThrow()
    expect(listJobs().find(j => j.title === 'Full')?.detail).toMatch(/disk is full/)
  })

  it('finished jobs leave the list after a while', async () => {
    vi.useFakeTimers()
    const j = startJob('Short', 'import')
    j.done()
    vi.advanceTimersByTime(9000)
    expect(listJobs().some(x => x.id === j.id)).toBe(false)
    vi.useRealTimers()
  })
})
