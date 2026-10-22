import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'
import { askAnswer, foldSteps, shellTitle, YOU_DECIDE } from '../src/renderer/src/views/AgentPanel'

describe('shell commands as sentences', () => {
  it('a script says what its first comment says', () => {
    expect(shellTitle(`python3 -c "\n# Let's inspect brightness to understand each section\nfrom PIL import Image\n"`)).toBe('Inspect brightness to understand each section')
    expect(shellTitle(`python3 -c "\nfrom PIL import Image\nprint(1)\n"`)).toBe('Ran a python script')
  })

  it('known tools by what they do', () => {
    expect(shellTitle('/opt/homebrew/bin/ffmpeg -i media/a.mp4 -c:v libx264 renders/out.mp4 -y')).toBe('Ran ffmpeg')
    expect(shellTitle('ffmpeg -i media/a.mp4 -c:v libx264 renders/out.mp4')).toBe('Rendering out.mp4')
    expect(shellTitle('ffprobe -v error media/a.mp4')).toBe('Read file details')
    expect(shellTitle('curl -sS -X POST "https://api.elevenlabs.io/v1/music" -d @x.json')).toBe('Called api.elevenlabs.io')
  })

  it('anything else by its first line, shortened', () => {
    expect(shellTitle('ls renders')).toBe('ls renders')
    expect(shellTitle('x'.repeat(100))).toHaveLength(64)
  })
})

describe('folding runs of small steps', () => {
  let n = 0
  const user = (text: string): Message => ({ id: `u${n++}`, role: 'user', content: text })
  const step = (name = 'bash'): Message => ({ id: `a${n++}`, role: 'assistant', toolCalls: [{ id: `c${n}`, type: 'function', function: { name, arguments: '{}' } }] })
  const reply = (text: string): Message => ({ id: `a${n++}`, role: 'assistant', content: text })

  it('three or more shell steps in a row become one block; fewer, or real tools, stay as they are', () => {
    const ms = [user('go'), step(), step(), step('read'), step(), step('propose_version'), step(), step(), reply('done')]
    expect(foldSteps(ms).map(b => (b.kind === 'steps' ? `steps×${b.ms.length}` : b.m.role))).toEqual(
      ['user', 'steps×4', 'assistant', 'assistant', 'assistant', 'assistant'])
  })

  it('keeps each item\'s index in the conversation (for answered questions)', () => {
    const ms = [user('go'), step(), step(), step(), reply('ok')]
    expect(foldSteps(ms).map(b => b.i)).toEqual([0, 1, 4])
  })
})

describe('answers from a question card', () => {
  const o = (...l: string[]) => l.map(label => ({ label }))
  it('one plain question answers with the label; a checklist with what stays ticked', () => {
    expect(askAnswer([{ question: 'Length?', options: o('30 s', '60 s') }], [['60 s']])).toBe('60 s')
    expect(askAnswer([{ question: 'Fixes?', options: o('Stabilise', 'Grade'), multiple: true }], [['Stabilise', 'Grade']])).toBe('Apply: Stabilise; Grade')
    expect(askAnswer([{ question: 'Fixes?', options: o('Stabilise'), multiple: true }], [[]])).toBe('None of these.')
  })

  it('several questions answer in one message, one line each', () => {
    const qs = [{ question: 'What is it for?', options: o('Instagram Reel', 'YouTube') }, { question: 'Add?', options: o('Captions', 'Music'), multiple: true }]
    expect(askAnswer(qs, [['Instagram Reel'], ['Captions', 'Music']])).toBe('What is it for? → Instagram Reel\nAdd? → Captions, Music')
    expect(askAnswer(qs, [['YouTube'], []])).toBe('What is it for? → YouTube\nAdd? → none')
    expect(YOU_DECIDE).toMatch(/recommend/)
  })
})
