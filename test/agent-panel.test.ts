import type { Message } from '@ag-ui/core'
import { describe, expect, it } from 'vitest'
import { askAnswer, foldWork, shellTitle, YOU_DECIDE } from '../src/renderer/src/views/AgentPanel'

describe('shell commands as sentences', () => {
  it('a script says what its first comment says', () => {
    expect(shellTitle(`python3 -c "\n# Let's inspect brightness to understand each section\nfrom PIL import Image\n"`)).toBe('Inspect brightness to understand each section')
    expect(shellTitle(`python3 -c "\nfrom PIL import Image\nprint(1)\n"`)).toBe('Ran a small program')
  })

  it('known tools by what they do', () => {
    expect(shellTitle('/opt/homebrew/bin/ffmpeg -i media/a.mp4 -c:v libx264 renders/out.mp4 -y')).toBe('Worked on the video')
    expect(shellTitle('ffmpeg -i media/a.mp4 -c:v libx264 renders/out.mp4')).toBe('Made out.mp4')
    expect(shellTitle('ffprobe -v error media/a.mp4')).toBe('Checked a.mp4')
    expect(shellTitle('curl -sS -X POST "https://api.elevenlabs.io/v1/music" -d @x.json')).toBe('Fetched from api.elevenlabs.io')
  })

  it('everything else in words, never the command (that is under Show details)', () => {
    expect(shellTitle('ls renders')).toBe('Looked through the project’s files')
    expect(shellTitle('head -n 40 media/notes.txt')).toBe('Read notes.txt')
    expect(shellTitle('grep -n "title" project.json')).toBe('Searched project.json')
    expect(shellTitle('x'.repeat(100))).toBe('Worked on the computer')
  })
})

describe('the work between things said, as one card', () => {
  let n = 0
  const user = (text: string): Message => ({ id: `u${n++}`, role: 'user', content: text })
  const step = (name = 'bash', args = '{}'): Message => ({ id: `a${n++}`, role: 'assistant', toolCalls: [{ id: `c${n}`, type: 'function', function: { name, arguments: args } }] })
  const reply = (text: string): Message => ({ id: `a${n++}`, role: 'assistant', content: text })
  const shape = (ms: Message[], results = {}) => foldWork(ms, results).map(b => (b.kind === 'work' ? `work×${b.calls.length}` : b.m.role))

  it('every step between two things said is one card, whatever the tool', () => {
    const ms = [user('go'), step(), step(), step('read'), step('propose_version'), reply('done'), step('rerender_timeline')]
    expect(shape(ms)).toEqual(['user', 'work×4', 'assistant', 'work×1'])
  })

  it('a question is its own card, between the work before and after it', () => {
    const ms = [user('go'), step(), step('ask_user', '{"question":"Which?","options":[{"label":"A"}]}'), step()]
    expect(shape(ms)).toEqual(['user', 'work×1', 'assistant', 'work×1'])
  })

  it('keeps each message\'s index in the conversation (for answered questions)', () => {
    const ms = [user('go'), step(), step(), reply('ok'), user('more')]
    expect(foldWork(ms, {}).filter(b => b.kind === 'msg').map(b => b.i)).toEqual([0, 3, 4])
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
