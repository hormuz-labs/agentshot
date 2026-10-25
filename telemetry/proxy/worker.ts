// AgentShot's usage proxy, a Cloudflare Worker in front of PostHog. The app sends its batches here, so:
// - PostHog never sees users' IP addresses (nothing from the request but the batch is passed on);
// - only the events and properties in src/shared/telemetry.ts get through, rebuilt from scratch, and crash reports
//   ($exception, PostHog error tracking) rebuilt by cleanException;
// - each IP is rate-limited, and the proxy only sends to AgentShot's own PostHog project.
// Deploy: see telemetry/README.md.
import { cleanException, USAGE_EVENTS } from '../../src/shared/telemetry'

export type Env = {
  POSTHOG_HOST: string
  POSTHOG_TOKEN: string
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> }
}

const MAX_BODY = 128 * 1024   // a crash report with its stack frames is the biggest
const MAX_EVENTS = 50
const CONTEXT = ['app_version', 'os', 'arch'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Incoming = { uuid?: unknown; event?: unknown; timestamp?: unknown; properties?: Record<string, unknown> }

const plain = (v: unknown) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
  || (typeof v === 'string' && v.length <= 64) || (Array.isArray(v) && v.length <= 50 && v.every(x => typeof x === 'string' && x.length <= 64))

/** The event as PostHog will get it, or null when anything about it is off the list. */
export function clean(e: Incoming): Record<string, unknown> | null {
  const crash = e.event === '$exception'
  const allowed = crash ? [] : (USAGE_EVENTS as Record<string, string[]>)[String(e.event)]
  const p = e.properties
  if (!allowed || typeof e.uuid !== 'string' || !UUID.test(e.uuid) || !p || typeof p !== 'object') return null
  if (typeof e.timestamp !== 'string' || Number.isNaN(Date.parse(e.timestamp))) return null
  if (typeof p.distinct_id !== 'string' || !UUID.test(p.distinct_id)) return null
  const exception = crash ? cleanException(p) : {}
  if (!exception) return null
  const properties: Record<string, unknown> = { ...exception, distinct_id: p.distinct_id, $process_person_profile: false, $geoip_disable: true }
  for (const k of [...allowed, ...CONTEXT]) {
    if (p[k] === undefined) continue
    if (!plain(p[k])) return null
    properties[k] = p[k]
  }
  return { uuid: e.uuid, event: e.event, timestamp: e.timestamp, properties }
}

const reply = (status: number) => new Response(null, { status })

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/batch/') return reply(404)
    if (request.method !== 'POST') return reply(405)
    if (env.LIMITER && !(await env.LIMITER.limit({ key: request.headers.get('cf-connecting-ip') || 'unknown' })).success) return reply(429)
    if (Number(request.headers.get('content-length') || 0) > MAX_BODY) return reply(413)
    const text = await request.text()
    if (text.length > MAX_BODY) return reply(413)
    let body: { api_key?: unknown; batch?: unknown }
    try { body = JSON.parse(text) } catch { return reply(400) }
    if (body.api_key !== env.POSTHOG_TOKEN || !Array.isArray(body.batch) || !body.batch.length || body.batch.length > MAX_EVENTS) return reply(400)
    const batch = body.batch.map(e => clean(e as Incoming))
    if (batch.some(e => !e)) return reply(400)
    const res = await fetch(`${env.POSTHOG_HOST}/batch/`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: env.POSTHOG_TOKEN, batch }),
    }).catch(() => null)
    // The app drops a batch on a 4xx and retries on anything else.
    return reply(!res ? 502 : res.ok ? 200 : res.status < 500 ? 400 : 502)
  },
}
