// Live checks against the real services (costs a few cents; skipped unless MANUL_LIVE=1). The agent's models are set
// up as the app does (agent.ts), and for each way of paying the app picks a model and runs a two-step tool call with an
// image in the tool result, as an editing turn does:
//   - a Manul key only            → "manul" through gateway.agentshot.si (MANUL_LIVE_KEY_FILE: {"key","id"} of a test key)
//   - the user's own Gemini key   → Google directly, chosen over the Manul key
//   - the user's own Azure        → the custom provider imported from omp (~/.omp/agent/models.yml)
// and voice with the user's own key and with the Manul key. Vendor keys come from gateway/.env; nothing is printed.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { Type } from 'typebox'
import { load as loadYaml } from 'js-yaml'
import { createModels } from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { manulProvider } from '../src/main/gateway'
import { buildProviders } from '../src/main/providers'
import { chooseModel } from '../src/main/models'
import { generate } from '../src/main/generate'
import { setConfig } from '../src/main/config'
import { fromOmp, keyEnv, type CustomProvider } from '../src/shared/providers'

const LIVE = process.env.MANUL_LIVE === '1'
const RED = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII='
const KEYS = ['GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'MANUL_KEY']
const own: Record<string, string> = {}
let manul: { key: string; id: string } | undefined
let azure: CustomProvider | undefined

beforeAll(() => {
  if (!LIVE) return
  for (const line of readFileSync(join(import.meta.dirname, '../gateway/.env'), 'utf8').split('\n')) {
    const m = /^([A-Z_]+)=(.+)$/.exec(line.trim())
    if (m && ['GEMINI_API_KEY', 'ELEVENLABS_API_KEY'].includes(m[1])) own[m[1]] = m[2]
  }
  if (process.env.MANUL_LIVE_KEY_FILE) manul = JSON.parse(readFileSync(process.env.MANUL_LIVE_KEY_FILE, 'utf8'))
  const omp = join(homedir(), '.omp/agent/models.yml')
  const found = existsSync(omp) ? fromOmp(loadYaml(readFileSync(omp, 'utf8')), homedir()).find(f => /azure/.test(f.provider.baseUrl)) : undefined
  if (found) {
    azure = found.provider
    process.env[keyEnv(azure.id)] = found.key || readFileSync(found.keySource.file!, 'utf8').trim()
  }
})
afterEach(() => { for (const k of KEYS) delete process.env[k]; setConfig({ account: undefined }) })

/** The agent's models, as agent.ts sets them up, with these keys. */
function agentModels(env: Record<string, string>, custom: CustomProvider[] = []) {
  for (const k of KEYS) delete process.env[k]
  Object.assign(process.env, env)
  const models = createModels({ authContext: { env: async (n: string) => process.env[n], fileExists: async (p: string) => existsSync(p) } })
  for (const p of [anthropicProvider, googleProvider, openaiProvider, manulProvider]) models.setProvider(p())
  for (const p of buildProviders(custom)) models.setProvider(p as any)
  return models as any
}

/** Ask for the time; the tool answers with the time and a red picture; the model must use both. */
async function toolTurn(models: any, ref: { provider: string; modelId: string }) {
  const model = models.getModel(ref.provider, ref.modelId)
  const tools = [{ name: 'get_time', description: 'The current time, and a photo of the clock', parameters: Type.Object({ zone: Type.String() }) }]
  const messages: any[] = [{ role: 'user', content: 'What time is it in UTC? Use get_time. Then answer with the time and the main colour of the photo it returns, in one short line.', timestamp: Date.now() }]
  const first = await models.completeSimple(model, { messages, tools }, { reasoning: 'low' })
  expect(first.stopReason, JSON.stringify(first.errorMessage ?? '')).toBe('toolUse')
  const call = first.content.find((c: any) => c.type === 'toolCall')
  expect(call.name).toBe('get_time')
  messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: 'get_time', content: [{ type: 'text', text: '12:00' }, { type: 'image', data: RED, mimeType: 'image/png' }], isError: false, timestamp: Date.now() })
  const second = await models.completeSimple(model, { messages, tools }, { reasoning: 'low' })
  expect(second.stopReason, JSON.stringify(second.errorMessage ?? '')).toBe('stop')
  const answer = second.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join(' ')
  expect(answer).toMatch(/12/)
  expect(answer.toLowerCase()).toMatch(/red/)
  return answer
}

describe.skipIf(!LIVE)('live: the agent with each kind of key', () => {
  it('a Manul key only: the app picks "manul", and a tool turn with an image works through gateway.agentshot.si', async () => {
    expect(manul, 'MANUL_LIVE_KEY_FILE').toBeDefined()
    const models = agentModels({ MANUL_KEY: manul!.key })
    const ref = chooseModel(await models.getAvailable())
    expect(ref).toEqual({ provider: 'manul', modelId: 'manul' })
    console.log('manul →', await toolTurn(models, ref!))
  }, 120_000)

  it('the user’s own Gemini key wins over the Manul key and goes to Google directly', async () => {
    expect(own.GEMINI_API_KEY, 'GEMINI_API_KEY in gateway/.env').toBeDefined()
    const models = agentModels({ GEMINI_API_KEY: own.GEMINI_API_KEY, MANUL_KEY: manul?.key || 'sk-bf-unused' })
    const ref = chooseModel(await models.getAvailable())
    expect(ref?.provider).toBe('google')
    console.log(`google ${ref!.modelId} →`, await toolTurn(models, ref!))
  }, 120_000)

  it('the user’s own Azure, imported from omp, works as a custom provider', async () => {
    expect(azure, 'an Azure provider in ~/.omp/agent/models.yml').toBeDefined()
    const models = agentModels({}, [azure!])
    const avail = (await models.getAvailable()).map((m: any) => `${m.provider}/${m.id}`)
    expect(avail).toContain(`${azure!.id}/gpt-6-sol`)
    console.log('azure gpt-6-sol →', await toolTurn(models, { provider: azure!.id, modelId: 'gpt-6-sol' }))
  }, 120_000)
})

describe.skipIf(!LIVE)('live: voice with each kind of key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manul-live-'))
  it('the user’s own ElevenLabs key', async () => {
    Object.assign(process.env, { ELEVENLABS_API_KEY: own.ELEVENLABS_API_KEY })
    const r = await generate('voice', { text: 'Testing my own key.', voice: 'guide' }, dir, 'own-el')
    expect(r).toMatchObject({ rel: 'generated/voice-own-el.mp3', by: expect.stringMatching(/^ElevenLabs .*own key/) })
  }, 60_000)

  it('the user’s own Gemini key', async () => {
    Object.assign(process.env, { GEMINI_API_KEY: own.GEMINI_API_KEY })
    const r = await generate('voice', { text: 'Testing my own key.' }, dir, 'own-gemini')
    expect(r).toMatchObject({ rel: 'generated/voice-own-gemini.wav', by: expect.stringMatching(/^Google Gemini .*own key/) })
  }, 60_000)

  it('a Manul key: Manul makes it and says nothing of who', async () => {
    Object.assign(process.env, { MANUL_KEY: manul!.key })
    setConfig({ account: { email: 'live@test', keyId: manul!.id } })
    const r = await generate('voice', { text: 'Testing the Manul key.', voice: 'anchor' }, dir, 'manul')
    expect(r.by).toMatch(/^Manul \(\$0\.\d\d of the user's Manul credit\)$/)
    expect(r.rel).toMatch(/^generated\/voice-manul\.(mp3|wav)$/)
  }, 60_000)
})
