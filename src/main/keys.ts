// API keys, encrypted with the OS keychain (Electron safeStorage) in <userData>/keys.json.
// Values never reach the renderer: it only learns which keys are set. Loaded keys are exported to process.env,
// where pi-ai's providers and tool processes read them.
import { app, safeStorage } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { KeyInfo } from '../shared/types'
import { isProviderKeyEnv } from '../shared/providers'

export const KEYS: Omit<KeyInfo, 'set'>[] = [
  { env: 'GEMINI_API_KEY', label: 'Google Gemini', unlocks: ['text', 'images', 'voice', 'music'], hint: 'aistudio.google.com → Get API key' },
  { env: 'ANTHROPIC_API_KEY', label: 'Anthropic', unlocks: ['text'], hint: 'console.anthropic.com → API keys' },
  { env: 'OPENAI_API_KEY', label: 'OpenAI', unlocks: ['text', 'images', 'voice'], hint: 'platform.openai.com → API keys' },
  { env: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', unlocks: ['voice', 'music'], hint: 'elevenlabs.io → Profile → API keys' },
  // one key for the models above, through Manul's gateway (gateway.ts); shown in its own tab
  { env: 'MANUL_KEY', label: 'Manul', unlocks: ['text', 'voice', 'music'], hint: 'Your Manul key' },
]

const file = () => join(app.getPath('userData'), 'keys.json')
let store: Record<string, string> = {}

export function loadKeys() {
  try { store = JSON.parse(readFileSync(file(), 'utf8')) } catch { store = {} }
  for (const [name, enc] of Object.entries(store)) {
    try { process.env[name] = safeStorage.decryptString(Buffer.from(enc, 'base64')) } catch { /* keychain refused: leave unset */ }
  }
}

export function setKey(name: string, value: string) {
  if (!KEYS.some(k => k.env === name) && !isProviderKeyEnv(name)) throw new Error(`unknown key ${name}`)  // or a custom provider's (providers.ts)
  if (value) {
    store[name] = safeStorage.encryptString(value).toString('base64')
    process.env[name] = value
  } else {
    delete store[name]
    delete process.env[name]
  }
  writeFileSync(file(), JSON.stringify(store, null, 1), { mode: 0o600 })
}

export const keyStatus = (): KeyInfo[] => KEYS.map(k => ({ ...k, set: !!process.env[k.env] }))
