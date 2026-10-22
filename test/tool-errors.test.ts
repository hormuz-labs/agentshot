import { describe, expect, it } from 'vitest'
import { toolErrorHint } from '../src/shared/tool-errors'
import { editorExtension, type Bridge } from '../src/main/agent'

describe('actionable tool failures', () => {
  it('distinguishes shell sandbox refusals, preview state and invalid options', () => {
    expect(toolErrorHint('bash', 'ls: ..: Operation not permitted')).toContain('Bash is working')
    expect(toolErrorHint('edit_timeline', 'Accept or reject the proposed version first, then edit.')).toContain('preview is awaiting')
    expect(toolErrorHint('bash', "Unrecognized option 'vsync'.")).toContain('does not support')
  })
  it('gives the agent a tool to resolve a preview without file or shell probing', async () => {
    const decisions: boolean[] = []
    const bridge = { project: () => ({ dir: '/tmp/project' }), decideVersion: async (_dir: string, accept: boolean) => { decisions.push(accept); return { current: 'result', proposal: undefined } } } as unknown as Bridge
    const ext = editorExtension(bridge, () => '/tmp/project') as unknown as { tools: { name: string; execute(a: object, api: object): Promise<{ content: { text: string }[] }> }[] }
    const result = await ext.tools.find(t => t.name === 'decide_version')!.execute({ accept: true }, { conversationId: '1' })
    expect(decisions).toEqual([true])
    expect(JSON.parse(result.content[0].text)).toMatchObject({ current: 'result', proposal: null })
  })
})
