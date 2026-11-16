import { describe, expect, it } from 'vitest'
import { addProblem, problemsTitle } from '../src/renderer/src/components/ImportProblems'

describe('the problem box', () => {
  it('keeps the newest three and never shows the same problem twice', () => {
    let list = addProblem([], { file: 'a.mp4', why: 'It can’t be read.' })
    list = addProblem(list, { why: 'The agent could not start.' })
    list = addProblem(list, { file: 'a.mp4', why: 'It can’t be read.' })
    expect(list.map(p => p.file ?? p.why)).toEqual(['The agent could not start.', 'a.mp4'])
    list = addProblem(addProblem(list, { file: 'b.mp4', why: 'x' }), { file: 'c.mp4', why: 'x' })
    expect(list.map(p => p.file ?? p.why)).toEqual(['a.mp4', 'b.mp4', 'c.mp4'])
    expect(new Set(list.map(p => p.id)).size).toBe(3)
  })
  it('heads the box by what went wrong', () => {
    expect(problemsTitle([{ file: 'a.mp4' }])).toBe('Couldn’t add a file')
    expect(problemsTitle([{ file: 'a.mp4' }, { file: 'b.mp4' }])).toBe('Couldn’t add 2 files')
    expect(problemsTitle([{}])).toBe('Something didn’t work')
    expect(problemsTitle([{ file: 'a.mp4' }, {}])).toBe('2 things didn’t work')
  })
})
