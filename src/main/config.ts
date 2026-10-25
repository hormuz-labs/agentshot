// Per-user settings in <userData>/config.json (paths the user chose or AgentShot discovered, preferences).
import { app } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BrowserMode, WhisperConfig } from '../shared/types'

export type Config = {
  whisper?: WhisperConfig
  /** open project tabs, restored on launch */
  tabs?: { open: string[]; active: string | null }
  /** which browser the agent's bsk drives (default: AgentShot's own) */
  browser?: { mode: BrowserMode }
  /** the first-run answers: both opt-in, both off unless ticked (see src/shared/telemetry.ts) */
  telemetry?: { usage: boolean; crashes: boolean; asked: boolean }
  /** the look: light (the default), dark, or the system's */
  theme?: 'light' | 'dark' | 'system'
  /** where the AgentShot key's models are reached (gateway.ts): unset means AgentShot's own gateway */
  gateway?: string
  /** who is signed in to AgentShot (account.ts); their key is in the keychain */
  account?: { email?: string; keyId?: string }
  /** while signed in, keep this computer reachable for the person's phones signed in to the same account (unset: yes) */
  accountPhones?: boolean
  /** share this computer as a cloud worker: a separate headless AgentShot worker runs alongside (its key is in the keychain) */
  cloudWorker?: { share: boolean }
}

const file = () => join(app.getPath('userData'), 'config.json')
let cache: Config | null = null

export function getConfig(): Config {
  if (!cache) {
    try { cache = JSON.parse(readFileSync(file(), 'utf8')) as Config } catch { cache = {} }
  }
  return cache
}

export function setConfig(patch: Partial<Config>) {
  cache = { ...getConfig(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 1))
  return cache
}
