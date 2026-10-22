// Editing by hand: split, cut, delete, move, trim, volume, insert; every edit ripples and overlays stay on their
// footage. Plus the time mapping the transcript uses while the edit plays from its pieces.
import { describe, expect, it } from 'vitest'
import { applyEdit, batch, composeArgs, cutRange, describeEdit, duration, fromMedia, insertAt, keepOverlays, keptOf, nextKept, rangesOf, sameCut, sourceAt, starts, timelineOfFile, timeOf, type Item, type Timeline } from '../src/shared/timeline'

const base = (): Timeline => fromMedia('media/a.mp4', 10, { width: 1280, height: 720, fps: 30 })
const ranges = (tl: Timeline) => tl.items.map(i => (i.kind === 'media' ? [i.src.slice(6), i.in, i.out] : ['clip', i.dur]))
const maxOf = (it: Item) => (it.kind === 'media' ? ({ 'media/a.mp4': 10, 'media/b.mp4': 6 } as Record<string, number>)[it.src] : 3)

describe('editing the timeline', () => {
  it('cuts a range out and closes the gap', () => {
    const tl = applyEdit(base(), { op: 'cut', from: 2, to: 5 })
    expect(ranges(tl)).toEqual([['a.mp4', 0, 2], ['a.mp4', 5, 10]])
    expect(duration(tl)).toBe(7)
    // the order of from/to does not matter, and a cut past the end stops at the end
    expect(ranges(cutRange(base(), 9, 8))).toEqual([['a.mp4', 0, 8], ['a.mp4', 9, 10]])
    expect(ranges(cutRange(base(), 8, 50))).toEqual([['a.mp4', 0, 8]])
  })

  it('cuts across pieces, and keeps a clip the cut only partly covers', () => {
    let tl = insertAt(base(), 4, { kind: 'clip', clip: 'card', dur: 2 }).timeline // a 0–4 · card 4–6 · a 4–10 (6–12)
    tl = applyEdit(tl, { op: 'cut', from: 3, to: 7 })
    expect(ranges(tl)).toEqual([['a.mp4', 0, 3], ['a.mp4', 5, 10]])
    tl = insertAt(base(), 4, { kind: 'clip', clip: 'card', dur: 2 }).timeline
    expect(ranges(applyEdit(tl, { op: 'cut', from: 5, to: 7 }))).toEqual([['a.mp4', 0, 4], ['clip', 2], ['a.mp4', 5, 10]])
  })

  it('never leaves the film empty', () => {
    expect(() => applyEdit(base(), { op: 'cut', from: 0, to: 10 })).toThrow(/at least one piece/)
    const tl = base()
    expect(() => applyEdit(tl, { op: 'delete', ids: [tl.items[0].id] })).toThrow()
  })

  it('splits, deletes and moves pieces', () => {
    let tl = applyEdit(applyEdit(base(), { op: 'split', at: 3 }), { op: 'split', at: 6 })
    expect(ranges(tl)).toEqual([['a.mp4', 0, 3], ['a.mp4', 3, 6], ['a.mp4', 6, 10]])
    const [x, y, z] = tl.items.map(i => i.id)
    expect(ranges(applyEdit(tl, { op: 'move', id: z, before: x }))).toEqual([['a.mp4', 6, 10], ['a.mp4', 0, 3], ['a.mp4', 3, 6]])
    expect(ranges(applyEdit(tl, { op: 'move', id: x }))).toEqual([['a.mp4', 3, 6], ['a.mp4', 6, 10], ['a.mp4', 0, 3]])
    expect(applyEdit(tl, { op: 'move', id: y, before: y })).toBe(tl)
    tl = applyEdit(tl, { op: 'delete', ids: [y] })
    expect(ranges(tl)).toEqual([['a.mp4', 0, 3], ['a.mp4', 6, 10]])
    expect(duration(tl)).toBe(7)
  })

  it('trims within the file and never below a frame (or 40 ms)', () => {
    const tl = applyEdit(base(), { op: 'split', at: 5 })
    const [a, b] = tl.items.map(i => i.id)
    expect(ranges(applyEdit(tl, { op: 'trim', id: a, in: 1, out: 4 }, maxOf))).toEqual([['a.mp4', 1, 4], ['a.mp4', 5, 10]])
    expect(ranges(applyEdit(tl, { op: 'trim', id: b, out: 99 }, maxOf))).toEqual([['a.mp4', 0, 5], ['a.mp4', 5, 10]])
    expect(ranges(applyEdit(tl, { op: 'trim', id: b, in: -3 }, maxOf))).toEqual([['a.mp4', 0, 5], ['a.mp4', 0, 10]])
    const tiny = applyEdit(tl, { op: 'trim', id: a, in: 3, out: 3 }, maxOf).items[0]
    expect(tiny.kind === 'media' && tiny.out - tiny.in).toBeCloseTo(0.04, 3)
  })

  it('sets a piece louder, quieter or silent, and the render follows', () => {
    let tl = applyEdit(base(), { op: 'split', at: 5 })
    const [a, b] = tl.items.map(i => i.id)
    tl = applyEdit(tl, { op: 'level', ids: [a], db: -6 })
    tl = applyEdit(tl, { op: 'level', ids: [b], muted: true })
    expect(tl.items.map(i => i.kind === 'media' && [i.db, i.muted])).toEqual([[-6, undefined], [undefined, true]])
    expect(applyEdit(tl, { op: 'level', ids: [a], db: 99 }).items[0]).toMatchObject({ db: 12 })
    expect(applyEdit(tl, { op: 'level', ids: [a], db: 0 }).items[0]).not.toHaveProperty('db')
    const fc = composeArgs(tl, { inputOf: () => 'media/a.mp4', hasAudio: () => true, out: 'o.mp4' })[3]
    expect(fc).toMatch(/,volume=-6dB\[a0\]/)
    expect(fc).toMatch(/,volume=0\[a1\]/)
    // pieces meet with 10 ms fades (no click at a cut); one whole file has none
    expect(fc).toContain('afade=t=in:d=0.01,afade=t=out:st=4.99:d=0.01')
    expect(composeArgs(base(), { inputOf: () => 'media/a.mp4', hasAudio: () => true, out: 'o.mp4' })[3]).not.toContain('afade')
  })

  it('inserts footage at a moment', () => {
    const tl = applyEdit(base(), { op: 'insert', at: 4, src: 'media/b.mp4', in: 0, out: 6 })
    expect(ranges(tl)).toEqual([['a.mp4', 0, 4], ['b.mp4', 0, 6], ['a.mp4', 4, 10]])
  })

  it('knows when nothing changed (ids aside)', () => {
    const a = base(), b = base()
    expect(sameCut(a, b)).toBe(true)
    expect(sameCut(a, applyEdit(a, { op: 'split', at: 4 }))).toBe(false)
    expect(sameCut(a, { ...b, mix: { filmDb: 0 } })).toBe(true)
    expect(sameCut(a, applyEdit(a, { op: 'mix', mix: { filmDb: -3 } }))).toBe(false)
    expect(sameCut(timelineOfFile('media/a.mp4', { duration: 10, width: 1279, height: 720, fps: 29.97 }), timelineOfFile('media/a.mp4', { duration: 10, width: 1279, height: 720, fps: 29.97 }))).toBe(true)
  })

  it('describes each edit in a few words', () => {
    expect(describeEdit({ op: 'cut', from: 75, to: 62 })).toBe('Cut 1:02–1:15')
    expect(describeEdit({ op: 'level', ids: ['x'], db: -6 })).toBe('Volume -6 dB')
  })
})

describe('overlays stay on their footage', () => {
  const withOverlay = (start: number, dur: number): Timeline => ({ ...base(), overlays: [{ id: 'o', clip: 'lower-third', start, dur }] })

  it('moves up when footage before it is cut', () => {
    expect(applyEdit(withOverlay(6, 2), { op: 'cut', from: 1, to: 3 }).overlays).toEqual([{ id: 'o', clip: 'lower-third', start: 4, dur: 2 }])
  })

  it('shrinks when footage under it is cut, and starts at its first kept moment', () => {
    expect(applyEdit(withOverlay(2, 6), { op: 'cut', from: 4, to: 5 }).overlays).toMatchObject([{ start: 2, dur: 5 }])
    expect(applyEdit(withOverlay(2, 6), { op: 'cut', from: 0, to: 3 }).overlays).toMatchObject([{ start: 0, dur: 5 }])
  })

  it('goes when all its footage is cut, and follows its piece when moved', () => {
    expect(applyEdit(withOverlay(4, 1), { op: 'cut', from: 3, to: 6 }).overlays).toEqual([])
    const tl = applyEdit(withOverlay(7, 1), { op: 'split', at: 6 })
    const moved = applyEdit(tl, { op: 'move', id: tl.items[1].id, before: tl.items[0].id }) // 6–10 first, then 0–6
    expect(moved.overlays).toMatchObject([{ start: 1, dur: 1 }])
  })

  it('is left alone by a volume change', () => {
    const tl = withOverlay(2, 3)
    expect(keepOverlays(tl, applyEdit(tl, { op: 'level', ids: [tl.items[0].id], db: -3 }))).toEqual(tl.overlays)
  })
})

describe('the edit and its files', () => {
  // a 0–2 · a 5–10 · b 0–6 (13 s)
  const tl = applyEdit(applyEdit(base(), { op: 'cut', from: 2, to: 5 }), { op: 'insert', at: 7, src: 'media/b.mp4', in: 0, out: 6 })

  it('maps the film time to the moment of a file and back', () => {
    expect(starts(tl)).toEqual([0, 2, 7])
    expect(sourceAt(tl, 3)).toMatchObject({ index: 1, at: 6 })
    expect(sourceAt(tl, 8)).toMatchObject({ index: 2, at: 1 })
    expect(timeOf(tl, 'media/a.mp4', 6)).toBe(3)
    expect(timeOf(tl, 'media/a.mp4', 3)).toBeNull() // cut
    expect(nextKept(tl, 'media/a.mp4', 3)).toBe(2)
    expect(nextKept(tl, 'media/a.mp4', 11)).toBeNull()
    expect(timeOf(tl, 'media/b.mp4', 1)).toBe(8)
  })

  it('lists the parts of a file the edit keeps', () => {
    expect(keptOf(tl, 'media/a.mp4')).toEqual([[0, 2], [5, 10]])
    expect(keptOf(applyEdit(base(), { op: 'split', at: 4 }), 'media/a.mp4')).toEqual([[0, 10]])
  })
})

describe('the agent edits many things at once', () => {
  it('cuts word ranges given in file times, all against the film as it was', () => {
    const tl = applyEdit(base(), { op: 'cut', from: 2, to: 3 }) // a 0–2 · a 3–10
    const edits = batch(tl, [{ op: 'cut', from: 1, to: 1.5, src: 'media/a.mp4' }, { op: 'cut', from: 4, to: 5, src: 'media/a.mp4' }, { op: 'cut', from: 4.8, to: 6, src: 'media/a.mp4' }, { op: 'split', at: 8 }])
    const after = edits.reduce((t, e) => applyEdit(t, e), tl)
    expect(ranges(after)).toEqual([['a.mp4', 0, 1], ['a.mp4', 1.5, 2], ['a.mp4', 3, 4], ['a.mp4', 6, 9], ['a.mp4', 9, 10]])
    expect(rangesOf(tl, 'media/a.mp4', 1, 4)).toEqual([[1, 2], [2, 3]])
  })
})
