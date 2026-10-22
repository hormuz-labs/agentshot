// Custom model providers (Settings → Keys → Other providers): stored in <userData>/providers.json, keys in the keychain
// (keys.ts, under keyEnv(id)), turned into pi-ai providers for the agent's model list.
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { load as loadYaml } from 'js-yaml'
import { createProvider } from '@earendil-works/pi-ai/models'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { fromOmp, keyEnv, normalizeProvider, type CustomProvider, type CustomProviderInfo } from '../shared/providers'
import { setKey } from './keys'

const file = () => join(app.getPath('userData'), 'providers.json')
export const OMP_MODELS = join(homedir(), '.omp/agent/models.yml')

export function listProviders(): CustomProvider[] {
  try { return (JSON.parse(readFileSync(file(), 'utf8')) as CustomProvider[]).filter(p => p && p.id) } catch { return [] }
}
const write = (list: CustomProvider[]) => writeFileSync(file(), JSON.stringify(list, null, 1))

export const providerInfo = (): CustomProviderInfo[] => listProviders().map(p => ({ ...p, keySet: !!process.env[keyEnv(p.id)] }))

/** Add a provider, or replace one (by id; its id stays, so projects that picked its models keep them). An empty key keeps the stored one; null removes it. */
export function saveProvider(input: Partial<CustomProvider>, key?: string | null, replacing?: string) {
  const list = listProviders().filter(p => p.id !== replacing)
  const p = normalizeProvider({ ...input, id: replacing || input.id }, list.map(x => x.id))
  write([...list, p])
  if (key) setKey(keyEnv(p.id), key.trim())
  else if (key === null) setKey(keyEnv(p.id), '')
  return p
}

export function removeProvider(id: string) {
  write(listProviders().filter(p => p.id !== id))
  setKey(keyEnv(id), '')
}

export const ompAvailable = () => existsSync(OMP_MODELS)

/** Copy omp's custom providers (and their keys, when omp reads them from a file) into Manul. */
export function importOmp(path = OMP_MODELS) {
  const found = fromOmp(loadYaml(readFileSync(path, 'utf8')), homedir())
  const added: { id: string; name: string; models: number; key: boolean }[] = []
  for (const f of found) {
    let key = f.key
    if (!key && f.keySource.file) { try { key = readFileSync(f.keySource.file, 'utf8').trim() } catch { /* left for the user to paste */ } }
    const p = saveProvider(f.provider, key, listProviders().some(x => x.id === f.provider.id) ? f.provider.id : undefined)
    added.push({ id: p.id, name: p.name, models: p.models.length, key: !!process.env[keyEnv(p.id)] })
  }
  return added
}

const API = {
  'openai-responses': openAIResponsesApi,
  'openai-completions': openAICompletionsApi,
  'anthropic-messages': anthropicMessagesApi,
} as const

/** pi-ai providers for every custom provider. Built afresh whenever the list or a key changes (the key header is static). */
export function buildProviders(list = listProviders()) {
  return list.map(p => {
    const env = keyEnv(p.id)
    const key = process.env[env]
    const headers = p.keyHeader && key ? { [p.keyHeader]: key } : undefined   // pi-ai sends model headers on each request
    return createProvider({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      auth: {
        apiKey: {
          name: `${p.name} API key`,
          resolve: async ({ ctx }: any) => { const v = await ctx.env(env); return v ? { auth: { apiKey: v }, source: env } : undefined },
        },
      } as any,
      models: p.models.map(m => ({
        id: m.id, name: m.name || m.id, api: p.api, provider: p.id, baseUrl: p.baseUrl, ...(headers ? { headers } : {}),
        input: m.images === false ? ['text'] : ['text', 'image'], reasoning: m.reasoning !== false,
        // Sol cannot disable reasoning; the harness's default "off" would otherwise send the unsupported "none".
        ...(/^gpt-6\.1-sol(?:-\d{4}-\d{2}-\d{2})?$/.test(m.id) ? { thinkingLevelMap: { off: 'high' } } : {}),
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: m.contextWindow || 400_000, maxTokens: m.maxTokens || 128_000,
      })) as any,
      api: API[p.api](),
    })
  })
}
