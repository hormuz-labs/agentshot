import { describe, expect, it } from 'vitest'
import { lastSeenText } from '../src/shared/last-seen'

describe('lastSeenText', () => {
  const now = Date.UTC(2026, 10, 17, 12)
  it('says a phone with a live connection is connected now, whatever its last request', () => {
    expect(lastSeenText({ online: true, lastSeen: now - 86_400_000 }, now)).toBe('Connected now')
  })
  it('counts minutes, hours and days, singular and plural', () => {
    expect(lastSeenText({ online: false, lastSeen: now - 20_000 }, now)).toBe('Last connected just now')
    expect(lastSeenText({ online: false, lastSeen: now - 60_000 }, now)).toBe('Last connected 1 minute ago')
    expect(lastSeenText({ online: false, lastSeen: now - 5 * 60_000 }, now)).toBe('Last connected 5 minutes ago')
    expect(lastSeenText({ online: false, lastSeen: now - 3 * 3_600_000 }, now)).toBe('Last connected 3 hours ago')
    expect(lastSeenText({ online: false, lastSeen: now - 86_400_000 }, now)).toBe('Last connected 1 day ago')
  })
  it('gives a date after a month, and says so when a phone was never seen', () => {
    expect(lastSeenText({ online: false, lastSeen: now - 40 * 86_400_000 }, now)).toMatch(/^Last connected .*2026/)
    expect(lastSeenText({ online: false }, now)).toBe('Not connected since it was paired')
  })
})
