import { describe, expect, it } from 'vitest'
import { DemoBriefs } from '../src/main/demo-brief'
import { demoSummary } from '../src/shared/demo'
import { ChatMarkdown } from '../src/renderer/src/components/ChatMarkdown'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { editorExtension, type Bridge } from '../src/main/agent'

describe('required user layout brief', () => {
  it('composition itself terminates with layout questions before rendering guessed defaults', async () => {
    const briefs = new DemoBriefs(), calls: unknown[] = []
    briefs.input('chat', 'Sync these two recordings.')
    const bridge = { project: () => ({ dir: '/tmp/demo', media: { screen: { width: 1920, height: 1080 } } }), composeDemo: async (_d: string, req: unknown) => { calls.push(req); return { version: 'v2' } } } as unknown as Bridge
    const ext = editorExtension(bridge, () => '/tmp/demo', undefined, briefs) as unknown as { tools: { name: string; execute(args: object, api: object): Promise<{ content: { text: string }[]; control?: { terminate: boolean } }> }[] }
    const compose = ext.tools.find(t => t.name === 'compose_demo')!
    const first = await compose.execute({ screen: 'screen', camera: 'camera', corner: 'top-right', layout: { shape: 'circle', width: 384 } }, { conversationId: 'chat' })
    expect(first.control?.terminate).toBe(true)
    expect(JSON.parse(first.content[0].text).questions).toHaveLength(3)
    expect(calls).toHaveLength(0)
    briefs.input('chat', 'Square, bottom left, 300×300')
    await compose.execute({ screen: 'screen', camera: 'camera', corner: 'top-right', layout: { shape: 'circle', width: 384 } }, { conversationId: 'chat' })
    expect(calls[0]).toMatchObject({ corner: 'bottom-left', layout: { shape: 'square', width: 300, height: 300 } })
    expect(calls[0]).toMatchObject({ cleanup: 'natural' })
  })
  it('asks all missing layout choices even for a just-sync request', () => {
    const briefs = new DemoBriefs()
    briefs.input('one', 'Just sync my screen and face recording.')
    expect(briefs.resolve('one', 1920, 1080).questions).toHaveLength(3)
    briefs.input('one', 'Where should your face appear? → Bottom left\nWhat shape should your face video be? → Rounded rectangle\nHow large should your face video be? → Small · 15%')
    const result = briefs.resolve('one', 1920, 1080)
    expect(result.questions).toBeUndefined()
    expect(result).toMatchObject({ corner: 'bottom-left', layout: { shape: 'rounded', width: 288 } })
  })
  it('defaults to natural cleanup for normal syncing and preserves explicit keep-all through layout answers', () => {
    const briefs = new DemoBriefs()
    briefs.input('one', 'Please sync my recordings.')
    briefs.resolve('one', 1920, 1080)
    briefs.input('one', 'Circle, bottom right, medium 20%')
    expect(briefs.cleanup('one')).toBe('natural')
    briefs.input('two', 'Keep everything, sync only.')
    briefs.resolve('two', 1920, 1080)
    briefs.input('two', 'Circle, top right, medium 20%')
    expect(briefs.cleanup('two')).toBe('none')
    briefs.input('two', 'Trim tighter instead.')
    expect(briefs.cleanup('two')).toBe('tight')
  })
  it('asks only unspecified choices and accepts an explicit you-decide answer', () => {
    const briefs = new DemoBriefs()
    briefs.input('one', 'Put my face in a circle at top right.')
    expect(briefs.resolve('one', 1920, 1080).questions).toHaveLength(1)
    briefs.input('one', 'You decide: use your recommendations.')
    expect(briefs.resolve('one', 1920, 1080)).toMatchObject({ layout: { shape: 'circle', width: 384 } })
    briefs.input('two', 'Square, bottom-left, 300×300')
    expect(briefs.resolve('two', 1920, 1080)).toMatchObject({ layout: { shape: 'square', width: 300, height: 300 } })
  })
  it('does not let another conversation or a new request reuse an old unasked default', () => {
    const briefs = new DemoBriefs()
    briefs.input('one', 'Circle top right 20%')
    expect(briefs.resolve('one', 1920, 1080).questions).toBeUndefined()
    briefs.completed('one')
    briefs.input('one', 'Make another demo.')
    expect(briefs.resolve('one', 1920, 1080).questions).toHaveLength(3)
    expect(briefs.resolve('two', 1920, 1080).questions).toHaveLength(3)
  })
})

describe('clear edit summaries', () => {
  it('distinguishes stale footage from coverage trimming and never invents cuts', () => {
    expect(demoSummary(100, 60, 30, 10).message).toContain('removed 30 seconds of stale footage')
    expect(demoSummary(100, 60, 30, 10).message).toContain('10 seconds outside')
    expect(demoSummary(100, 100, 0).message).toContain('No clearly idle stretches were found')
    expect(demoSummary(100, 100, 0, 0, 'none').message).toContain('cleanup was skipped')
  })
  it('renders bold labels and lists without literal asterisks or executable HTML', () => {
    const html = renderToStaticMarkup(createElement(ChatMarkdown, { text: '- **Audio Sync**: Matched tracks.\n- **Layout**: Top right circle.\n\nRemoved **30 seconds**. <script>alert(1)</script>' }))
    expect(html).toContain('<strong')
    expect(html).toContain('<ul')
    expect(html).not.toContain('**')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
