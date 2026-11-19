import { describe, expect, it } from 'vitest'
import { chooseModel, describeModels, reasoningLevels, validateModelChoice, defaultReasoningPayload, withDefaultReasoning } from '../src/main/models'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'

const m = (provider: string, id: string, extra: Record<string, unknown> = {}) => ({ provider, id, name: id, contextWindow: 200000, input: ['text', 'image'], cost: { input: 1, output: 5 }, reasoning: true, ...extra })
const all = [m('google', 'gemini-3.8-flash'), m('google', 'gemini-2.5-pro'), m('anthropic', 'claude-sonnet-5'), m('anthropic', 'claude-opus-5'), m('openai', 'gpt-5.5'), m('openai', 'gpt-5-mini')]

describe('choosing a model', () => {
  it('prefers Claude Opus, then Gemini Flash, then GPT, by which keys exist', () => {
    expect(chooseModel(all)).toEqual({ provider: 'anthropic', modelId: 'claude-opus-5' })
    expect(chooseModel(all.filter(x => x.provider !== 'anthropic'))).toEqual({ provider: 'google', modelId: 'gemini-3.8-flash' })
    expect(chooseModel(all.filter(x => x.provider === 'openai'))).toEqual({ provider: 'openai', modelId: 'gpt-5.5' })
  })

  it('honours the user\'s pick when its key is there', () => {
    expect(chooseModel(all, { provider: 'openai', modelId: 'gpt-5-mini' })).toEqual({ provider: 'openai', modelId: 'gpt-5-mini' })
  })

  it('falls back when the picked model is no longer available', () => {
    expect(chooseModel(all.filter(x => x.provider === 'google'), { provider: 'anthropic', modelId: 'claude-opus-5' })).toEqual({ provider: 'google', modelId: 'gemini-3.8-flash' })
  })

  it('returns nothing without any key', () => expect(chooseModel([])).toBeUndefined())

  it('describes models for the picker: provider label, context, price, images', () => {
    const d = describeModels([m('google', 'gemini-3.8-flash', { cost: { input: 0.3, output: 2.5 }, contextWindow: 1048576 })])
    expect(d).toEqual([{ provider: 'google', providerLabel: 'Google', modelId: 'gemini-3.8-flash', name: 'gemini-3.8-flash', context: 1048576, price: { input: 0.3, output: 2.5 }, images: true, reasoning: true, reasoningLevels: [] }])
  })
})

describe('reasoning choices', () => {
  it('uses model metadata, excluding unsupported and duplicate levels', () => {
    const gpt = openaiProvider().getModels().find(m => m.id === 'gpt-5.5')!
    expect(reasoningLevels(gpt)).toEqual(['low', 'medium', 'high', 'xhigh'])
    const opus = anthropicProvider().getModels().find(m => m.id === 'claude-opus-5')!
    expect(reasoningLevels(opus)).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    expect(reasoningLevels(m('custom', 'unknown'))).toEqual([])
    expect(reasoningLevels(m('custom', 'plain', { reasoning: false }))).toEqual([])
  })
  it('preserves explicit choices but rejects unsupported or stale levels', () => {
    const models = [m('claude-code', 'opus', { reasoningLevels: ['low', 'high'] })]
    expect(chooseModel(models, { provider: 'claude-code', modelId: 'opus', reasoningLevel: 'high' })).toEqual({ provider: 'claude-code', modelId: 'opus', reasoningLevel: 'high' })
    expect(() => validateModelChoice(models, { provider: 'claude-code', modelId: 'opus', reasoningLevel: 'max' })).toThrow('reasoning level')
    expect(validateModelChoice(models, { provider: 'claude-code', modelId: 'opus' })).not.toHaveProperty('reasoningLevel')
  })
  it('Default omits reasoning overrides rather than disabling reasoning', () => {
    expect(defaultReasoningPayload({ reasoning: { effort: 'none' }, input: [] }, { api: 'openai-responses' })).not.toHaveProperty('reasoning')
    expect(defaultReasoningPayload({ reasoning_effort: 'none', thinking: { type: 'disabled' }, enable_thinking: false, messages: [] }, { api: 'openai-completions' })).toEqual({ messages: [] })
    const claude = defaultReasoningPayload({ thinking: { type: 'adaptive' }, output_config: { effort: 'high', format: 'json' }, messages: [{ role: 'system', content: [], output_config: { effort: 'high' } }] }, { api: 'anthropic-messages' })
    expect(claude.thinking.type).toBe('adaptive'); expect(claude.output_config).toEqual({ format: 'json' }); expect(claude.messages).toEqual([])
    expect(defaultReasoningPayload({ config: { thinkingConfig: { thinkingBudget: 0 }, tools: [] } }, { api: 'google-generative-ai' }).config).toEqual({ tools: [] })
  })
  it('applies Default transforms only to default requests and retains caller transforms', async () => {
    let captured: any
    const provider = withDefaultReasoning({ streamSimple: (_m: any, _c: any, o: any) => { captured = o } } as any)
    provider.streamSimple({ api: 'openai-responses' }, {}, { onPayload: (p: any) => ({ ...p, store: false }) })
    expect(await captured.onPayload({ reasoning: { effort: 'none' } }, { api: 'openai-responses' })).toEqual({ store: false })
    const explicit = { reasoning: 'high' }
    provider.streamSimple({}, {}, explicit); expect(captured).toBe(explicit)
  })
})

describe('picker list', () => {
  it('leaves out models that cannot drive an editing agent', () => {
    const ids = describeModels([m('google', 'deep-research-preview'), m('google', 'gemini-2.5-computer-use-preview'), m('google', 'gemini-2.5-flash-preview-tts'),
      m('google', 'gemini-embedding-001'), m('google', 'gemini-2.5-flash-image'), m('google', 'gemini-live-2.5'), m('google', 'gemini-2.5-flash')]).map(d => d.modelId)
    expect(ids).toEqual(['gemini-2.5-flash'])
  })
})
