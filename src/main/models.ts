// Which model the agent uses: the user's pick when its key is set, otherwise the best available in a fixed order.
export type ModelRef = { provider: string; modelId: string }
type Available = { provider: string; id: string; name?: string; contextWindow?: number; input?: string[]; cost?: { input: number; output: number }; reasoning?: boolean }

const PREFER: { provider: string; pick: RegExp[] }[] = [
  { provider: 'anthropic', pick: [/^claude-opus-5/, /^claude-sonnet-5/, /^claude-opus/] },
  { provider: 'google', pick: [/^gemini-3\.8-flash$/, /^gemini-3.*flash$/, /^gemini/] },
  { provider: 'openai', pick: [/^gpt-5\.5$/, /^gpt-5/] },
  { provider: 'manul', pick: [/^manul$/] }, // the Manul key (the gateway picks the model), after the user's own keys
]

export function chooseModel(all: Available[], pick?: ModelRef | null): ModelRef | undefined {
  const available = all.filter(m => !NOT_AGENT.test(m.id))
  if (pick && available.some(m => m.provider === pick.provider && m.id === pick.modelId)) return pick
  for (const pref of PREFER) {
    const mine = available.filter(m => m.provider === pref.provider)
    for (const re of pref.pick) {
      const m = mine.find(x => re.test(x.id))
      if (m) return { provider: m.provider, modelId: m.id }
    }
  }
  return available[0] ? { provider: available[0].provider, modelId: available[0].id } : undefined
}

const LABEL: Record<string, string> = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI', manul: 'Manul' }

// Not chat models an editing agent can use: research agents, computer use, speech, embeddings, image-only, live audio.
const NOT_AGENT = /deep-research|computer-use|tts|embedding|-image\b|image-generation|\blive\b|audio|transcribe|realtime/i

/** labels: provider id → display name, for custom providers (Settings → Keys → Other providers). */
export const describeModels = (available: Available[], labels: Record<string, string> = {}) => available.filter(m => !NOT_AGENT.test(m.id)).map(m => ({
  provider: m.provider, providerLabel: LABEL[m.provider] || labels[m.provider] || m.provider, modelId: m.id, name: m.name || m.id,
  context: m.contextWindow, price: m.cost && (m.cost.input || m.cost.output) ? { input: m.cost.input, output: m.cost.output } : undefined,
  images: (m.input || []).includes('image'), reasoning: !!m.reasoning,
}))
