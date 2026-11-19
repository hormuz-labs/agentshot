import { describe, expect, it, vi } from 'vitest'
import { canMapTranscript, transcriptFromTimeline } from '../src/main/transcript-timeline'
import type { Timeline } from '../src/shared/timeline'

const tl: Timeline = { width: 640, height: 360, fps: 30, items: [
  { id: 'a', kind: 'media', src: 'source.mp4', in: 10, out: 20 },
  { id: 'b', kind: 'media', src: 'source.mp4', in: 30, out: 40 },
] }
const read = vi.fn(async (_src, r) => ({ media: 'source.mp4', language: 'en', model: 'base', createdAt: 1,
  segments: [{ s: r.t0 + 1, e: r.t0 + 2, text: 'hello', words: [{ w: 'hello', s: r.t0 + 1, e: r.t0 + 2 }] }] }))
describe('source transcript remapping', () => {
  it('maps cuts and repeated/reordered sources to output-relative word timings', async () => {
    const t = await transcriptFromTimeline(tl, 'render.mp4', read)
    expect(t?.segments.flatMap(s => s.words).map(w => w.s)).toEqual([1, 11])
  })
  it('reads only source ranges intersecting an output excerpt and respects mute', async () => {
    read.mockClear()
    const t = await transcriptFromTimeline(tl, 'render.mp4', read, { t0: 12, t1: 17 })
    expect(read).toHaveBeenCalledExactlyOnceWith('source.mp4', { t0: 32, t1: 37 })
    expect(t?.segments[0].s).toBe(13)
    const muted = { ...tl, items: tl.items.map(i => ({ ...i, muted: true })) }
    expect((await transcriptFromTimeline(muted, 'render.mp4', read))?.segments).toEqual([])
  })
  it('falls back to actual listening for mixed/new audio or self-references', () => {
    expect(canMapTranscript({ ...tl, mix: { filmDb: 0, music: { src: 'music.mp3', db: -6, duckDb: 0 } } }, 'render.mp4')).toBe(false)
    expect(canMapTranscript(tl, 'source.mp4')).toBe(false)
    expect(canMapTranscript({ ...tl, items: [{ id: 'c', kind: 'clip', clip: 'title', dur: 3 }] }, 'render.mp4')).toBe(false)
  })
})
