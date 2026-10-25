// The AgentShot key: one key and a few model tiers ("AgentShot", and Low to Ultra as in Pitch), through AgentShot's gateway (Bifrost).
// The app never knows which model answers: the gateway's routing rule for each (`manul`, `manul-high`…) picks it
// (Claude, Gemini, GPT…) and can change it any time. Max and Ultra come with a Pro or Max plan: the key's plan decides
// which models the gateway lets it reach (account/src/plans.ts). Requests
// go through Bifrost's OpenAI Responses route, the one whose translation keeps every vendor's tool-call state
// (Gemini's thought signatures, Claude's thinking signatures, GPT's encrypted reasoning): see gateway/README.md.
// The AgentShot key is a Bifrost virtual key, with its own budget and rate limits; the gateway holds the vendor keys.
import { createProvider } from '@earendil-works/pi-ai/models'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { getConfig } from './config'

export const MANUL_KEY = 'MANUL_KEY'
export const MANUL_MODEL = 'manul'
/** The tiers, as models: manul-low … manul-ultra. */
export const MANUL_TIERS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['max', 'Max (Pro plan)'], ['ultra', 'Ultra (Pro plan)']] as const
export const DEFAULT_GATEWAY = 'https://gateway.agentshot.si'

/** MANUL_GATEWAY (a local Bifrost while developing), else the config's, else AgentShot's. */
export const gatewayUrl = () => (process.env.MANUL_GATEWAY || getConfig().gateway || DEFAULT_GATEWAY).replace(/\/+$/, '')

export function agentshotProvider(gateway = gatewayUrl()) {
  const baseUrl = `${gateway}/openai`                    // the SDK adds /responses
  return createProvider({
    id: 'manul',
    name: 'AgentShot',
    baseUrl,
    auth: {
      apiKey: {
        name: 'AgentShot key',
        resolve: async ({ ctx }: any) => { const v = await ctx.env(MANUL_KEY); return v ? { auth: { apiKey: v }, source: MANUL_KEY } : undefined },
      },
    } as any,
    // Limits every model the gateway may route to meets; billing is the AgentShot key's, so no per-token price here.
    models: [[MANUL_MODEL, 'AgentShot'], ...MANUL_TIERS.map(([tier, name]) => [`${MANUL_MODEL}-${tier}`, `AgentShot ${name}`])].map(([id, name]) => ({
      id, name, api: 'openai-responses', provider: 'manul', baseUrl,
      input: ['text', 'image'], reasoning: true,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 400_000, maxTokens: 64_000,
    })) as any,
    api: openAIResponsesApi(),
  })
}
