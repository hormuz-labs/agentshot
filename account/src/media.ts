// Voice (text to speech) and music from the vendors Manul works with, behind one request shape, so the agent asks for
// "a warm narrator saying this" or "62 s of lo-fi in three sections" and doesn't care who makes it. Used twice:
//   - the app, with the person's own keys (src/main/generate.ts)
//   - the account service, with Manul's keys, for people with a Manul key (index.ts: /v1/voice, /v1/music); which
//     vendor and model it uses, the voices and the prices are in media.json (gateway/k8s/media.json), never told to the app
// Errors never name the vendor: the app adds it for the person's own keys, the account service never does.

export type Vendor = 'elevenlabs' | 'gemini' | 'openai'
export type Choice = { provider: Vendor; model: string }
export type VoiceRequest = {
  text: string
  /** one of VOICES; default narrator */
  voice?: string
  /** how to say it: "calm and warm", "excited", "whispering" */
  style?: string
}
export type Section = { name: string; seconds: number; description?: string; lyrics?: string }
export type MusicRequest = {
  /** genre, mood, instruments, BPM, key, energy */
  prompt: string
  seconds: number
  /** default true */
  instrumental?: boolean
  /** score to picture: sections in order, their seconds adding up to seconds */
  sections?: Section[]
}
export type Audio = { data: Uint8Array; type: string; ext: 'mp3' | 'wav' }
export type Voice = { about: string } & Record<Vendor, string>

export const KEY_ENV: Record<Vendor, string> = { elevenlabs: 'ELEVENLABS_API_KEY', gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }
export const VENDOR_NAME: Record<Vendor, string> = { elevenlabs: 'ElevenLabs', gemini: 'Google Gemini', openai: 'OpenAI' }

/** Each vendor's model when nothing else says (the app with the person's own keys; media.json for Manul keys). */
export const MODELS: { voice: Record<Vendor, string>; music: Partial<Record<Vendor, string>> } = {
  voice: { elevenlabs: 'eleven_v3', gemini: 'gemini-3.8-flash-tts', openai: 'gpt-4o-mini-tts' },
  music: { elevenlabs: 'music_v2_5', gemini: 'lyria-3.5' },
}

/** Manul's voices: one name, the nearest voice at each vendor (ElevenLabs premade voice ids, Gemini and OpenAI voice names). */
export const VOICES: Record<string, Voice> = {
  narrator: { about: 'warm, clear female narrator (default)', elevenlabs: 'EXAVITQu4vr4xnSDxMaL', gemini: 'Sulafat', openai: 'coral' },
  guide: { about: 'calm, friendly male voice for explainers and tutorials', elevenlabs: 'JBFqnCBsd6RMkjVDRZzb', gemini: 'Achird', openai: 'ash' },
  anchor: { about: 'deep, authoritative male voice for trailers and promos', elevenlabs: 'nPczCjzI2devNBz1zQrb', gemini: 'Charon', openai: 'onyx' },
  bright: { about: 'bright, upbeat female voice for ads and social', elevenlabs: 'cgSgspJ2msm6clMCkdW9', gemini: 'Zephyr', openai: 'nova' },
  energetic: { about: 'energetic young male voice for shorts and sports', elevenlabs: 'TX3LPaxmHKxFdv7VOQHJ', gemini: 'Puck', openai: 'echo' },
  soft: { about: 'soft, gentle female voice for meditative or emotional pieces', elevenlabs: 'XrExE9yKIg1WjnnlVkGX', gemini: 'Achernar', openai: 'shimmer' },
  storyteller: { about: 'mature, textured male storyteller for documentaries', elevenlabs: 'onwK4e9ZLuTAKqWW03F9', gemini: 'Algenib', openai: 'fable' },
  professional: { about: 'firm, crisp female voice for corporate and product videos', elevenlabs: 'Xb7hH8MSUJpSbSDYk0k2', gemini: 'Kore', openai: 'sage' },
}

/** A request that can't be made, or a vendor's refusal; status is what the account service answers with. */
export class MediaError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export function checkVoice(r: VoiceRequest, voices = VOICES) {
  if (typeof r?.text !== 'string' || !r.text.trim()) throw new MediaError('Give the text to say.')
  if (r.text.length > 5000) throw new MediaError('At most 5,000 characters at a time: split the script.')
  if (r.voice != null && !voices[r.voice]) throw new MediaError(`Unknown voice "${r.voice}". Voices: ${Object.keys(voices).join(', ')}.`)
}

export function checkMusic(r: MusicRequest) {
  if (typeof r?.prompt !== 'string' || !r.prompt.trim()) throw new MediaError('Describe the music.')
  if (!(r.seconds >= 3 && r.seconds <= 600)) throw new MediaError('Music lasts 3 to 600 seconds.')
  if (r.sections?.length) {
    if (r.sections.some(s => !s?.name || !(s.seconds >= 3 && s.seconds <= 120))) throw new MediaError('Each section needs a name and 3 to 120 seconds.')
    const total = r.sections.reduce((a, s) => a + s.seconds, 0)
    if (Math.abs(total - r.seconds) > 1) throw new MediaError(`The sections add up to ${total} s, not ${r.seconds} s.`)
  }
}

const ts = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`

/** The music asked for in words, sections as timestamps (Lyria, and ElevenLabs' plan). */
export function musicPrompt(r: MusicRequest) {
  const instrumental = r.instrumental !== false
  let t = 0
  const sections = (r.sections || []).map(s => {
    const line = `[${ts(t)} - ${ts(t + s.seconds)}] ${s.name}${s.description ? `: ${s.description}` : ''}${!instrumental && s.lyrics ? `\nLyrics:\n${s.lyrics}` : ''}`
    t += s.seconds
    return line
  })
  return [`A ${Math.round(r.seconds)}-second ${instrumental ? 'instrumental ' : ''}track. ${r.prompt.trim()}`, ...sections,
    instrumental ? 'Instrumental only, no vocals.' : ''].filter(Boolean).join('\n')
}

async function refused(r: Response): Promise<never> {
  const body = await r.text().catch(() => '')
  let msg = ''
  try {
    const j = JSON.parse(body)
    const d = j.error ?? j.detail ?? j
    msg = typeof d === 'string' ? d : d?.message || (typeof d?.status === 'string' && d.status) || ''
  } catch { msg = body.slice(0, 200) }
  if (r.status === 401 || r.status === 403) throw new MediaError(`the key was refused (${r.status})${msg ? `: ${msg}` : ''}`, 502)
  if (r.status === 429) throw new MediaError('too many requests right now: wait a minute and try once more', 429)
  if (r.status >= 500) throw new MediaError(`the service failed (${r.status}); try once more`, 502)
  throw new MediaError(`refused (${r.status})${msg ? `: ${msg}` : ''}`, 422)
}

const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

/** 16-bit PCM (what Gemini speaks) in a WAV file. */
export function wav(pcm: Uint8Array, rate = 24000, channels = 1) {
  const out = new Uint8Array(44 + pcm.length)
  const v = new DataView(out.buffer)
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true); v.setUint32(24, rate, true)
  v.setUint32(28, rate * channels * 2, true); v.setUint16(32, channels * 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length, true)
  out.set(pcm, 44)
  return out
}

/** Gemini's audio part: MP3 as it is, raw PCM (audio/L16;rate=…) wrapped as WAV. */
function geminiAudio(j: any): Audio {
  const part = j?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)
  if (!part) {
    const why = j?.promptFeedback?.blockReason || j?.candidates?.[0]?.finishReason
    throw new MediaError(`no audio came back${why ? ` (${why}: reword the request)` : ''}`, 422)
  }
  const { mimeType = '', data } = part.inlineData
  const bytes = b64(data)
  if (/mpeg|mp3/.test(mimeType)) return { data: bytes, type: 'audio/mpeg', ext: 'mp3' }
  if (/wav/.test(mimeType)) return { data: bytes, type: 'audio/wav', ext: 'wav' }
  const rate = Number(/rate=(\d+)/.exec(mimeType)?.[1] || 24000)
  return { data: wav(bytes, rate), type: 'audio/wav', ext: 'wav' }
}

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta/models'
const ELEVEN = 'https://api.elevenlabs.io/v1'

/** Say the text. */
export async function speak(c: Choice, key: string, r: VoiceRequest, opts: { voices?: Record<string, Voice>; signal?: AbortSignal } = {}): Promise<Audio> {
  const voices = opts.voices || VOICES
  checkVoice(r, voices)
  const voice = voices[r.voice || 'narrator'] || VOICES.narrator
  const signal = opts.signal
  if (c.provider === 'elevenlabs') {
    // v3 takes the delivery as an audio tag in the text
    const text = r.style && /v3/.test(c.model) ? `[${r.style}] ${r.text}` : r.text
    const res = await fetch(`${ELEVEN}/text-to-speech/${encodeURIComponent(voice.elevenlabs)}?output_format=mp3_44100_128`, {
      method: 'POST', signal, headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: c.model }),
    })
    if (!res.ok) await refused(res)
    return { data: new Uint8Array(await res.arrayBuffer()), type: 'audio/mpeg', ext: 'mp3' }
  }
  if (c.provider === 'gemini') {
    const res = await fetch(`${GEMINI}/${encodeURIComponent(c.model)}:generateContent`, {
      method: 'POST', signal, headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: r.style ? `Say this ${r.style}:\n${r.text}` : r.text }] }],
        generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice.gemini } } } },
      }),
    })
    if (!res.ok) await refused(res)
    return geminiAudio(await res.json().catch(() => null))
  }
  if (c.provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST', signal, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: c.model, voice: voice.openai, input: r.text, response_format: 'mp3', ...(r.style ? { instructions: `Speak ${r.style}.` } : {}) }),
    })
    if (!res.ok) await refused(res)
    return { data: new Uint8Array(await res.arrayBuffer()), type: 'audio/mpeg', ext: 'mp3' }
  }
  throw new MediaError('voice isn’t available from this provider', 503)
}

/** Make the music. */
export async function compose(c: Choice, key: string, r: MusicRequest, opts: { signal?: AbortSignal } = {}): Promise<Audio> {
  checkMusic(r)
  const signal = opts.signal
  const instrumental = r.instrumental !== false
  if (c.provider === 'elevenlabs') {
    const headers = { 'xi-api-key': key, 'content-type': 'application/json' }
    const ms = Math.round(r.seconds * 1000)
    let body: Record<string, unknown> = { model_id: c.model, prompt: musicPrompt(r), music_length_ms: ms, force_instrumental: instrumental, sign_with_c2pa: true }
    if (r.sections?.length) {
      // score to picture: ask for a plan (free), make its sections last exactly as asked, compose from it
      const p = await fetch(`${ELEVEN}/music/plan`, { method: 'POST', signal, headers, body: JSON.stringify({ prompt: musicPrompt(r), music_length_ms: ms, model_id: c.model }) })
      if (!p.ok) await refused(p)
      const plan = await p.json() as { chunks?: any[]; sections?: any[] }
      const parts = plan.chunks || plan.sections || []
      if (parts.length === r.sections.length) {
        parts.forEach((x, i) => {
          x.duration_ms = Math.round(r.sections![i].seconds * 1000)
          const neg = plan.chunks ? 'negative_styles' : 'negative_local_styles'
          if (instrumental && !(x[neg] || []).includes('vocals')) x[neg] = [...(x[neg] || []), 'vocals']
          if (instrumental && plan.sections) x.lines = []
        })
        body = { model_id: c.model, composition_plan: plan, sign_with_c2pa: true }
      }
    }
    const res = await fetch(`${ELEVEN}/music`, { method: 'POST', signal, headers, body: JSON.stringify(body) })
    if (!res.ok) await refused(res)
    return { data: new Uint8Array(await res.arrayBuffer()), type: 'audio/mpeg', ext: 'mp3' }
  }
  if (c.provider === 'gemini') {
    const res = await fetch(`${GEMINI}/${encodeURIComponent(c.model)}:generateContent`, {
      method: 'POST', signal, headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: musicPrompt(r) }] }], generationConfig: { responseModalities: ['AUDIO', 'TEXT'] } }),
    })
    if (!res.ok) await refused(res)
    return geminiAudio(await res.json().catch(() => null))
  }
  throw new MediaError('music isn’t available from this provider', 503)
}
