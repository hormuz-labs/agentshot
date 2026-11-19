import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranscriptChunks, wordsInRange, stitchChunks, type TranscriptRange } from '../src/main/transcript-chunks'
import { TranscriptionQueue } from '../src/main/transcription-queue'
import type { Transcript } from '../src/shared/types'

const dirs: string[] = []
function fixture() {
  const cache = mkdtempSync(join(tmpdir(), 'speech-chunks-')); dirs.push(cache)
  const file = join(cache, 'source.wav'); writeFileSync(file, 'source')
  const run = vi.fn(async (r: TranscriptRange): Promise<Transcript> => {
    const s = r.t0 ? r.t0 + 3 : 3
    return { media: file, language: 'en', model: 'base', createdAt: 1, segments: [{ s, e: s + 1, text: 'um', words: [{ w: 'um', s, e: s + 1 }] }] }
  })
  return { file, cache, duration: 180, profile: 'base-v1', run }
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('durable source chunks', () => {
  it('resumes only missing chunks with a new service after an interruption', async () => {
    const o = fixture()
    o.run.mockRejectedValueOnce(new Error('interrupted'))
    await expect(new TranscriptChunks().read(o)).rejects.toThrow('interrupted')
    const completed = o.run.mock.calls.length - 1
    o.run.mockClear()
    const t = await new TranscriptChunks().read(o)
    expect(o.run).toHaveBeenCalledTimes(3 - completed)
    expect(t.segments.flatMap(s => s.words).map(w => w.s)).toEqual([3, 61, 121])
    expect(readdirSync(o.cache, { recursive: true }).some(f => String(f).endsWith('.tmp'))).toBe(false)
  })

  it('shares chunks between partial requests and full indexing, retaining source times', async () => {
    const o = fixture(), service = new TranscriptChunks()
    const excerpt = await service.read({ ...o, range: { t0: 60, t1: 80 } })
    expect(excerpt.segments[0].s).toBe(61)
    expect(o.run).toHaveBeenCalledTimes(1)
    await service.read(o)
    expect(o.run).toHaveBeenCalledTimes(3)
    await new TranscriptChunks().read({ ...o, range: { t0: 65, t1: 75 } })
    expect(o.run).toHaveBeenCalledTimes(3)
  })

  it('coalesces concurrent full/range requests and invalidates on profile or media revision', async () => {
    const o = fixture(), service = new TranscriptChunks()
    await Promise.all([service.read(o), service.read({ ...o, range: { t0: 0, t1: 20 } })])
    expect(o.run).toHaveBeenCalledTimes(3)
    await service.read({ ...o, profile: 'base-beam1' })
    expect(o.run).toHaveBeenCalledTimes(6)
    writeFileSync(o.file, 'new source')
    await service.read(o)
    expect(o.run).toHaveBeenCalledTimes(9)
  })

  it('does not assign boundary words twice or discard words crossing a chunk edge', () => {
    const segments = [{ s: 59.8, e: 60.2, text: 'hello', words: [{ w: 'hello', s: 59.8, e: 60.2 }] }]
    expect(wordsInRange(segments, { t0: 0, t1: 60 })).toHaveLength(0)
    expect(wordsInRange(segments, { t0: 60, t1: 120 })[0].words).toHaveLength(1)
  })
  it('stitches overlapping duplicate boundary alignments but keeps genuine repetitions', () => {
    const segment = (s: number, e: number) => ({ s, e, text: 'we', words: [{ w: 'we', s, e }] })
    const chunks = [[segment(59.44, 60.05)], [segment(60.04, 60.06), segment(60.1, 60.3)]]
    expect(stitchChunks(chunks).flatMap(s => s.words).map(w => w.s)).toEqual([59.44, 60.1])
    expect(chunks[1]).toHaveLength(2)
  })

  it('ignores corrupt checkpoints and rebuilds only those chunks', async () => {
    const o = fixture(), service = new TranscriptChunks()
    await service.read(o)
    const path = readdirSync(o.cache, { recursive: true }).find(f => String(f).endsWith('1.json'))!
    writeFileSync(join(o.cache, String(path)), '{broken')
    o.run.mockClear()
    await service.read(o)
    expect(o.run).toHaveBeenCalledTimes(1)
  })
})

describe('interactive scheduling', () => {
  it('holds background work during rendering but lets interactive dependencies finish', async () => {
    const queue = new TranscriptionQueue(1), order: string[] = []
    queue.setRendering(true)
    const background = queue.add('source:0', false, async () => { order.push('background') })
    await queue.add('selection:0', true, async () => { order.push('selection') })
    expect(order).toEqual(['selection'])
    queue.setRendering(false)
    await background
    expect(order).toEqual(['selection', 'background'])
  })

  it('promotes an awaited background chunk to avoid a render/transcript deadlock', async () => {
    const queue = new TranscriptionQueue(1)
    queue.setRendering(true)
    const task = queue.add('file/1:', false, async () => 42)
    queue.promote('file/1:')
    expect(await task).toBe(42)
  })

  it('rejects queued work on shutdown instead of spawning new children', async () => {
    const queue = new TranscriptionQueue(1), run = vi.fn()
    queue.setRendering(true)
    const task = queue.add('background', false, run)
    const check = expect(task).rejects.toThrow('resume')
    queue.close()
    await check
    await expect(queue.add('late', true, run)).rejects.toThrow('resume')
    expect(run).not.toHaveBeenCalled()
  })
})
