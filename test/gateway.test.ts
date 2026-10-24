import { createServer } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { createModels } from '@earendil-works/pi-ai/models'
import { manulProvider } from '../src/main/gateway'
import { chooseModel, describeModels } from '../src/main/models'

// A stand-in for the gateway: records where each request went, with which credential and model, then refuses it.
const seen: { url: string; auth?: string; model?: string }[] = []
const server = createServer((req, res) => {
  let b = ''
  req.on('data', c => (b += c))
  req.on('end', () => { seen.push({ url: req.url!, auth: req.headers.authorization, model: JSON.parse(b || '{}').model }); res.writeHead(401, { 'content-type': 'application/json' }).end('{"error":{"message":"stand-in"}}') })
})
afterAll(() => server.close())

const env = (vars: Record<string, string>) => createModels({ authContext: { env: async (n: string) => vars[n], fileExists: async () => false } })

describe('the Manul key', () => {
  it('offers "Manul" and its tiers, Low to Ultra, only when the key is set: no vendor, no price', async () => {
    const models = env({})
    models.setProvider(manulProvider('https://gw.test') as any)
    expect(await models.getAvailable()).toEqual([])
    const keyed = env({ MANUL_KEY: 'vk-1' })
    keyed.setProvider(manulProvider('https://gw.test') as any)
    const avail = (await keyed.getAvailable()) as any[]
    const described = describeModels(avail)
    expect(described[0]).toEqual(expect.objectContaining({ provider: 'manul', providerLabel: 'AgentShot', modelId: 'manul', name: 'AgentShot', price: undefined, images: true }))
    expect(described.map(m => m.modelId)).toEqual(['manul', 'manul-low', 'manul-medium', 'manul-high', 'manul-max', 'manul-ultra'])
    expect(chooseModel(avail)).toEqual({ provider: 'manul', modelId: 'manul' })
  })

  it("prefers the user's own keys", () => {
    const m = (provider: string, id: string) => ({ provider, id })
    expect(chooseModel([m('manul', 'manul'), m('google', 'gemini-3.8-flash')])).toEqual({ provider: 'google', modelId: 'gemini-3.8-flash' })
  })

  it("asks the gateway's OpenAI Responses route for model \"manul\" with the Manul key", async () => {
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const models = env({ MANUL_KEY: 'vk-secret' })
    models.setProvider(manulProvider(`http://127.0.0.1:${(server.address() as { port: number }).port}`) as any)
    const msg = await (models as any).completeSimple(models.getModel('manul', 'manul')!, { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] })
    expect(msg.stopReason).toBe('error')                                                      // the stand-in refuses
    expect(seen).toEqual([{ url: '/openai/responses', auth: 'Bearer vk-secret', model: 'manul' }])
  })
})
