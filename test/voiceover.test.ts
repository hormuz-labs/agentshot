import { describe, expect, it } from 'vitest'
import { hasVoiceoverAccess, validateVoiceover } from '../src/shared/voiceover'
import { applyEdit, fromMedia, sameCut } from '../src/shared/timeline'
import { regionsOnTimeline } from '../src/shared/mix'
import type { AccountPlan } from '../src/shared/types'
import { localProEnabled } from '../src/shared/local-pro'

const track = { id: 'take', src: 'media/voice.wav', start: 2, in: 1, out: 4, db: -3 }
const base = fromMedia('media/film.mp4', 10, { width: 160, height: 120, fps: 25 })

describe('premium voiceover access', () => {
  it('enables local Pro only with an explicit flag outside packaged builds', () => {
    expect(localProEnabled(false, '1')).toBe(true)
    expect(localProEnabled(false, undefined)).toBe(false)
    expect(localProEnabled(false, '0')).toBe(false)
    expect(localProEnabled(true, '1')).toBe(false)
  })
  const now = Date.parse('2026-10-30T00:00:00Z')
  const plan: AccountPlan = { key: 'pro', name: 'Pro', every: 'month', credits: 10000, renews: false, until: '2026-11-01T00:00:00Z' }
  it('accepts paid plans through their paid-through date even after cancellation', () => {
    for (const key of ['pro', 'max', 'pro_annual', 'max_annual']) expect(hasVoiceoverAccess({ ...plan, key }, now)).toBe(true)
  })
  it('rejects free, expired, invalid and missing plans', () => {
    for (const p of [null, { ...plan, key: 'free' }, { ...plan, until: '2026-10-01' }, { ...plan, until: 'invalid' }]) expect(hasVoiceoverAccess(p, now)).toBe(false)
  })
})

describe('voiceover timeline', () => {
  it('adds, adjusts and removes independently of film pieces, retaining the original for undo', () => {
    const added = applyEdit(base, { op: 'voiceover', id: track.id, track })
    expect(sameCut(base, added)).toBe(false)
    expect(added.items).toEqual(base.items)
    const moved = applyEdit(added, { op: 'voiceover', id: track.id, track: { ...track, start: 5, muted: true } })
    expect(moved.mix?.voiceovers).toHaveLength(1)
    expect(added.mix?.voiceovers?.[0].start).toBe(2)
    expect(sameCut(base, applyEdit(moved, { op: 'voiceover', id: track.id, track: null }))).toBe(true)
  })
  it('validates time, source bounds, volume and finite inputs', () => {
    expect(() => validateVoiceover(track, 5, 10)).not.toThrow()
    for (const patch of [{ start: -1 }, { start: 10 }, { in: -1 }, { out: 6 }, { out: 1 }, { db: 13 }, { db: NaN }]) expect(() => validateVoiceover({ ...track, ...patch }, 5, 10)).toThrow()
  })
  it('ducks music for overlapping recorded voices and ignores muted takes', () => {
    expect(regionsOnTimeline({ ...base, mix: { filmDb: 0, voiceovers: [track, { ...track, id: 'two', start: 4 }, { ...track, id: 'muted', start: 8, muted: true }] } }, {})).toEqual([[2, 7]])
  })
})
