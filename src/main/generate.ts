// Voice and music for the agent (generate_voice, generate_music). With the person's own key when they have one
// (ElevenLabs first, then Gemini, then OpenAI for voice; or the one the agent names), called from here; otherwise with
// their Manul key through Manul's account service, which picks the vendor itself and takes the price off their credit.
// The vendor calls are shared with that service: account/src/media.ts.
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { compose, KEY_ENV, MediaError, MODELS, speak, VENDOR_NAME, type MusicRequest, type Vendor, type VoiceRequest } from '../../account/src/media.ts'
import { manulMedia } from './account'
import { getConfig } from './config'
import { MANUL_KEY } from './gateway'

export type Kind = 'voice' | 'music'
const ORDER: Record<Kind, Vendor[]> = { voice: ['elevenlabs', 'gemini', 'openai'], music: ['elevenlabs', 'gemini'] }

export type Route = { via: 'own'; provider: Vendor } | { via: 'manul' }

/** Who makes it: the person's own key (the one asked for, else the first they have), else their Manul key. */
export function routeFor(kind: Kind, prefer?: string, env: Record<string, string | undefined> = process.env): Route {
  const own = ORDER[kind].filter(v => env[KEY_ENV[v]])
  if (prefer && own.includes(prefer as Vendor)) return { via: 'own', provider: prefer as Vendor }
  if (own[0]) return { via: 'own', provider: own[0] }
  if (env[MANUL_KEY]) {
    if (!getConfig().account?.keyId) throw new Error(`Making ${kind} with a Manul key needs signing in: Settings → Keys → Manul key → Sign in to Manul.`)
    return { via: 'manul' }
  }
  const keys = ORDER[kind].map(v => VENDOR_NAME[v]).join(', ')
  throw new Error(`No key for ${kind}: the user can sign in to Manul or add a key (${keys}) in Settings → Keys.`)
}

/** Make it and save it as <dir>/generated/<kind>-<name>.<mp3|wav> (never over an earlier take). */
export async function generate(kind: Kind, req: VoiceRequest | MusicRequest, dir: string, name: string, prefer?: string, signal?: AbortSignal) {
  const route = routeFor(kind, prefer)
  let audio: { data: Uint8Array; ext: string }
  let by: string
  if (route.via === 'own') {
    const choice = { provider: route.provider, model: MODELS[kind][route.provider]! }
    try {
      audio = kind === 'voice'
        ? await speak(choice, process.env[KEY_ENV[route.provider]]!, req as VoiceRequest, { signal })
        : await compose(choice, process.env[KEY_ENV[route.provider]]!, req as MusicRequest, { signal })
    } catch (e) {
      throw e instanceof MediaError ? new Error(`${VENDOR_NAME[route.provider]}: ${e.message}`) : e
    }
    by = `${VENDOR_NAME[route.provider]} ${choice.model}, with the user's own key`
  } else {
    const got = await manulMedia(kind, req, signal)
    audio = got
    by = `Manul ($${got.cost.toFixed(2)} of the user's Manul credit)`
  }
  const slug = (name || kind).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || kind
  await mkdir(join(dir, 'generated'), { recursive: true })
  let rel = `generated/${kind}-${slug}.${audio.ext}`
  for (let i = 2; existsSync(join(dir, rel)); i++) rel = `generated/${kind}-${slug}-${i}.${audio.ext}`
  await writeFile(join(dir, rel), audio.data)
  return { rel, by }
}
