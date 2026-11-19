import { createProvider } from '@earendil-works/pi-ai/models'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import type { Model, ProviderStreams } from '@earendil-works/pi-ai'
import { CHATGPT_PROVIDER } from '../shared/chatgpt'
import type { ChatGPTAuth, ChatGPTModel } from './chatgpt-auth'
import { defaultReasoningPayload } from './models'
import { REASONING_LEVELS } from '../shared/models'

const UNSUPPORTED = ['background', 'conversation', 'max_output_tokens', 'max_tool_calls', 'metadata', 'moderation', 'multi_agent',
  'prompt', 'prompt_cache_retention', 'prompt_cache_options', 'safety_identifier', 'temperature', 'top_logprobs', 'top_p', 'truncation', 'user', 'previous_response_id']
const USAGE_CODES = new Set(['subscription_sharing_usage_limit_exceeded', 'subscription_sharing_usage_unavailable',
  'subscription_sharing_workplace_individual_usage_limit_exceeded', 'subscription_sharing_user_not_eligible',
  'subscription_sharing_unsupported_capability', 'subscription_sharing_route_not_supported', 'subscription_sharing_invalid_user',
  'chatpass_v2_scope_not_authorized', 'chatpass_v2_invalid_authorization_context'])
const usageError = () => new Error('ChatGPT plan usage is unavailable or its limit was reached. Manage usage: https://chatgpt.com/settings/usage. Choose another model explicitly to use API keys or AgentShot credits.')
/** Applied last to the fully assembled request, including harness defaults. */
export function chatGPTPayload(payload: unknown) {
  const p = { ...payload as Record<string, any> }
  for (const field of UNSUPPORTED) delete p[field]
  p.store = false; p.stream = true
  if (!Array.isArray(p.input)) throw new Error('ChatGPT requests require complete local conversation history.')
  p.input = p.input.map((item: Record<string, any>) => item.role === 'system' ? { ...item, role: 'developer' } : item)
  if (p.tools?.length) {
    if (p.tools.some((t: Record<string, any>) => !['function', 'custom', 'namespace'].includes(t.type))) throw new Error('This tool is not supported by ChatGPT plan usage.')
    // The preview accepts tools via additional_tools rather than ungrouped top-level tools.
    p.input.unshift({ type: 'additional_tools', role: 'developer', tools: p.tools })
    delete p.tools
  }
  return p
}
export function chatGPTProvider(auth: ChatGPTAuth, catalog: ChatGPTModel[]) {
  const account = auth.status().active
  const models: Model<'openai-responses'>[] = catalog.map(m => ({
    id: m.slug, name: m.display_name, api: 'openai-responses', provider: CHATGPT_PROVIDER, baseUrl: 'https://api.openai.com/v1',
    input: m.input_modalities?.includes('image') ? ['text', 'image'] : ['text'],
    reasoning: !!m.supported_reasoning_levels?.length,
    thinkingLevelMap: Object.fromEntries(REASONING_LEVELS.map(level => [level,
      level !== 'off' && m.supported_reasoning_levels?.some(l => l.effort === level) ? level : null])),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: Number.isInteger(m.context_window) && m.context_window! > 1 ? m.context_window! : 128_000, maxTokens: 32_000,
    compat: { supportsAdditionalTools: true, supportsToolSearch: false, supportsDeveloperRole: true, supportsMaxOutputTokens: false },
  }))
  const api = openAIResponsesApi()
  const options = (o: any) => ({ ...o, maxRetries: 0, onPayload: (payload: any, model: Model<any>) => chatGPTPayload(o?.reasoning || o?.reasoningEffort ? payload : defaultReasoningPayload(payload, model)),
    onProviderStreamEvent: (event: any) => {
      if (event.type === 'response.incomplete') throw new Error('ChatGPT returned an incomplete response. Please retry; no unfinished tool calls were applied.')
      if (USAGE_CODES.has(event.response?.error?.code) || (event.type === 'error' && USAGE_CODES.has(event.code))) throw usageError()
    },
    // Pin bearer traffic to the documented endpoint, with no redirect credential forwarding.
    fetch: async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url !== 'https://api.openai.com/v1/responses') throw new Error('Unexpected ChatGPT inference endpoint.')
      if (auth.status().active !== account) throw new Error('ChatGPT account changed. Please retry your request.')
      if (!account) throw new Error('No ChatGPT account selected.')
      const signal = auth.requestSignal(account)
      const response = await fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal, redirect: 'error' })
      if (!response.ok) {
        const error = await response.clone().json().catch(() => ({})) as { error?: { code?: string } }
        if (USAGE_CODES.has(error.error?.code || '')) throw usageError()
      }
      return response
    },
  })
  const streams: ProviderStreams = {
    stream: (m, c, o) => api.stream(m, c, options(o)),
    streamSimple: (m, c, o) => api.streamSimple(m, c, options(o)),
  }
  return createProvider({ id: CHATGPT_PROVIDER, name: 'ChatGPT plan', baseUrl: 'https://api.openai.com/v1', models, api: streams,
    auth: { apiKey: { name: 'ChatGPT plan',
      check: async () => auth.status().active === account && auth.status().accounts.some(a => a.id === account && a.connected) ? { configured: true, type: 'api_key' } : undefined,
      resolve: async () => auth.status().active === account && account ? { auth: { apiKey: await auth.accessToken(account) }, source: 'ChatGPT plan' } : undefined,
    } },
  })
}
