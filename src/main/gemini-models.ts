import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import type { Model } from '@earendil-works/pi-ai'
import { REASONING_LEVELS } from '../shared/models'

// Published GenerateContent thinking controls: https://ai.google.dev/gemini-api/docs/thinking
const GEMINI_4_LEVELS: Record<string, string[]> = {
  'gemini-4-carbon': ['low', 'medium', 'high'], 'gemini-4-argon': ['low', 'medium', 'high'],
  'gemini-4-neon': ['low', 'medium', 'high', 'xhigh'], 'gemini-4-hydrogen': ['low', 'medium', 'high', 'xhigh'],
}
type GoogleModel = { name: string; displayName?: string; inputTokenLimit?: number; outputTokenLimit?: number; supportedGenerationMethods?: string[]; thinking?: boolean }

/** Authenticated, paginated discovery. Credentials remain in the main process and never in URLs. */
export class GeminiModels {
  private key?: string
  private at = 0
  private catalog?: Model<'google-generative-ai'>[]
  private pending?: Promise<void>
  warning?: string
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  invalidate() { this.at = 0 }
  async refresh(): Promise<void> {
    const key = process.env.GEMINI_API_KEY
    if (key !== this.key) { this.key = key; this.catalog = undefined; this.at = 0; this.warning = undefined }
    if (!key || Date.now() - this.at < 300_000) return
    if (this.pending) { await this.pending; return this.refresh() }
    this.pending = this.load(key)
    try { await this.pending } finally { this.pending = undefined }
  }
  private async load(key: string) {
    try {
      const rows: GoogleModel[] = [], pages = new Set<string>()
      let page = ''
      do {
        if (pages.has(page) || pages.size >= 50) throw new Error('Invalid model pagination')
        pages.add(page)
        const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
        url.searchParams.set('pageSize', '1000')
        if (page) url.searchParams.set('pageToken', page)
        const r = await this.request(url, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(15_000), redirect: 'error' })
        if (!r.ok) throw new Error('Model discovery failed')
        const body = await r.json() as { models?: GoogleModel[]; nextPageToken?: string }
        if (!Array.isArray(body.models)) throw new Error('Invalid catalog')
        rows.push(...body.models); page = body.nextPageToken || ''
      } while (page)
      const bundled = googleProvider().getModels()
      const models = rows.filter(m => m.name?.startsWith('models/') && m.supportedGenerationMethods?.includes('generateContent')).map(row => {
        const id = row.name.slice('models/'.length), known = bundled.find(m => m.id === id)
        const levels = GEMINI_4_LEVELS[id]
        return { ...known, id, name: row.displayName || id, provider: 'google', api: 'google-generative-ai',
          baseUrl: 'https://generativelanguage.googleapis.com/v1beta', input: known?.input || ['text', 'image'],
          reasoning: row.thinking ?? known?.reasoning ?? !!levels,
          // Unknown thinking models retain Default only, until their controls are verified.
          ...(!known || levels ? { thinkingLevelMap: Object.fromEntries(REASONING_LEVELS.map(l => [l, levels?.includes(l) ? l : null])) } : {}),
          cost: known?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: row.inputTokenLimit || known?.contextWindow || 128_000,
          maxTokens: row.outputTokenLimit || known?.maxTokens || 32_000,
        } as Model<'google-generative-ai'>
      })
      if (this.key !== key || process.env.GEMINI_API_KEY !== key) return
      this.catalog = [...new Map(models.map(m => [m.id, m])).values()]; this.warning = undefined; this.at = Date.now()
    } catch {
      if (this.key !== key || process.env.GEMINI_API_KEY !== key) return
      this.warning = 'Could not refresh Gemini models from Google. Showing the last available catalog; check your key and connection.'
      this.at = Date.now() - 240_000 // retry after one minute, not on every render
    }
  }
  provider() {
    const provider = googleProvider(), models = this.catalog
    return new Proxy(provider, { get(target, prop) {
      if (prop === 'getModels') return () => models || target.getModels()
      if (prop === 'getAllModels') return () => models || target.getAllModels?.() || target.getModels()
      if (prop === 'streamSimple') return (model: Model<any>, context: any, options: any) => target.streamSimple(model, context, {
        // The bundled adapter predates Gemini 4 and rejects xhigh before onPayload.
        ...options, ...(GEMINI_4_LEVELS[model.id] ? { reasoning: undefined } : {}), onPayload: async (payload: any, m: Model<any>) => {
          let p = payload
          if (GEMINI_4_LEVELS[m.id] && options?.reasoning) {
            if (!GEMINI_4_LEVELS[m.id].includes(options.reasoning)) throw new Error('Unsupported Gemini reasoning level')
            p = { ...p, config: { ...p.config, thinkingConfig: { includeThoughts: true, thinkingLevel: options.reasoning.toUpperCase() } } }
          }
          return await options?.onPayload?.(p, m) ?? p
        },
      })
      const value = Reflect.get(target, prop)
      return typeof value === 'function' ? value.bind(target) : value
    } })
  }
}
