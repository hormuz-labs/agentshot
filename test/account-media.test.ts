import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { handle, MEDIA, price, type Env, type MediaConfig } from '../account/src/index'
import { memoryCreditStore, type CreditStore } from '../account/src/credit'

// Voice and music for Manul keys: the account service picks the vendor from media.json, makes it with Manul's key,
// takes the price off the caller's credit, and never says who made it. Fake Bifrost and fake vendors.
const env: Env = { CLERK_ISSUER: 'https://clerk.test', CLERK_SECRET_KEY: 'sk', BIFROST_URL: 'https://gw.test', BIFROST_AUTH: 'Basic x', GEMINI_API_KEY: 'g-server', ELEVENLABS_API_KEY: 'el-server' }
let vk: any
let vendor: string[]
let vendorAnswer: () => Response
let credits: CreditStore
const reply = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 9]), { headers: { 'content-type': 'audio/mpeg' } })

beforeEach(() => {
  vk = { id: 'vk_1', name: 'user_1', value: 'sk-bf-1', is_active: true, budgets: [{ id: 'b0', max_limit: 2, current_usage: 0.5, reset_duration: '100Y' }] }
  vendor = []
  vendorAnswer = mp3
  credits = memoryCreditStore()
  vi.stubGlobal('fetch', async (input: string, init: RequestInit = {}) => {
    const url = String(input), method = init.method || 'GET'
    if (url === 'https://gw.test/api/governance/virtual-keys/vk_1') {
      if (method === 'PUT') { for (const b of JSON.parse(String(init.body)).budgets) Object.assign(vk.budgets.find((x: any) => x.id === b.id), b); return reply({ virtual_key: vk }) }
      return reply({ virtual_key: vk })
    }
    vendor.push(`${url} ${new Headers(init.headers).get('xi-api-key') || new Headers(init.headers).get('x-goog-api-key')}`)
    return vendorAnswer()
  })
})
afterEach(() => vi.unstubAllGlobals())

const as = { authorization: 'Bearer sk-bf-1', 'x-manul-key-id': 'vk_1', 'content-type': 'application/json' }
const post = (path: string, body: object, e: Env = env) => handle(new Request(`https://account.test${path}`, { method: 'POST', headers: as, body: JSON.stringify(body) }), e, credits)
const withConfig = (c: MediaConfig): Env => {
  const f = join(mkdtempSync(join(tmpdir(), 'manul-media-')), 'media.json')
  writeFileSync(f, JSON.stringify(c))
  return { ...env, MEDIA_CONFIG: f }
}

describe('voice and music with a Manul key', () => {
  it('prices by characters, minutes or request', () => {
    expect(price({ per_1k_chars: 0.1 }, { text: 'x'.repeat(2500) })).toBe(0.25)
    expect(price({ per_minute: 0.3 }, { seconds: 90 })).toBe(0.45)
    expect(price({ per_request: 0.08 }, { seconds: 200 })).toBe(0.08)
    expect(price(undefined, {})).toBeUndefined()
  })

  it('makes music with the configured vendor and Manul’s key, charges the credit, and doesn’t say who made it', async () => {
    vendorAnswer = () => reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/mpeg', data: Buffer.from([0xff, 0xfb, 9]).toString('base64') } }] } }] })
    const r = await post('/v1/music', { prompt: 'Lo-fi bed', seconds: 30 })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('audio/mpeg')
    expect(r.headers.get('x-manul-cost')).toBe('0.0800')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([0xff, 0xfb, 9])
    expect(vendor).toEqual(['https://generativelanguage.googleapis.com/v1beta/models/lyria-3.5:generateContent g-server'])
    expect([...r.headers.keys()].join(' ')).not.toMatch(/gemini|lyria|google/i)
    expect(vk.budgets[0]).toMatchObject({ max_limit: 1.92, current_usage: 0.5 })
  })

  it('switching vendor is a change to media.json: ElevenLabs, priced per minute', async () => {
    const e = withConfig({ ...MEDIA, music: { provider: 'elevenlabs', model: 'music_v2_5' }, prices: { music_v2_5: { per_minute: 0.3 } } })
    const r = await post('/v1/music', { prompt: 'Lo-fi bed', seconds: 60 }, e)
    expect(r.status).toBe(200)
    expect(vendor).toEqual(['https://api.elevenlabs.io/v1/music el-server'])
    expect(vk.budgets[0].max_limit).toBe(1.7)
  })

  it('voice: the Manul voice name becomes the vendor’s voice', async () => {
    vendorAnswer = () => reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;rate=24000', data: 'AAAA' } }] } }] })
    const r = await post('/v1/voice', { text: 'Hello.', voice: 'anchor' })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('audio/wav')
    expect(vk.budgets[0].max_limit).toBeCloseTo(2 - 0.0001)
  })

  it('out of credit: nothing is made', async () => {
    vk.budgets[0].current_usage = 1.95
    const r = await post('/v1/music', { prompt: 'x', seconds: 30 })
    expect(r.status).toBe(402)
    expect((await r.json()).error).toMatch(/out of Manul credit.*\$0\.08.*\$0\.05 is left/)
    expect(vendor).toEqual([])
  })

  it('a refused prompt says why without naming the vendor; a vendor outage says nothing about it', async () => {
    vendorAnswer = () => reply({ error: { message: 'models/lyria-3.5 blocked: the prompt names an artist (Gemini policy)' } }, 400)
    const r = await post('/v1/music', { prompt: 'like Hans Zimmer', seconds: 30 })
    expect(r.status).toBe(422)
    const msg = (await r.json()).error
    expect(msg).toMatch(/names an artist/)
    expect(msg).not.toMatch(/lyria|gemini/i)
    vendorAnswer = () => reply({}, 503)
    const down = await post('/v1/music', { prompt: 'x', seconds: 30 })
    expect(down.status).toBe(502)
    expect(vk.budgets[0].max_limit).toBe(2)
  })

  it('a vendor with no key or a model with no price isn’t offered', async () => {
    const noKey = await post('/v1/music', { prompt: 'x', seconds: 30 }, { ...env, GEMINI_API_KEY: undefined })
    expect(noKey.status).toBe(503)
    const noPrice = await post('/v1/voice', { text: 'x' }, withConfig({ ...MEDIA, prices: {} }))
    expect(noPrice.status).toBe(503)
    expect(vendor).toEqual([])
  })

  it('only for the key’s owner, and bad requests are turned away', async () => {
    const r = await handle(new Request('https://account.test/v1/voice', { method: 'POST', headers: { ...as, authorization: 'Bearer stolen' }, body: '{"text":"x"}' }), env, credits)
    expect(r.status).toBe(401)
    expect((await post('/v1/voice', { text: '' })).status).toBe(400)
    expect((await post('/v1/music', { prompt: 'x', seconds: 30, sections: [{ name: 'A', seconds: 10 }] })).status).toBe(400)
    expect(vendor).toEqual([])
  })

  it('lists the voices, without vendor ids', async () => {
    const r = await handle(new Request('https://account.test/v1/voices', { headers: as }), env)
    const { voices } = await r.json()
    expect(voices[0]).toEqual({ name: 'narrator', about: expect.any(String) })
    expect(JSON.stringify(voices)).not.toMatch(/Sulafat|EXAVITQu4vr4xnSDxMaL/)
  })

  it('serializes media reservations so two calls cannot spend the same balance', async () => {
    vk.budgets[0].current_usage = 1.9
    vendorAnswer = () => reply({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/mpeg', data: 'AAAA' } }] } }] })
    const results = await Promise.all([post('/v1/music', { prompt: 'x', seconds: 30 }), post('/v1/music', { prompt: 'x', seconds: 30 })])
    expect(results.map(r => r.status)).toEqual([200, 402])
    expect(vendor).toHaveLength(1)
    expect(vk.budgets[0].max_limit).toBe(1.92)
  })

  it('never calls the vendor with a disabled key', async () => {
    vk.is_active = false
    expect((await post('/v1/voice', { text: 'Hello.' })).status).toBe(403)
    expect((await post('/v1/music', { prompt: 'x', seconds: 30 })).status).toBe(403)
    expect(vendor).toEqual([])
    expect(vk.budgets[0].max_limit).toBe(2)
  })
})
