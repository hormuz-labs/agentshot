import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setConfig } from '../src/main/config'
import { generate, routeFor } from '../src/main/generate'

// generate_voice / generate_music in the app: the person's own key first, else their Manul key through the account
// service (a fake one here), never a vendor of Manul's choosing named to them.
const KEYS = ['ELEVENLABS_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'MANUL_KEY']
const seen: { url?: string; auth?: string; keyId?: string; body?: any } = {}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    Object.assign(seen, { url: req.url, auth: req.headers.authorization, keyId: req.headers['x-manul-key-id'], body: JSON.parse(body || '{}') })
    if (req.url === '/v1/music') return res.writeHead(200, { 'content-type': 'audio/mpeg', 'x-manul-cost': '0.0800' }).end(Buffer.from([0xff, 0xfb, 7]))
    if (req.url === '/v1/voice') return res.writeHead(402, { 'content-type': 'application/json' }).end(JSON.stringify({ error: "You're out of Manul credit." }))
    res.writeHead(404).end()
  })
})
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  process.env.MANUL_ACCOUNT = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})
afterAll(() => { server.close(); delete process.env.MANUL_ACCOUNT })
afterEach(() => { for (const k of KEYS) delete process.env[k]; setConfig({ account: undefined }) })

describe('who makes voice and music', () => {
  it('the person’s own key first (ElevenLabs, Gemini, OpenAI), or the one asked for', () => {
    const env = { GEMINI_API_KEY: 'g', OPENAI_API_KEY: 'o', MANUL_KEY: 'm' }
    expect(routeFor('voice', undefined, env)).toEqual({ via: 'own', provider: 'gemini' })
    expect(routeFor('voice', 'openai', env)).toEqual({ via: 'own', provider: 'openai' })
    expect(routeFor('music', 'openai', { OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' })).toEqual({ via: 'own', provider: 'gemini' })
    expect(routeFor('music', undefined, { ELEVENLABS_API_KEY: 'e', GEMINI_API_KEY: 'g' })).toEqual({ via: 'own', provider: 'elevenlabs' })
  })

  it('otherwise the Manul key, once signed in; with nothing, says what unlocks it', () => {
    expect(() => routeFor('music', undefined, { MANUL_KEY: 'm' })).toThrow(/Sign in to Manul/)
    setConfig({ account: { email: 'a@b.c', keyId: 'vk_1' } })
    expect(routeFor('music', undefined, { MANUL_KEY: 'm' })).toEqual({ via: 'manul' })
    expect(() => routeFor('music', undefined, {})).toThrow(/No key for music.*ElevenLabs, Google Gemini/)
  })

  it('with a Manul key: asks Manul, saves the take without overwriting the last, says Manul made it', async () => {
    process.env.MANUL_KEY = 'sk-bf-1'
    setConfig({ account: { email: 'a@b.c', keyId: 'vk_1' } })
    const dir = mkdtempSync(join(tmpdir(), 'manul-gen-'))
    const req = { prompt: 'Lo-fi', seconds: 30 }
    const one = await generate('music', req, dir, 'Opening Bed!')
    expect(seen).toMatchObject({ url: '/v1/music', auth: 'Bearer sk-bf-1', keyId: 'vk_1', body: req })
    expect(one).toEqual({ rel: 'generated/music-opening-bed.mp3', by: "Manul ($0.08 of the user's Manul credit)" })
    expect([...readFileSync(join(dir, one.rel))]).toEqual([0xff, 0xfb, 7])
    const two = await generate('music', req, dir, 'Opening Bed!')
    expect(two.rel).toBe('generated/music-opening-bed-2.mp3')
    await expect(generate('voice', { text: 'Hi' }, dir, 'x')).rejects.toThrow(/out of Manul credit/)
    expect(existsSync(join(dir, 'generated/voice-x.mp3'))).toBe(false)
  })
})
