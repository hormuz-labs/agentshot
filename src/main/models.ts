// Which model the agent uses: the user's pick when its key is set, otherwise the best available in a fixed order.
import { getSupportedThinkingLevels, type Provider } from '@earendil-works/pi-ai/models'
import type { Model } from '@earendil-works/pi-ai'
import { REASONING_LEVELS, type ReasoningLevel, type ModelRef } from '../shared/models'
export type { ModelRef } from '../shared/models'
type Available = { provider: string; id: string; name?: string; contextWindow?: number; input?: string[]; cost?: { input: number; output: number }; reasoning?: boolean; thinkingLevelMap?: Model<any>['thinkingLevelMap']; reasoningLevels?: ReasoningLevel[]; api?: string; compat?: Record<string, unknown> }

/** Transport-supported choices; never infer effort support from a model name. */
export function reasoningLevels(m: Available): ReasoningLevel[] {
  if (!m.reasoning) return []
  if (m.reasoningLevels) return m.reasoningLevels.filter(l => REASONING_LEVELS.includes(l))
  if (!m.api) return []
  const levels = getSupportedThinkingLevels(m as Model<any>).filter(l => l !== 'off')
  const seen = new Set<string>()
  return levels.filter(level => {
    // Adaptive Claude maps minimal and low to the same effort.
    const value = m.thinkingLevelMap?.[level] ?? (m.api === 'anthropic-messages' && m.compat?.forceAdaptiveThinking && level === 'minimal' ? 'low' : level)
    if (seen.has(value)) return false
    seen.add(value); return true
  }).map(level => m.api === 'anthropic-messages' && m.compat?.forceAdaptiveThinking && level === 'minimal' ? 'low' : level)
}

/** The simple adapters otherwise treat unset reasoning as "off", not provider default. */
export function defaultReasoningPayload(payload: any, model: { api: string }) {
  const p = { ...payload }
  if (model.api.includes('openai')) {
    delete p.reasoning
    delete p.reasoning_effort
    delete p.thinking
    delete p.enable_thinking
  }
  if (model.api === 'anthropic-messages') {
    if (p.thinking?.type === 'disabled') delete p.thinking
    if (p.output_config?.effort) { p.output_config = { ...p.output_config }; delete p.output_config.effort }
    if (Array.isArray(p.messages)) p.messages = p.messages.filter((m: any) => !(m.role === 'system' && m.output_config?.effort && !m.content?.length))
  }
  if (model.api.startsWith('google') && p.config?.thinkingConfig) {
    p.config = { ...p.config }; delete p.config.thinkingConfig
  }
  return p
}

export function withDefaultReasoning<T extends Provider<any>>(provider: T): T {
  return new Proxy(provider, { get(target, key) {
    if (key === 'streamSimple') return (model: Model<any>, context: any, options: any) => target.streamSimple(model, context,
      options?.reasoning ? options : { ...options, onPayload: async (payload: any, m: Model<any>) => {
        const p = defaultReasoningPayload(payload, m)
        return await options?.onPayload?.(p, m) ?? p
      } })
    const value = Reflect.get(target, key)
    return typeof value === 'function' ? value.bind(target) : value
  } })
}

export function validateModelChoice(all: Available[], pick: ModelRef): ModelRef {
  const m = all.find(m => m.provider === pick.provider && m.id === pick.modelId)
  if (!m) throw new Error('This model is unavailable. Choose another model.')
  if (pick.reasoningLevel !== undefined && !reasoningLevels(m).includes(pick.reasoningLevel)) throw new Error('This reasoning level is unavailable for the selected model. Choose Default or a supported level.')
  return { provider: pick.provider, modelId: pick.modelId, ...(pick.reasoningLevel !== undefined ? { reasoningLevel: pick.reasoningLevel } : {}) }
}

const PREFER: { provider: string; pick: RegExp[] }[] = [
  { provider: 'anthropic', pick: [/^claude-opus-5/, /^claude-sonnet-5/, /^claude-opus/] },
  { provider: 'google', pick: [/^gemini-3\.8-flash$/, /^gemini-3.*flash$/, /^gemini/] },
  { provider: 'openai', pick: [/^gpt-5\.5$/, /^gpt-5/] },
  { provider: 'chatgpt', pick: [/^gpt-6/, /^gpt-5/, /./] },
  { provider: 'claude-code', pick: [/^opus$/, /opus/, /./] },
  { provider: 'manul', pick: [/^manul$/] }, // the AgentShot key (the gateway picks the model), after the user's own keys
]

export function chooseModel(all: Available[], pick?: ModelRef | null): ModelRef | undefined {
  const available = all.filter(m => !NOT_AGENT.test(m.id))
  if (pick && available.some(m => m.provider === pick.provider && m.id === pick.modelId)) return validateModelChoice(available, pick)
  for (const pref of PREFER) {
    const mine = available.filter(m => m.provider === pref.provider)
    for (const re of pref.pick) {
      const m = mine.find(x => re.test(x.id))
      if (m) return { provider: m.provider, modelId: m.id }
    }
  }
  return available[0] ? { provider: available[0].provider, modelId: available[0].id } : undefined
}

const LABEL: Record<string, string> = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI', chatgpt: 'ChatGPT plan', 'claude-code': 'Claude Code · own billing', manul: 'AgentShot' }

// Not chat models an editing agent can use: research agents, computer use, speech, embeddings, image-only, live audio.
const NOT_AGENT = /deep-research|computer-use|tts|embedding|-image\b|image-generation|\blive\b|audio|transcribe|realtime/i

/** labels: provider id → display name, for custom providers (Settings → Keys → Other providers). */
export const describeModels = (available: Available[], labels: Record<string, string> = {}) => available.filter(m => !NOT_AGENT.test(m.id)).map(m => ({
  provider: m.provider, providerLabel: LABEL[m.provider] || labels[m.provider] || m.provider, modelId: m.id, name: m.name || m.id,
  // ChatGPT's account catalog supplies names/slugs, not guaranteed context limits.
  context: m.provider === 'chatgpt' ? undefined : m.contextWindow, price: m.cost && (m.cost.input || m.cost.output) ? { input: m.cost.input, output: m.cost.output } : undefined,
  images: (m.input || []).includes('image'), reasoning: !!m.reasoning, reasoningLevels: reasoningLevels(m),
}))
