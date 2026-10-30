import type { AccountPlan } from './types'

/** Paid plans retain access until the paid-through date, including cancelled renewals. */
export function hasVoiceoverAccess(plan: AccountPlan | null, now = Date.now()) {
  return !!plan && ['pro', 'max', 'pro_annual', 'max_annual'].includes(plan.key) && Date.parse(plan.until) > now
}

export type Voiceover = { id: string; src: string; start: number; in: number; out: number; db: number; muted?: boolean }
export type VoiceoverAsset = { id: string; src: string; conversation: string; createdAt: number; duration: number; peaks: number[] }

/** Stable, readable display name; the original source path remains the attachment identity. */
export function voiceoverName(assets: VoiceoverAsset[], src: string) {
  const index = assets.findIndex(a => a.src === src)
  return index < 0 ? 'Voiceover' : `Voiceover ${String(index + 1).padStart(2, '0')}`
}

export function validateVoiceover(v: Voiceover, sourceDuration: number, filmDuration: number) {
  if (![v.start, v.in, v.out, v.db, sourceDuration].every(Number.isFinite) || v.start < 0 || v.start >= filmDuration || v.in < 0 || v.out <= v.in || v.out > sourceDuration + .001 || v.db < -40 || v.db > 12) {
    throw new Error('Choose valid voiceover timing and a volume between −40 and +12 dB.')
  }
}
