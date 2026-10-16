import { describe, expect, it } from 'vitest'
import {
  aad, b64url, fromB64url, newKey, pairingUrl, readPairingUrl, ReplayGuard, seal, SealError, SKEW_MS, unseal, type PairingCode,
} from '../src/shared/remote'

const code = (o: Partial<PairingCode> = {}): PairingCode =>
  ({ v: 1, mac: 'm1', name: 'Studio Mac', hosts: ['192.168.1.20', 'studio.local'], port: 47821, secret: newKey(), expires: Date.now() + 60_000, ...o })

describe('base64url', () => {
  it('round-trips every length', () => {
    for (let n = 0; n < 40; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255)
      const s = b64url(bytes)
      expect(s).toMatch(/^[A-Za-z0-9_-]*$/)
      expect(s).toBe(Buffer.from(bytes).toString('base64url'))
      expect([...fromB64url(s)]).toEqual([...bytes])
    }
  })
  it('refuses what is not base64url', () => {
    expect(() => fromB64url('a+b/')).toThrow()
    expect(() => fromB64url('abcde')).toThrow()
  })
})

describe('pairing code', () => {
  it('reads back what the QR says', () => {
    const c = code()
    expect(readPairingUrl(pairingUrl(c))).toEqual(c)
  })
  it('ignores other QR codes, other versions and expired codes', () => {
    expect(readPairingUrl('https://example.com')).toBeNull()
    expect(readPairingUrl('manul://pair#not-json')).toBeNull()
    expect(readPairingUrl(pairingUrl(code({ v: 2 })))).toBeNull()
    expect(readPairingUrl(pairingUrl(code({ expires: Date.now() - 1 })))).toBeNull()
  })
})

describe('seals', () => {
  const key = newKey()
  const ad = aad.request('POST', '/v1/projects/p1/messages')

  it('open with the same key and binding', () => {
    const s = seal(key, ad, { text: 'cut the intro' })
    expect(unseal(key, ad, s).value).toEqual({ text: 'cut the intro' })
    expect(unseal(key, ad, s).nonce).toBe(s.split('.')[0])
    expect(unseal(key, ad, seal(key, ad, undefined)).value).toBeNull()
  })
  it('refuse another key, another binding, or a changed byte', () => {
    const s = seal(key, ad, { text: 'hi' })
    expect(() => unseal(newKey(), ad, s)).toThrow(SealError)
    expect(() => unseal(key, aad.request('POST', '/v1/projects/p2/messages'), s)).toThrow(SealError)
    expect(() => unseal(key, aad.request('GET', '/v1/projects/p1/messages'), s)).toThrow(SealError)
    const [n, box] = s.split('.')
    const flipped = fromB64url(box); flipped[0] ^= 1
    expect(() => unseal(key, ad, `${n}.${b64url(flipped)}`)).toThrow(SealError)
    expect(() => unseal(key, ad, 'garbage')).toThrow(SealError)
  })
  it('refuse a seal from too far in the past or future', () => {
    const now = Date.now()
    expect(() => unseal(key, ad, seal(key, ad, 1, now - SKEW_MS - 1), now)).toThrow(/too old/)
    expect(() => unseal(key, ad, seal(key, ad, 1, now + SKEW_MS + 1), now)).toThrow(/too old/)
    expect(unseal(key, ad, seal(key, ad, 1, now - SKEW_MS + 1000), now).value).toBe(1)
  })
  it('bind replies and events to their request', () => {
    const req = seal(key, ad, null)
    const nonce = unseal(key, ad, req).nonce
    const ev = seal(key, aad.event(nonce, 3), { type: 'RUN_STARTED' })
    expect(unseal(key, aad.event(nonce, 3), ev).value).toEqual({ type: 'RUN_STARTED' })
    expect(() => unseal(key, aad.event(nonce, 4), ev)).toThrow(SealError)
    expect(() => unseal(key, aad.reply(nonce), ev)).toThrow(SealError)
  })
})

describe('ReplayGuard', () => {
  it('accepts a nonce once, and forgets it after seals have expired', () => {
    const g = new ReplayGuard()
    const t = 1_000_000
    expect(g.accept('a', t)).toBe(true)
    expect(g.accept('a', t + 1)).toBe(false)
    expect(g.accept('b', t + 2 * SKEW_MS + 1)).toBe(true)
    expect(g.accept('a', t + 2 * SKEW_MS + 2)).toBe(true)
  })
})
