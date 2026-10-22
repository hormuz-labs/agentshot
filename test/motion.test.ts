import { describe, expect, it } from 'vitest'
import { motionBrief } from '../src/main/agent'
import { aspectOf } from '../src/shared/motion-formats'
import type { GalleryExample, Project } from '../src/shared/types'

const project = (motion?: Project['motion']) => ({ id: 'p', title: 't', dir: '/x', createdAt: 0, versions: [], current: '', notes: [], media: {}, motion }) as Project
const ex = (o: Partial<GalleryExample>): GalleryExample => ({
  id: 'ultimaxbt-bbebf5', title: 'Orange dot motion system', creator: { name: 'ultima', handle: 'ultimaxbt' }, source: 'https://prompt-motion.com/ultimaxbt-bbebf5',
  kind: 'prompt', tags: [], video: '', poster: '', ...o,
})

describe('motion videos', () => {
  it('picks the closest format for an example', () => {
    expect(aspectOf({ width: 1920, height: 1078 })).toBe('16:9')
    expect(aspectOf({ width: 1080, height: 1920 })).toBe('9:16')
    expect(aspectOf({ width: 1080, height: 1080 })).toBe('1:1')
  })

  it('adds nothing to an editing project', () => {
    expect(motionBrief(project())).toBe('')
    expect(motionBrief(undefined)).toBe('')
  })

  it('gives the agent the example’s prompt, its maker, and Manul’s way to build it', () => {
    const lookup = () => ex({ prompt: '<inputs>\nAsk me for: one hero word.\n</inputs>\n<build>One HTML file, seek(t)</build>' })
    const b = motionBrief(project({ aspect: '16:9', canvas: 'media/canvas.mp4', reference: 'media/ultimaxbt-bbebf5.mp4',
      example: { id: 'ultimaxbt-bbebf5', title: 'Orange dot motion system', handle: 'ultimaxbt', post: 'https://x.com/ultimaxbt/status/1' } }), lookup)
    expect(b).toContain('1920x1080')
    expect(b).toContain('"Orange dot motion system" by @ultimaxbt (https://x.com/ultimaxbt/status/1)')
    expect(b).toContain('<example_prompt>\n<inputs>\nAsk me for: one hero word.')
    expect(b).toMatch(/use Manul's motion clips instead/)
    expect(b).toContain('Reference video: media/ultimaxbt-bbebf5.mp4')
    expect(b).toMatch(/Storyboard before any code/)
  })

  it('works from the video when the example was made with a skill', () => {
    const b = motionBrief(project({ aspect: '16:9', canvas: 'c', example: { id: 'x', title: 'Launch', handle: 'a' } }), () => ex({ kind: 'skill', skill: 'https://github.com/a/b' }))
    expect(b).toContain('made with a skill (https://github.com/a/b)')
    expect(b).not.toContain('<example_prompt>')
  })
})

describe('what an example asks for', async () => {
  const { inputsOf } = await import('../src/renderer/src/components/Gallery')
  it('says the first sentence of "Ask me for" to the user, kept short', () => {
    expect(inputsOf('<inputs>\nAsk me for: my product, the exact request a user types into it, 6 to 8 photos for the result cards, a royalty-free song around 130 BPM with a clear drop, and my brand mark for the end card. If I skip anything, use the defaults.\n</inputs>'))
      .toBe('your product, the exact request a user types into it, 6 to 8 photos for the result cards, and more')
    expect(inputsOf('Ask me for: one hero word.')).toBe('one hero word')
    expect(inputsOf('no inputs here')).toBeNull()
  })
})
