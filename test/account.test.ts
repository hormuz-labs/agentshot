import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { accountStatus, accountWorkers, balance, checkout, leaseAccountWorker, manageBilling, meshJoin, releaseAccountWorker, signIn, signOut, workerHeartbeat } from '../src/main/account'
import { getConfig } from '../src/main/config'
import { friendly } from '../src/main/agui'

// A fake Clerk (token endpoint) and a fake account service, on one local server. The "browser" follows the authorize
// URL straight back to the app's callback, as Clerk would after the person signs in.
const seen: Record<string, any> = {}
const server = createServer((req, res) => {
  let body = ''
  req.on('data', c => (body += c))
  req.on('end', () => {
    if (req.url === '/oauth/token') {
      seen.token = Object.fromEntries(new URLSearchParams(body))
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'clerk-access', token_type: 'Bearer' }))
    }
    if (req.url === '/v1/key') {
      seen.keyAuth = req.headers.authorization
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ key: 'sk-bf-ada', key_id: 'vk_1', email: 'ada@example.com' }))
    }
    if (req.url === '/v1/balance' || req.url === '/v1/checkout' || req.url === '/v1/portal') {
      seen[req.url] = { auth: req.headers.authorization, keyId: req.headers['x-manul-key-id'], body }
      const out = req.url === '/v1/balance' ? { credits: 1000, plan: null } : { url: `https://dodo.test${req.url}` }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out))
    }
    if (req.url === '/v1/mesh/join') {
      seen['/v1/mesh/join'] = { auth: req.headers.authorization, pool: req.headers['x-manul-pool-secret'], body }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-123', tag: 'tag:client' }))
    }
    if (req.url === '/v1/workers/heartbeat') {
      seen['/v1/workers/heartbeat'] = { auth: req.headers.authorization, pool: req.headers['x-manul-pool-secret'], body: JSON.parse(body) }
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'w1', pool: !!req.headers['x-manul-pool-secret'] }))
    }
    if (req.url === '/v1/workers') {
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ workers: [{ id: 'w1', name: 'Home Mac', pool: false, urls: ['https://100.64.0.2:47821'], fingerprint: 'a'.repeat(64), token: 'lease.1.x.y', capabilities: {}, expiresAt: 999 }], poolAvailable: 2 }))
    }
    if (req.url === '/v1/workers/lease') {
      seen['/v1/workers/lease'] = JSON.parse(body)
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ worker: { id: 'pool-1', name: 'Cloud Pool', pool: true, urls: ['https://100.64.0.9:47821'], fingerprint: 'b'.repeat(64), token: 'lease.2.x.y', capabilities: {}, expiresAt: 999 } }))
    }
    if (req.url === '/v1/workers/release') {
      seen['/v1/workers/release'] = JSON.parse(body)
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ released: true }))
    }
    res.writeHead(404).end()
  })
})
let base = ''
beforeAll(async () => {
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()))
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  Object.assign(process.env, { MANUL_AUTH_ISSUER: base, MANUL_ACCOUNT: base, MANUL_AUTH_CLIENT_ID: 'client-1' })
})
afterAll(() => { server.close(); delete process.env.MANUL_AUTH_ISSUER; delete process.env.MANUL_ACCOUNT; delete process.env.MANUL_AUTH_CLIENT_ID })

describe('signing in to AgentShot', () => {
  it('opens Clerk with PKCE, comes back on the callback, and stores the person’s key', async () => {
    let authorize: URL | undefined
    const status = await signIn(async url => {
      authorize = new URL(url)
      const back = new URL(authorize.searchParams.get('redirect_uri')!)
      back.search = new URLSearchParams({ code: 'the-code', state: authorize.searchParams.get('state')! }).toString()
      const page = await fetch(back)
      seen.page = await page.text()
    })
    expect(authorize!.origin + authorize!.pathname).toBe(`${base}/oauth/authorize`)
    expect(Object.fromEntries(authorize!.searchParams)).toMatchObject({ response_type: 'code', client_id: 'client-1', redirect_uri: 'http://127.0.0.1:47619/oauth/callback', code_challenge_method: 'S256', scope: 'openid email profile' })
    // the verifier sent to the token endpoint is the one the challenge was made from
    expect(createHash('sha256').update(seen.token.code_verifier).digest('base64url')).toBe(authorize!.searchParams.get('code_challenge'))
    expect(seen.token).toMatchObject({ grant_type: 'authorization_code', code: 'the-code', client_id: 'client-1' })
    expect(seen.keyAuth).toBe('Bearer clerk-access')
    expect(seen.page).toContain('Signed in')
    expect(status).toEqual({ email: 'ada@example.com', available: true })
    expect(process.env.MANUL_KEY).toBe('sk-bf-ada')
    expect(getConfig().account).toEqual({ email: 'ada@example.com', keyId: 'vk_1' })
  })

  it('asks for credits and plan, opens a plan’s checkout and the billing page, as the key', async () => {
    expect(await balance()).toEqual({ credits: 1000, plan: null })
    expect(seen['/v1/balance']).toMatchObject({ auth: 'Bearer sk-bf-ada', keyId: 'vk_1' })
    let opened = ''
    await checkout(url => { opened = url }, { plan: 'pro' })
    expect(opened).toBe('https://dodo.test/v1/checkout')
    expect(JSON.parse(seen['/v1/checkout'].body)).toEqual({ plan: 'pro' })
    await manageBilling(url => { opened = url })
    expect(opened).toBe('https://dodo.test/v1/portal')
  })

  it('joins the Headscale mesh, sends worker heartbeats, and discovers/leases/releases workers', async () => {
    expect(await meshJoin('client')).toEqual({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-123', tag: 'tag:client' })
    expect(seen['/v1/mesh/join']).toMatchObject({ auth: 'Bearer sk-bf-ada' })

    expect(await meshJoin('worker', 'pool-sec')).toEqual({ controlUrl: 'https://mesh.agentshot.si', authKey: 'tskey-123', tag: 'tag:client' })
    expect(seen['/v1/mesh/join']).toMatchObject({ pool: 'pool-sec' })

    await workerHeartbeat({ id: 'w1', name: 'Home Mac' })
    expect(seen['/v1/workers/heartbeat'].auth).toBe('Bearer sk-bf-ada')
    await workerHeartbeat({ id: 'w-pool', name: 'Pool' }, 'pool-sec')
    expect(seen['/v1/workers/heartbeat'].pool).toBe('pool-sec')

    const discovered = await accountWorkers()
    expect(discovered.poolAvailable).toBe(2)
    expect(discovered.workers[0].id).toBe('w1')

    const leased = await leaseAccountWorker({ projectId: 'proj_1' })
    expect(leased.id).toBe('pool-1')
    expect(seen['/v1/workers/lease']).toEqual({ projectId: 'proj_1' })

    expect(await releaseAccountWorker('pool-1')).toBe(true)
    expect(seen['/v1/workers/release']).toEqual({ workerId: 'pool-1' })
  })

  it('says what to do when the gateway refuses', () => {
    expect(friendly('manul API error (402): {"type":"budget_exceeded","error":{"message":"Budget exceeded: …"}}')).toMatch(/out of AgentShot credits/)
    expect(friendly('401 {"error":{"message":"access not found. The provided credential does not exist"}}')).toMatch(/Sign in again/)
    expect(friendly('403 {"type":"model_blocked","error":{"message":"Model \'gpt-6-astra\' is not allowed for virtual key \'user_1\'"}}')).toMatch(/Pro or Max plan/)
    expect(friendly('something else')).toBe('something else')
  })

  it('refuses a callback with the wrong state', async () => {
    const run = signIn(async url => {
      const back = new URL(new URL(url).searchParams.get('redirect_uri')!)
      back.search = 'code=x&state=forged'
      expect((await fetch(back)).status).toBe(400)
    }, 300)
    await expect(run).rejects.toThrow(/too long/)
  })

  it('signs out: the key goes from this computer', () => {
    expect(signOut()).toEqual({ email: undefined, available: true })
    expect(process.env.MANUL_KEY).toBeUndefined()
    expect(accountStatus().email).toBeUndefined()
  })
})
