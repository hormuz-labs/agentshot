import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkMusic, compose, MediaError, musicPrompt, speak, VOICES, wav } from '../account/src/media'

// The vendor calls behind generate_voice / generate_music, against a fake fetch: what each vendor is sent, and what
// comes back as audio.
let calls: { url: string; headers: Headers; body: any }[]
let answer: (url: string, body: any) => Response
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } })
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url: String(url), headers: new Headers(init.headers), body })
    return answer(String(url), body)
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('voice', () => {
  it('Gemini: the voice by name, the delivery in words, its PCM wrapped as WAV', async () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0])
    answer = () => json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.from(pcm).toString('base64') } }] } }] })
    const a = await speak({ provider: 'gemini', model: 'gemini-3.8-flash-tts' }, 'g-key', { text: 'Hello there.', voice: 'guide', style: 'calmly' })
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent')
    expect(calls[0].headers.get('x-goog-api-key')).toBe('g-key')
    expect(calls[0].body.contents[0].parts[0].text).toBe('Say this calmly:\nHello there.')
    expect(calls[0].body.generationConfig).toEqual({ responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICES.guide.gemini } } } })
    expect(a.ext).toBe('wav')
    const v = new DataView(a.data.buffer)
    expect(String.fromCharCode(...a.data.slice(0, 4))).toBe('RIFF')
    expect(v.getUint32(24, true)).toBe(24000)
    expect(v.getUint32(40, true)).toBe(pcm.length)
    expect([...a.data.slice(44)]).toEqual([...pcm])
  })

  it('ElevenLabs: the voice id in the path, v3 delivery as an audio tag, MP3', async () => {
    answer = mp3
    const a = await speak({ provider: 'elevenlabs', model: 'eleven_v3' }, 'el-key', { text: 'Big news.', voice: 'anchor', style: 'excited' })
    expect(calls[0].url).toBe(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES.anchor.elevenlabs}?output_format=mp3_44100_128`)
    expect(calls[0].headers.get('xi-api-key')).toBe('el-key')
    expect(calls[0].body).toEqual({ text: '[excited] Big news.', model_id: 'eleven_v3' })
    expect(a).toMatchObject({ ext: 'mp3', type: 'audio/mpeg' })
  })

  it('OpenAI: voice name and instructions', async () => {
    answer = mp3
    await speak({ provider: 'openai', model: 'gpt-4o-mini-tts' }, 'o-key', { text: 'Hi.', style: 'warmly' })
    expect(calls[0].body).toEqual({ model: 'gpt-4o-mini-tts', voice: VOICES.narrator.openai, input: 'Hi.', response_format: 'mp3', instructions: 'Speak warmly.' })
  })

  it('refuses an unknown voice before calling anyone, and turns a vendor refusal into a short reason', async () => {
    await expect(speak({ provider: 'gemini', model: 'm' }, 'k', { text: 'x', voice: 'Morgan Freeman' })).rejects.toThrow(/Unknown voice/)
    expect(calls).toHaveLength(0)
    answer = () => json({ error: { message: 'API key not valid' } }, 400)
    await expect(speak({ provider: 'gemini', model: 'm' }, 'k', { text: 'x' })).rejects.toMatchObject({ status: 422, message: 'refused (400): API key not valid' })
    answer = () => json({}, 401)
    await expect(speak({ provider: 'elevenlabs', model: 'm' }, 'k', { text: 'x' })).rejects.toBeInstanceOf(MediaError)
  })
})

describe('music', () => {
  const scored = { prompt: 'Lo-fi, Rhodes, 92 BPM', seconds: 30, sections: [{ name: 'Intro', seconds: 10, description: 'Rhodes alone' }, { name: 'Groove', seconds: 20 }] }

  it('checks the sections add up', () => {
    expect(() => checkMusic({ ...scored, seconds: 40 })).toThrow(/add up to 30 s, not 40 s/)
    expect(() => checkMusic({ prompt: 'x', seconds: 1 })).toThrow(/3 to 600/)
  })

  it('writes sections as timestamps, instrumental by default', () => {
    expect(musicPrompt(scored)).toBe('A 30-second instrumental track. Lo-fi, Rhodes, 92 BPM\n[0:00 - 0:10] Intro: Rhodes alone\n[0:10 - 0:30] Groove\nInstrumental only, no vocals.')
  })

  it('Lyria: the prompt, and the MP3 out of the answer', async () => {
    answer = () => json({ candidates: [{ content: { parts: [{ text: '[Intro]…' }, { inlineData: { mimeType: 'audio/mpeg', data: Buffer.from([0xff, 0xfb]).toString('base64') } }] } }] })
    const a = await compose({ provider: 'gemini', model: 'lyria-3.5' }, 'g', scored)
    expect(calls[0].url).toContain('/models/lyria-3.5:generateContent')
    expect(calls[0].body.contents[0].parts[0].text).toBe(musicPrompt(scored))
    expect(a).toMatchObject({ ext: 'mp3', data: new Uint8Array([0xff, 0xfb]) })
  })

  it('ElevenLabs, scored: a plan, its sections set to the asked lengths and kept instrumental, then composed from it', async () => {
    answer = url => url.endsWith('/music/plan')
      ? json({ chunks: [{ text: '[Intro]', duration_ms: 12000, positive_styles: ['lo-fi'], negative_styles: [] }, { text: '[Groove]', duration_ms: 18000, positive_styles: [], negative_styles: ['vocals'] }] })
      : mp3()
    await compose({ provider: 'elevenlabs', model: 'music_v2_5' }, 'el', scored)
    expect(calls.map(c => c.url)).toEqual(['https://api.elevenlabs.io/v1/music/plan', 'https://api.elevenlabs.io/v1/music'])
    expect(calls[0].body).toEqual({ prompt: musicPrompt(scored), music_length_ms: 30000, model_id: 'music_v2_5' })
    expect(calls[1].body).toEqual({ model_id: 'music_v2_5', sign_with_c2pa: true, composition_plan: { chunks: [
      { text: '[Intro]', duration_ms: 10000, positive_styles: ['lo-fi'], negative_styles: ['vocals'] },
      { text: '[Groove]', duration_ms: 20000, positive_styles: [], negative_styles: ['vocals'] },
    ] } })
  })

  it('ElevenLabs, plain: one call with the exact length', async () => {
    answer = mp3
    await compose({ provider: 'elevenlabs', model: 'music_v2_5' }, 'el', { prompt: 'Sting', seconds: 4 })
    expect(calls[0].body).toEqual({ model_id: 'music_v2_5', prompt: musicPrompt({ prompt: 'Sting', seconds: 4 }), music_length_ms: 4000, force_instrumental: true, sign_with_c2pa: true })
  })
})

describe('wav', () => {
  it('is a valid 16-bit mono header', () => {
    const w = wav(new Uint8Array(10), 16000)
    const v = new DataView(w.buffer)
    expect(v.getUint32(4, true)).toBe(46)
    expect(v.getUint16(22, true)).toBe(1)
    expect(v.getUint32(28, true)).toBe(32000)
  })
})
