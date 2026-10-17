import { describe, expect, it } from 'vitest'
import {
  aad, b64url, CHUNK_OVERHEAD, fromB64url, isTailscale, newKey, pairingUrl, readPairingUrl, ReplayGuard, seal, sealBytes, SealError, SKEW_MS, unseal,
  unsealBytes, type PairingCode,
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

describe('byte seals (upload pieces)', () => {
  const key = newKey()
  const ad = aad.chunk('u1', 4096)
  const bytes = Uint8Array.from({ length: 300 }, (_, i) => i & 255)

  it('open with the same key, upload and offset, at CHUNK_OVERHEAD more than the bytes', () => {
    const s = sealBytes(key, ad, bytes)
    expect(s.length).toBe(bytes.length + CHUNK_OVERHEAD)
    const r = unsealBytes(key, ad, s)
    expect([...r.value]).toEqual([...bytes])
    expect(r.nonce).toBe(b64url(s.subarray(0, 24)))
  })
  it('refuse another upload, offset or key, a changed byte, a short seal, or a stale one', () => {
    const s = sealBytes(key, ad, bytes)
    expect(() => unsealBytes(key, aad.chunk('u1', 0), s)).toThrow(SealError)
    expect(() => unsealBytes(key, aad.chunk('u2', 4096), s)).toThrow(SealError)
    expect(() => unsealBytes(newKey(), ad, s)).toThrow(SealError)
    for (const at of [0, 30, s.length - 1]) { const t = s.slice(); t[at] ^= 1; expect(() => unsealBytes(key, ad, t)).toThrow(SealError) }
    expect(() => unsealBytes(key, ad, s.subarray(0, 40))).toThrow(SealError)
    const now = Date.now()
    expect(() => unsealBytes(key, ad, sealBytes(key, ad, bytes, now - SKEW_MS - 1), now)).toThrow(/too old/)
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

describe('isTailscale', () => {
  it('knows a tailnet address (100.64.0.0/10) from a home network’s and everything else', () => {
    for (const h of ['100.64.0.1', '100.101.102.103', '100.127.255.254']) expect(isTailscale(h)).toBe(true)
    for (const h of ['100.63.255.255', '100.128.0.1', '10.0.0.5', '192.168.1.20', 'studio.local', '100.64.0.1.example.com']) expect(isTailscale(h)).toBe(false)
  })
})
