// Who is asking (Clerk), their AgentShot key and their cloud worker (the account service), and the video links made
// for them (chat-host/src/people.ts, links.ts).
import { describe, expect, it, vi } from 'vitest'
import { AccountError, People } from '../chat-host/src/people'
import { readLink, signLink } from '../chat-host/src/links'

const worker = (id: string, ms = 24 * 60 * 60_000) => ({ id, name: id, urls: [`https://${id}.mesh:47821`], fingerprint: 'ab'.repeat(32), token: `lease.${id}`, expiresAt: Date.now() + ms })

/** Clerk and the account service as they answer. */
function services(o: { tokens?: Record<string, { sub: string; email?: string }>; lease?: () => Response } = {}) {
  const tokens = o.tokens ?? { good: { sub: 'user_maya', email: 'maya@example.com' } }
  let leases = 0
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url), h = new Headers(init?.headers)
    const bearer = /^Bearer (.+)$/.exec(h.get('authorization') || '')?.[1] || ''
    if (u === 'https://clerk.test/oauth/userinfo') return tokens[bearer] ? Response.json(tokens[bearer]) : new Response('no', { status: 401 })
    if (u === 'https://account.test/v1/key') return tokens[bearer] ? Response.json({ key: `sk-${tokens[bearer].sub}`, key_id: `vk-${tokens[bearer].sub}`, email: tokens[bearer].email }) : Response.json({ error: 'Your sign-in has expired. Sign in again.' }, { status: 401 })
    if (u === 'https://account.test/v1/workers/lease') {
      if (o.lease) return o.lease()
      if (!bearer.startsWith('sk-') || h.get('x-manul-key-id') !== bearer.replace('sk-', 'vk-')) return Response.json({ error: 'Sign in again.' }, { status: 401 })
      return Response.json({ worker: worker(`w${++leases}`) })
    }
    return new Response('?', { status: 404 })
  })
  return { f, people: new People({ clerk: 'https://clerk.test/', account: 'https://account.test', fetch: f as typeof fetch }) }
}

describe('who is asking', () => {
  it('is who Clerk says the token is, asked once for a while', async () => {
    const { f, people } = services()
    expect(await people.who('good')).toEqual({ sub: 'user_maya', email: 'maya@example.com' })
    expect(await people.who('good')).toEqual({ sub: 'user_maya', email: 'maya@example.com' })
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('is nobody for a token Clerk doesn’t know', async () => {
    const { people } = services()
    expect(await people.who('forged')).toBeUndefined()
  })
  it('asks Clerk again after five minutes, so a token signed out stops working', async () => {
    let now = 1_000_000
    const tokens: Record<string, { sub: string }> = { good: { sub: 'user_maya' } }
    const { f } = services({ tokens })
    const people = new People({ clerk: 'https://clerk.test', account: 'https://account.test', fetch: f as typeof fetch, now: () => now })
    expect(await people.who('good')).toBeTruthy()
    delete tokens.good
    now += 6 * 60_000
    expect(await people.who('good')).toBeUndefined()
  })
})

describe('their cloud worker', () => {
  it('is leased with their AgentShot key (got with their sign-in), and kept while the lease lasts', async () => {
    const { f, people } = services()
    const maya = (await people.who('good'))!
    const w = await people.worker(maya, 'good')
    expect(w).toMatchObject({ id: 'w1', urls: ['https://w1.mesh:47821'], token: 'lease.w1' })
    expect(await people.worker(maya, 'good')).toBe(w)
    expect(f.mock.calls.filter(c => String(c[0]).endsWith('/v1/key'))).toHaveLength(1)
    expect(f.mock.calls.filter(c => String(c[0]).endsWith('/lease'))).toHaveLength(1)
  })

  it('is leased again when the one held stopped answering, without asking for the key again', async () => {
    const { f, people } = services()
    const maya = (await people.who('good'))!
    await people.worker(maya, 'good')
    expect((await people.worker(maya, undefined, true)).id).toBe('w2')
    expect(f.mock.calls.filter(c => String(c[0]).endsWith('/v1/key'))).toHaveLength(1)
  })

  it('leases once when asked many times at once', async () => {
    const { f, people } = services()
    const maya = (await people.who('good'))!
    const all = await Promise.all([1, 2, 3].map(() => people.worker(maya, 'good')))
    expect(new Set(all.map(w => w.id)).size).toBe(1)
    expect(f.mock.calls.filter(c => String(c[0]).endsWith('/lease'))).toHaveLength(1)
  })

  it('passes on what the account service says when there is none to be had', async () => {
    const { people } = services({ lease: () => Response.json({ error: 'No cloud workers are free right now. Try again in a moment.' }, { status: 404 }) })
    const maya = (await people.who('good'))!
    const failed = people.worker(maya, 'good')
    await expect(failed).rejects.toBeInstanceOf(AccountError)
    await expect(failed).rejects.toThrow('No cloud workers are free right now.')
  })

  it('needs a sign-in the first time', async () => {
    const { people } = services()
    await expect(people.worker({ sub: 'user_new' }, undefined)).rejects.toThrow(/Connect AgentShot again/)
  })
})

describe('video links', () => {
  it('play one project’s files for the person they were made for, until they run out', () => {
    const t = signLink('s3cret', { sub: 'user_maya', dir: '/space/maya/launch', exp: 2_000 })
    expect(readLink('s3cret', t, 1_000)).toEqual({ sub: 'user_maya', dir: '/space/maya/launch', exp: 2_000 })
    expect(readLink('s3cret', t, 2_000)).toBeUndefined()
    expect(readLink('other', t, 1_000)).toBeUndefined()
  })
  it('can’t be changed into someone else’s', () => {
    const t = signLink('s3cret', { sub: 'user_maya', dir: '/space/maya/launch', exp: 2_000 })
    const [, sig] = t.split('.')
    const forged = `${Buffer.from(JSON.stringify(['user_sam', '/space/sam/x', 2_000])).toString('base64url')}.${sig}`
    for (const bad of [forged, `${t}x`, t.replace('.', '..'), '', 'a.b.c']) expect(readLink('s3cret', bad, 1_000), bad).toBeUndefined()
  })
})
