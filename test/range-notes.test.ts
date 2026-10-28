import { describe, expect, it, vi } from 'vitest'
import { mobileArgs } from '../src/main/mobile-contract'
import { rangeNotesContent } from '../src/main/range-notes'
import { appendRange, parseRangeNotes } from '../src/shared/range-notes'

describe('timeline ranges in the chat draft', () => {
  it('appends at the end, preserving earlier instructions and subsecond timestamps', () => {
    let draft = appendRange('Make this cinematic', 1.25, 3.5) + 'Remove this pause'
    draft = appendRange(draft, 6, 8) + 'Brighten this shot'
    expect(draft).toBe('Make this cinematic\nFrom 1.250s to 3.500s: Remove this pause\nFrom 6.000s to 8.000s: Brighten this shot')
    expect(mobileArgs('agent:send', ['/p', { text: draft }])).toEqual(['/p', { text: draft }])
    expect(parseRangeNotes(draft)).toEqual([
      { anchor: { t0: 1.25, t1: 3.5 }, text: 'Remove this pause' },
      { anchor: { t0: 6, t1: 8 }, text: 'Brighten this shot' },
    ])
  })

  it('reads manually edited timestamps and multiline instructions from the actual text', () => {
    const draft = '2:4 Remove pause\nKeep the music.\n3.5:7 Add a title'
    expect(parseRangeNotes(draft)).toEqual([
      { anchor: { t0: 2, t1: 4 }, text: 'Remove pause\nKeep the music.' },
      { anchor: { t0: 3.5, t1: 7 }, text: 'Add a title' },
    ])
    expect(parseRangeNotes('A normal message with 12:30 in the middle')).toEqual([])
    expect(appendRange('', 0, 1)).toBe('From 0.000s to 1.000s: ')
  })

  it('creates independent notes and gives the agent original-timeline semantics', async () => {
    let id = 0
    const save = vi.fn(async () => ({ id: `n${++id}` }))
    const notes = parseRangeNotes('1.25:3.5 Cut\n6:8 Brighten')
    const content = await rangeNotesContent(notes, save)
    expect(save).toHaveBeenNthCalledWith(1, notes[0])
    expect(save).toHaveBeenNthCalledWith(2, notes[1])
    expect(content).toContain('[note n1 @ 1.250–3.500 seconds] Cut')
    expect(content).toContain('[note n2 @ 6.000–8.000 seconds] Brighten')
    expect(content).toContain('same film before these edits')
  })

  it('validates all parsed notes before saving', async () => {
    const save = vi.fn(async () => ({ id: 'n' }))
    await expect(rangeNotesContent(parseRangeNotes('1:3 Cut\n8:6 Brighten'), save)).rejects.toThrow()
    expect(save).not.toHaveBeenCalled()
  })
})
