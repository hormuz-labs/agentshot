import { describe, expect, it } from 'vitest'
import { toolErrorHint } from '../src/shared/tool-errors'
import { editorExtension, type Bridge } from '../src/main/agent'

describe('actionable tool failures', () => {
  it('says what went wrong in words anyone can follow', () => {
    expect(toolErrorHint('bash', 'ls: ..: Operation not permitted')).toBe('That was outside the project’s folder, so it was blocked.')
    expect(toolErrorHint('edit_timeline', 'Accept or reject the proposed version first, then edit.')).toContain('Keep it or send it back')
    expect(toolErrorHint('bash', "Unrecognized option 'vsync'.")).toContain('try another way')
    expect(toolErrorHint('read', "ENOENT: no such file or directory, open 'notes/brief.txt'")).toBe('That file isn’t in the project.')
    expect(toolErrorHint('probe', 'moov atom not found')).toContain('damaged or unfinished')
    expect(toolErrorHint('look', 'something odd')).toBe('This step didn’t work; the agent carries on without it.')
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
