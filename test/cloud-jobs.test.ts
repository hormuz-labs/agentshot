// The app's side of paid cloud jobs, against a stand-in worker that answers the way the real one is specified to
// (test/fixtures/job-api.v1.schema.json is the worker's own schema, copied).
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloudJobs, JOB_API, KINDS, STATUSES, offersFor, priceOf, resultTitle, statusLine, type CloudJob, type Offer } from '../src/main/cloud-jobs'

const schema = JSON.parse(readFileSync('test/fixtures/job-api.v1.schema.json', 'utf8'))
const OFFERS: Offer[] = [
  { kind: 'upscale', name: 'Upscale to 4K', creditsPerSecond: 2.5, minCredits: 40, maxSeconds: 1800, maxBytes: 4294967296, refund: 'Credits come back in full if the job fails.' },
  { kind: 'voice', name: 'Isolate the voice', creditsPerSecond: 0.5, minCredits: 20, maxSeconds: 7200, maxBytes: 4294967296, refund: 'Credits come back in full if the job fails.' },
]

/** A worker that keeps what it was asked and plays a job through the statuses it is told to. */
function worker() {
  const w = {
    asked: [] as { method: string; path: string; headers: IncomingMessage['headers']; body: Buffer }[],
    credits: 1000,
    /** what each look at the job says, in order; the last one repeats */
    plays: ['running', 'done'] as CloudJob['status'][],
    error: null as string | null,
    output: Buffer.from('the film in 4K') as Buffer | null,
    outputFails: 0,
    looksFail: 0,
    cancelled: [] as string[],
    job: null as CloudJob | null,
    url: '',
    server: null as unknown as Server,
  }
  const send = (res: import('node:http').ServerResponse, status: number, body: unknown) => {
    const text = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))
    res.writeHead(status, { 'content-type': Buffer.isBuffer(body) ? 'video/mp4' : 'application/json', 'content-length': text.length }).end(text)
  }
  w.server = createServer(async (req, res) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const body = Buffer.concat(chunks)
    const path = req.url || ''
    w.asked.push({ method: req.method || '', path, headers: req.headers, body })
    if (req.headers['x-agentshot-api'] !== '1') return send(res, 400, { error: 'This version of AgentShot can’t use cloud jobs. Update the app.' })
    if (path === '/v1/offers') return send(res, 200, { api: '1', offers: OFFERS })
    if (req.headers.authorization !== 'Bearer sk-bf-ada' || req.headers['x-manul-key-id'] !== 'vk_ada') return send(res, 401, { error: 'Sign in to AgentShot again.' })
    if (path === '/v1/jobs' && req.method === 'POST') {
      const b = JSON.parse(body.toString())
      const offer = OFFERS.find(o => o.kind === b.kind)
      if (!offer) return send(res, 400, { error: 'That kind of job isn’t offered.' })
      const credits = priceOf(offer, b.seconds)
      if (w.credits < credits) return send(res, 402, { error: `This needs ${credits} credits and you have ${w.credits}. Add credits in Settings, then try again.` })
      w.job = { id: '1794610731-25b051dc', kind: b.kind, status: 'awaiting_upload', error: null, seconds: b.seconds, bytes: b.bytes, name: b.name || '', credits, charged: 0, refunded: 0, createdAt: 1794610731, startedAt: null, finishedAt: null }
      return send(res, 200, { job: w.job, upload: `/v1/jobs/${w.job.id}/input` })
    }
    const j = w.job
    if (!j || !path.startsWith(`/v1/jobs/${j.id}`)) return send(res, 404, { error: 'There’s no such job.' })
    if (path.endsWith('/input') && req.method === 'PUT') {
      if (req.headers['transfer-encoding'] || Number(req.headers['content-length']) !== j.bytes || body.length !== j.bytes) return send(res, 400, { error: 'The film isn’t the size this job was made for.' })
      w.credits -= j.credits
      Object.assign(j, { status: 'queued', charged: j.credits })
      return send(res, 200, j)
    }
    if (path.endsWith('/cancel') && req.method === 'POST') { w.cancelled.push(j.id); Object.assign(j, { status: 'cancelled' }); return send(res, 200, j) }
    if (path.endsWith('/output')) {
      if (j.status !== 'done') return send(res, 409, { error: 'The film isn’t ready.' })
      if (w.outputFails > 0) { w.outputFails--; return send(res, 503, { error: 'The film can’t be fetched right now. Try again in a moment.' }) }
      return w.output ? send(res, 200, w.output) : send(res, 410, { error: 'The film is no longer kept here. Run the job again.' })
    }
    if (path === `/v1/jobs/${j.id}`) {
      if (w.looksFail > 0) { w.looksFail--; return send(res, 503, { error: 'Cloud jobs are unavailable right now.' }) }
      if (j.status !== 'cancelled') {
        const status = w.plays.length > 1 ? w.plays.shift()! : w.plays[0]
        Object.assign(j, { status, error: status === 'failed' ? w.error : null, refunded: status === 'failed' ? j.charged : 0, startedAt: 1794610740, finishedAt: status === 'done' || status === 'failed' ? 1794610800 : null })
      }
      return send(res, 200, j)
    }
    send(res, 404, { error: 'Not found.' })
  })
  return w
}

let w: ReturnType<typeof worker>
let dir: string
let film: string
let key: { key: string; keyId: string } | undefined
const jobs = (pollMs = 5) => new CloudJobs({ url: () => w.url, key: () => key, pollMs })
const run = (kind: 'upscale' | 'voice' = 'upscale', on = {}, signal?: AbortSignal) => jobs().run({ kind, file: film, seconds: 60, name: 'Launch film', out: join(dir, 'out.mp4') }, on, signal)

beforeEach(async () => {
  w = worker()
  await new Promise<void>(ok => w.server.listen(0, '127.0.0.1', ok))
  w.url = `http://127.0.0.1:${(w.server.address() as { port: number }).port}`
  dir = mkdtempSync(join(tmpdir(), 'agentshot-cloud-'))
  film = join(dir, 'film.mp4')
  writeFileSync(film, Buffer.alloc(300_000, 7))
  key = { key: 'sk-bf-ada', keyId: 'vk_ada' }
})
afterEach(() => new Promise<void>(ok => w.server.close(() => ok())))

describe('the price shown before a cloud job', () => {
  it('is worked out as the worker works it out', () => {
    const [up, voice] = OFFERS
    expect(priceOf(up, 60)).toBe(150)
    expect(priceOf(up, 60.1)).toBe(151)
    expect(priceOf(up, 1)).toBe(40)
    expect(priceOf(up, 16.4)).toBe(41)
    expect(priceOf(voice, 60)).toBe(30)
    expect(priceOf(voice, 10)).toBe(20)
    // 0.1 × 3 is 0.30000000000000004 in a float: still 1 credit, not 2
    expect(priceOf({ creditsPerSecond: 0.1, minCredits: 1 }, 10)).toBe(1)
    expect(priceOf({ creditsPerSecond: 0.1, minCredits: 1 }, 30)).toBe(3)
  })
})

describe('an offer, for the film in hand', () => {
  const film = { seconds: 60, bytes: 5_000_000, hasAudio: true }
  it('is priced for that film', () => {
    expect(offersFor(OFFERS, film)).toEqual([
      { kind: 'upscale', name: 'Upscale to 4K', credits: 150, refund: OFFERS[0].refund },
      { kind: 'voice', name: 'Isolate the voice', credits: 30, refund: OFFERS[1].refund },
    ])
  })
  it('says why it can’t be done to a film, before anything is sent, and quotes no price for it', () => {
    const one = (f: Parameters<typeof offersFor>[1]) => offersFor(OFFERS, f).map(o => [o.credits, o.cannot])
    expect(one(undefined)).toEqual([[null, 'There’s no film to send yet.'], [null, 'There’s no film to send yet.']])
    expect(one({ ...film, seconds: 0 })[0]).toEqual([null, 'There’s no film to send yet.'])
    // forty minutes: past upscaling's thirty, within voice isolation's two hours
    expect(one({ ...film, seconds: 2400 })).toEqual([[null, 'Upscale to 4K takes films up to 30 minutes; this one is 40.'], [1200, undefined]])
    expect(one({ ...film, bytes: 5 * 1024 ** 3 })[0]).toEqual([null, 'Upscale to 4K takes films up to 4 GB.'])
    // a silent film can be upscaled, but has no voice to isolate
    expect(one({ ...film, hasAudio: false })).toEqual([[150, undefined], [null, 'This film has no sound.']])
    expect(one({ ...film, seconds: 1800 })[0]).toEqual([4500, undefined])
  })
  it('names what comes back', () => {
    for (const k of KINDS) expect(resultTitle(k)).toBeTruthy()
    expect(resultTitle('upscale')).toBe('Upscaled to 4K')
  })
})

describe('what the worker offers', () => {
  it('is listed with its prices, without anyone signed in', async () => {
    key = undefined
    expect(await jobs().offers()).toEqual(OFFERS)
    expect(w.asked[0].headers['x-agentshot-api']).toBe(JOB_API)
    expect(w.asked[0].headers.authorization).toBeUndefined()
  })

  it('is nothing when the worker can’t be reached, so the app shows no cloud jobs', async () => {
    await new Promise<void>(ok => w.server.close(() => ok()))
    expect(await jobs().offers()).toEqual([])
    await new Promise<void>(ok => w.server.listen(0, '127.0.0.1', ok))
  })

  it('leaves out what this app doesn’t know how to show', async () => {
    const answer = (body: unknown, status = 200) => new CloudJobs({ url: () => 'http://worker.test', key: () => key, fetch: async () => new Response(JSON.stringify(body), { status }) }).offers()
    expect(await answer({ api: '1', offers: [...OFFERS, { ...OFFERS[0], kind: 'colourise' }, { ...OFFERS[0], creditsPerSecond: 0 }, 'nonsense'] })).toEqual(OFFERS)
    expect(await answer({ api: '2', offers: OFFERS }), 'a worker speaking another version').toEqual([])
    expect(await answer({ error: 'This version of AgentShot can’t use cloud jobs. Update the app.' }, 400)).toEqual([])
    expect(await answer('<html>a login page</html>')).toEqual([])
  })
})

describe('running a cloud job', () => {
  it('asks for it, sends the film, follows it and saves the result', async () => {
    const seen: string[] = []
    const sent: number[] = []
    const j = await run('upscale', { job: (j: CloudJob) => seen.push(j.status), sent: (f: number) => sent.push(f) })
    expect(j).toMatchObject({ status: 'done', kind: 'upscale', credits: 150, charged: 150, refunded: 0 })
    expect(readFileSync(join(dir, 'out.mp4'), 'utf8')).toBe('the film in 4K')
    expect(readdirSync(dir).sort()).toEqual(['film.mp4', 'out.mp4'])
    // every step of the job was said, in order, once each
    expect(seen).toEqual(['awaiting_upload', 'queued', 'running', 'done'])
    expect(sent.at(-1)).toBe(1)
    expect(sent).toEqual([...sent].sort((a, b) => a - b))

    const [create, upload] = w.asked
    expect([create.method, create.path]).toEqual(['POST', '/v1/jobs'])
    expect(JSON.parse(create.body.toString())).toEqual({ kind: 'upscale', seconds: 60, bytes: 300_000, name: 'Launch film' })
    expect([upload.method, upload.path]).toEqual(['PUT', '/v1/jobs/1794610731-25b051dc/input'])
    // the film goes whole, with its size stated up front: the worker refuses one sent without
    expect(upload.headers['content-length']).toBe('300000')
    expect(upload.headers['transfer-encoding']).toBeUndefined()
    expect(upload.body.equals(readFileSync(film))).toBe(true)
    // every request says who is asking and which version of the API is spoken
    for (const a of w.asked) {
      expect(a.headers.authorization, a.path).toBe('Bearer sk-bf-ada')
      expect(a.headers['x-manul-key-id'], a.path).toBe('vk_ada')
      expect(a.headers['x-agentshot-api'], a.path).toBe('1')
    }
    expect(w.cancelled).toEqual([])
  })

  it('asks for the kind it was told to', async () => {
    const j = await run('voice')
    expect(j).toMatchObject({ kind: 'voice', credits: 30 })
    expect(JSON.parse(w.asked[0].body.toString()).kind).toBe('voice')
  })

  it('asks nothing of the worker when nobody is signed in', async () => {
    key = undefined
    await expect(run()).rejects.toThrow('Sign in to AgentShot first.')
    key = { key: 'sk-bf-ada', keyId: '' }
    await expect(run()).rejects.toThrow('Sign in to AgentShot first.')
    expect(w.asked).toEqual([])
  })

  it('says the worker’s own sentence when there are too few credits, and sends no film', async () => {
    w.credits = 100
    await expect(run()).rejects.toThrow('This needs 150 credits and you have 100. Add credits in Settings, then try again.')
    expect(w.asked.map(a => a.method)).toEqual(['POST'])
    expect(existsSync(join(dir, 'out.mp4'))).toBe(false)
  })

  it('says to sign in again when the key is no longer good', async () => {
    key = { key: 'sk-bf-old', keyId: 'vk_ada' }
    await expect(run()).rejects.toThrow('Sign in to AgentShot again.')
  })

  it('says why a job failed, in the worker’s words, and leaves no film behind', async () => {
    w.plays = ['running', 'failed']
    w.error = 'The upscaler stopped partway.'
    await expect(run()).rejects.toThrow('The upscaler stopped partway.')
    expect(readdirSync(dir)).toEqual(['film.mp4'])
    expect(w.asked.some(a => a.path.endsWith('/output'))).toBe(false)
  })

  it('waits through the queue and the machine starting', async () => {
    w.plays = ['queued', 'queued', 'starting', 'running', 'running', 'done']
    const seen: string[] = []
    await run('upscale', { job: (j: CloudJob) => seen.push(j.status) })
    expect(seen).toEqual(['awaiting_upload', 'queued', 'starting', 'running', 'done'])
  })

  it('keeps following a job through a worker that doesn’t answer for a while', async () => {
    w.looksFail = 5
    expect((await run()).status).toBe('done')
  })

  it('gives up following, without calling the job failed, when the worker stays silent', async () => {
    w.looksFail = 1000
    await expect(run()).rejects.toThrow(/lost touch with the job. It may still finish/)
    expect(w.cancelled, 'a job it can’t see is not cancelled: it may be nearly done').toEqual([])
  })

  it('cancels the job at the worker when it is stopped', async () => {
    w.plays = ['running']
    const stop = new AbortController()
    const going = run('upscale', { job: (j: CloudJob) => { if (j.status === 'running') stop.abort() } }, stop.signal)
    await expect(going).rejects.toThrow('Cancelled.')
    expect(w.cancelled).toEqual(['1794610731-25b051dc'])
    expect(readdirSync(dir)).toEqual(['film.mp4'])
  })

  it('tries again when fetching a finished film fails, since it is already paid for', async () => {
    w.outputFails = 2
    expect((await run()).status).toBe('done')
    expect(readFileSync(join(dir, 'out.mp4'), 'utf8')).toBe('the film in 4K')
    expect(w.asked.filter(a => a.path.endsWith('/output'))).toHaveLength(3)
  })

  it('says the film is paid for and kept when it can’t be fetched, and leaves no half-written file', async () => {
    w.outputFails = 10
    await expect(run()).rejects.toThrow(/The job finished, but its film couldn’t be fetched .* It was paid for and is kept for a while: try again\./)
    expect(readdirSync(dir)).toEqual(['film.mp4'])
  })

  it('does not take an answer of the wrong shape for a job', async () => {
    const odd = new CloudJobs({ url: () => 'http://worker.test', key: () => key, fetch: async () => new Response(JSON.stringify({ job: { id: 'x', status: 'paused' }, upload: 'https://elsewhere.example/steal' })) })
    await expect(odd.run({ kind: 'upscale', file: film, seconds: 60, name: 'x', out: join(dir, 'out.mp4') })).rejects.toThrow()
    expect(readdirSync(dir)).toEqual(['film.mp4'])
  })
})

describe('the app and the worker’s job API agree', () => {
  const job = schema.$defs.job
  it('on the kinds of job and the statuses a job passes through', () => {
    expect([...KINDS]).toEqual(job.properties.kind.enum)
    expect([...STATUSES]).toEqual(job.properties.status.enum)
    expect(schema.$defs.createRequest.properties.kind.enum).toEqual([...KINDS])
    for (const s of STATUSES) expect(statusLine({ status: s }), s).toBeTruthy()
  })

  it('on what a job and an offer hold: a job as this test’s worker answers is one the schema allows, field for field', async () => {
    const j = await run()
    expect(Object.keys(j).sort()).toEqual([...job.required].sort())
    expect(Object.keys(j).sort()).toEqual(Object.keys(job.properties).sort())
    expect(Object.keys(OFFERS[0]).sort()).toEqual([...schema.$defs.offers.properties.offers.items.required].sort())
    expect(new RegExp(job.properties.id.pattern).test(j.id)).toBe(true)
  })

  it('on what the app sends to ask for a job', async () => {
    await run()
    const sent = JSON.parse(w.asked[0].body.toString())
    const request = schema.$defs.createRequest
    for (const k of request.required) expect(sent, k).toHaveProperty(k)
    for (const k of Object.keys(sent)) expect(Object.keys(request.properties), k).toContain(k)
    expect(new RegExp(schema.$defs.created.properties.upload.pattern).test(w.asked[1].path)).toBe(true)
    expect(JOB_API).toBe(schema.$defs.offers.properties.api.const)
  })
})
