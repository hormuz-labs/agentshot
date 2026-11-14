// Paid jobs on AgentShot's worker: work a person's own computer can't do well (upscaling to 4K, isolating a voice),
// done on a machine of ours and paid for with their credits. This is the app's side of it: ask what is on offer, send a
// film, follow the job, bring the result back. The worker quotes a price before anything is sent, takes the credits
// only once the film has arrived, and gives them back if the job fails.
//
// What the worker answers is fixed by its job API, version 1 (test/fixtures/job-api.v1.schema.json is a copy of the
// worker's own schema, and test/cloud-jobs.test.ts holds this file to it).
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { z } from 'zod'

/** The version of the worker's job API this app speaks. The worker refuses any other, with a sentence saying to update. */
export const JOB_API = '1'

export const KINDS = ['upscale', 'voice'] as const
export type CloudKind = (typeof KINDS)[number]

const offerSchema = z.object({
  kind: z.enum(KINDS),
  name: z.string(),
  creditsPerSecond: z.number().positive(),
  minCredits: z.number().int().min(1),
  maxSeconds: z.number().positive(),
  maxBytes: z.number().int().min(1),
  refund: z.string(),
})
/** One thing the worker will do, and what it costs. */
export type Offer = z.infer<typeof offerSchema>

export const STATUSES = ['awaiting_upload', 'uploading', 'queued', 'starting', 'running', 'done', 'failed', 'cancelled'] as const
const jobSchema = z.object({
  id: z.string().regex(/^[0-9]+-[0-9a-f]{8}$/),
  kind: z.enum(KINDS),
  status: z.enum(STATUSES),
  error: z.string().nullable(),
  seconds: z.number().positive(),
  bytes: z.number().int().min(1),
  name: z.string(),
  credits: z.number().int().min(1),
  charged: z.number().int().min(0),
  refunded: z.number().int().min(0),
  createdAt: z.number().int(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
})
/** A job as the worker reports it. */
export type CloudJob = z.infer<typeof jobSchema>
const createdSchema = z.object({ job: jobSchema, upload: z.string().regex(/^\/v1\/jobs\/[0-9a-f-]+\/input$/) })

/** What a job on a film this long costs, in credits: by the second, rounded up, never under the minimum. The worker
 *  works it out the same way and its figure is the one charged; this is for showing the price before asking. */
export const priceOf = (o: Pick<Offer, 'creditsPerSecond' | 'minCredits'>, seconds: number) =>
  Math.max(o.minCredits, Math.ceil(Math.round(seconds * o.creditsPerSecond * 1e6) / 1e6))

/** Where a job stands, in words for the person. */
export const statusLine = (j: Pick<CloudJob, 'status'>) => ({
  awaiting_upload: 'Getting ready', uploading: 'Sending the film', queued: 'Waiting for a machine', starting: 'Starting a machine',
  running: 'Working on it', done: 'Done', failed: 'It didn’t work', cancelled: 'Cancelled',
}[j.status])

export type Key = { key: string; keyId: string }
type Options = {
  /** where the worker is */
  url(): string
  /** the signed-in person's AgentShot key and its id, if anyone is signed in */
  key(): Key | undefined
  fetch?: typeof fetch
  /** how often to ask how a job is doing */
  pollMs?: number
}

const UNAVAILABLE = 'Cloud jobs can’t be reached right now. Try again in a moment.'
const ENDED = new Set<CloudJob['status']>(['done', 'failed', 'cancelled'])

export class CloudJobs {
  constructor(private o: Options) {}
  private get base() { return this.o.url().replace(/\/+$/, '') }
  private headers(): Record<string, string> {
    const k = this.o.key()
    if (!k?.key || !k.keyId) throw new Error('Sign in to AgentShot first.')
    return { authorization: `Bearer ${k.key}`, 'x-manul-key-id': k.keyId, 'x-agentshot-api': JOB_API }
  }

  /** Asks the worker something as the signed-in person. A refusal comes back as the worker's own sentence. */
  private async ask(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = { ...this.headers(), ...(init.body ? { 'content-type': 'application/json' } : {}) }
    const r = await (this.o.fetch ?? fetch)(`${this.base}${path}`, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(30_000) }).catch(e => {
      if ((e as Error).name === 'AbortError' && init.signal?.aborted) throw e
      throw new Error(UNAVAILABLE)
    })
    if (r.ok) return r
    const body = await r.json().catch(() => null) as { error?: unknown } | null
    throw new Error(typeof body?.error === 'string' && body.error ? body.error : UNAVAILABLE)
  }

  /** What the worker offers now. Nothing, when it can't be reached or doesn't speak this app's version: the app then
   *  simply shows no cloud jobs. Needs nobody signed in. */
  async offers(): Promise<Offer[]> {
    try {
      const r = await (this.o.fetch ?? fetch)(`${this.base}/v1/offers`, { headers: { 'x-agentshot-api': JOB_API }, signal: AbortSignal.timeout(8000) })
      if (!r.ok) return []
      const body = await r.json() as { api?: unknown; offers?: unknown }
      if (body.api !== JOB_API || !Array.isArray(body.offers)) return []
      // an offer this app doesn't know how to show (a kind added later) is left out, not an error
      return body.offers.flatMap(o => { const p = offerSchema.safeParse(o); return p.success ? [p.data] : [] })
    } catch { return [] }
  }

  private async job(id: string, signal?: AbortSignal) { return jobSchema.parse(await (await this.ask(`/v1/jobs/${id}`, { signal })).json()) }

  /** Sends the film with its size stated up front, which the worker insists on, and says how far along it is. */
  private upload(path: string, file: string, size: number, sent: (fraction: number) => void, signal?: AbortSignal): Promise<CloudJob> {
    const url = new URL(`${this.base}${path}`)
    return new Promise<CloudJob>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, { method: 'PUT', headers: { ...this.headers(), 'content-type': 'application/octet-stream', 'content-length': String(size) }, signal }, res => {
        const chunks: Buffer[] = []
        res.on('data', c => chunks.push(c))
        res.on('error', () => reject(new Error(UNAVAILABLE)))
        res.on('end', () => {
          let body: unknown = null
          try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { /* not JSON: handled below */ }
          if (res.statusCode === 200) {
            const j = jobSchema.safeParse(body)
            return j.success ? resolve(j.data) : reject(new Error(UNAVAILABLE))
          }
          const said = (body as { error?: unknown } | null)?.error
          reject(new Error(typeof said === 'string' && said ? said : UNAVAILABLE))
        })
      })
      req.on('error', e => reject(signal?.aborted ? e : new Error('The film didn’t arrive whole. Try again.')))
      let gone = 0
      const film = createReadStream(file)
      film.on('data', c => { gone += c.length; sent(Math.min(1, gone / size)) })
      film.on('error', e => { req.destroy(e); reject(e) })
      film.pipe(req)
    })
  }

  /**
   * Runs one job from start to finish: asks for it (which quotes the price and takes nothing), sends the film (which
   * is when the credits are taken), follows it until it ends, and saves the result at `out`.
   * Stopping it (signal) cancels the job at the worker, which returns the credits if its machine wasn't running yet.
   */
  async run(what: { kind: CloudKind; file: string; seconds: number; name: string; out: string }, on: { job?(j: CloudJob): void; sent?(fraction: number): void } = {}, signal?: AbortSignal): Promise<CloudJob> {
    const size = (await stat(what.file)).size
    const made = createdSchema.parse(await (await this.ask('/v1/jobs', { method: 'POST', body: JSON.stringify({ kind: what.kind, seconds: what.seconds, bytes: size, name: what.name }), signal })).json())
    let j = made.job
    on.job?.(j)
    const cancel = async () => { await this.ask(`/v1/jobs/${j.id}/cancel`, { method: 'POST' }).catch(() => {}) }
    try {
      j = await this.upload(made.upload, what.file, size, f => on.sent?.(f), signal)
      on.job?.(j)
      // the machine carries on whether or not this computer can reach the worker: a few lost answers are not the job failing
      let lost = 0
      while (!ENDED.has(j.status)) {
        await new Promise<void>((resolve, reject) => {
          const stop = () => { clearTimeout(t); reject(new Error('Stopped')) }
          const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve() }, this.o.pollMs ?? 5000)
          if (signal?.aborted) stop()
          else signal?.addEventListener('abort', stop, { once: true })
        })
        try {
          const next = await this.job(j.id, signal)
          lost = 0
          if (next.status !== j.status) on.job?.(next)
          j = next
        } catch (e) {
          if (signal?.aborted) throw e
          if (++lost >= 20) throw new Error('AgentShot lost touch with the job. It may still finish: its credits come back if it doesn’t.')
        }
      }
    } catch (e) {
      if (signal?.aborted) { await cancel(); throw new Error('Cancelled.') }
      throw e
    }
    if (j.status === 'failed') throw new Error(j.error || 'The job didn’t work. Your credits are being returned.')
    if (j.status === 'cancelled') throw new Error('Cancelled.')
    // the finished film, to a file beside where it will live, moved into place only once it is whole
    // It is paid for by now, so a connection that drops while fetching it is tried again before giving up.
    const part = `${what.out}.part`
    for (let attempt = 1; ; attempt++) {
      try {
        const r = await this.ask(`/v1/jobs/${j.id}/output`, { signal: signal ?? AbortSignal.timeout(6 * 60 * 60_000) })
        if (!r.body) throw new Error(UNAVAILABLE)
        await pipeline(Readable.fromWeb(r.body as import('node:stream/web').ReadableStream), createWriteStream(part))
        const want = Number(r.headers.get('content-length'))
        if (want > 0 && (await stat(part)).size !== want) throw new Error('The finished film didn’t arrive whole.')
        await rename(part, what.out)
        return j
      } catch (e) {
        await rm(part, { force: true })
        if (signal?.aborted) throw new Error('Cancelled.')
        if (attempt >= 3) throw new Error(`The job finished, but its film couldn’t be fetched (${(e as Error).message.replace(/\.$/, '')}). It was paid for and is kept for a while: try again.`)
      }
    }
  }
}

/** What the app knows of the film a job would be run on. */
export type Film = { seconds: number; bytes: number; hasAudio: boolean } | undefined
/** An offer as the person sees it for one film: what it would cost, or why it can't be done to this film. */
export type OfferFor = { kind: CloudKind; name: string; credits: number | null; refund: string; cannot?: string }

/** Each offer, priced for this film, or with the reason it can't be run on it. Said before anything is sent, so nobody
 *  uploads a film only to be told it is too long. */
export function offersFor(offers: Offer[], film: Film): OfferFor[] {
  return offers.map(o => {
    const cannot = !film || !(film.seconds > 0) ? 'There’s no film to send yet.'
      : film.seconds > o.maxSeconds ? `${o.name} takes films up to ${Math.floor(o.maxSeconds / 60)} minutes; this one is ${Math.ceil(film.seconds / 60)}.`
      : film.bytes > o.maxBytes ? `${o.name} takes films up to ${Math.floor(o.maxBytes / 1024 ** 3)} GB.`
      : o.kind === 'voice' && !film.hasAudio ? 'This film has no sound.'
      : undefined
    return { kind: o.kind, name: o.name, credits: cannot || !film ? null : priceOf(o, film.seconds), refund: o.refund, ...(cannot ? { cannot } : {}) }
  })
}

/** What a finished job's film is called among the project's versions. */
export const resultTitle = (kind: CloudKind) => ({ upscale: 'Upscaled to 4K', voice: 'Voice isolated' }[kind])
