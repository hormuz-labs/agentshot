// Usage statistics, only when the user said yes. Events from src/shared/telemetry.ts go to PostHog through Manul's
// proxy, which keeps users' IP addresses from PostHog. The queue is kept on disk and capped; event UUIDs make retries
// safe when an acknowledgement is lost.
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { sanitize, type UsageEvent, type UsageEvents } from '../shared/telemetry'

type Queued = { uuid: string; event: string; properties: Record<string, unknown>; timestamp: string }
type State = { installationId: string; pending: Queued[]; activeSeconds: number }

const MAX_PENDING = 500 // offline for weeks: keep the newest, drop the oldest
const BATCH = 50

export class UsageTelemetry {
  private state: State
  private lastTick: number
  private sending = false
  private request: AbortController | undefined
  private timer: ReturnType<typeof setInterval> | undefined

  constructor(private opts: {
    file: string
    /** the proxy's origin, e.g. https://t.manul.si; empty in builds without telemetry */
    endpoint: string
    /** the PostHog project token (public: it can only send events) */
    token: string
    enabled: () => boolean
    focused: () => boolean
    idleSeconds: () => number
    /** sent with every event: app version, platform, architecture */
    context?: Record<string, string>
    now?: () => number
    date?: () => Date
    post?: typeof fetch
  }) {
    try {
      const saved = JSON.parse(readFileSync(opts.file, 'utf8')) as State
      this.state = saved.installationId && Array.isArray(saved.pending) && Number.isFinite(saved.activeSeconds) ? saved : this.empty()
    } catch { this.state = this.empty() }
    this.lastTick = this.now()
  }

  get available() { return !!(this.opts.endpoint && this.opts.token) }
  private empty(): State { return { installationId: randomUUID(), pending: [], activeSeconds: 0 } }
  private now() { return this.opts.now ? this.opts.now() : performance.now() }
  private save() { try { writeFileSync(this.opts.file, JSON.stringify(this.state)) } catch { /* a full disk must not break the app */ } }
  private on() { return this.available && this.opts.enabled() }

  start() {
    if (!this.available) return
    this.timer = setInterval(() => { this.tick(); void this.flush() }, 15_000)
    this.timer.unref?.()
    void this.flush() // events left from a previous run
  }

  /** Queue one event. Properties outside the list in src/shared/telemetry.ts are dropped. */
  track<E extends UsageEvent>(event: E, props: UsageEvents[E]) {
    if (!this.on()) return
    const properties = sanitize(event, props as Record<string, unknown>)
    if (!properties) return
    this.state.pending.push({ uuid: randomUUID(), event, properties, timestamp: (this.opts.date?.() ?? new Date()).toISOString() })
    if (this.state.pending.length > MAX_PENDING) this.state.pending.splice(0, this.state.pending.length - MAX_PENDING)
    this.save()
  }

  tick() {
    const now = this.now()
    // A suspended computer must not turn a single timer tick into hours of "use".
    const seconds = Math.min(15, Math.max(0, (now - this.lastTick) / 1000))
    this.lastTick = now
    if (!this.on() || !this.opts.focused() || this.opts.idleSeconds() >= 60) return
    this.state.activeSeconds += seconds
    // One active-time event waits at a time; while offline the seconds add up in it rather than in the queue.
    if (this.state.activeSeconds >= 60 && !this.state.pending.some(p => p.event === 'active time')) {
      const whole = Math.floor(this.state.activeSeconds)
      this.state.activeSeconds -= whole
      this.track('active time', { seconds: whole })
    } else this.save()
  }

  async flush() {
    if (!this.on() || this.sending || !this.state.pending.length) return
    const batch = this.state.pending.slice(0, BATCH)
    const id = this.state.installationId
    this.sending = true
    const request = new AbortController()
    this.request = request
    const timeout = setTimeout(() => request.abort(), 10_000)
    try {
      const res = await (this.opts.post || fetch)(`${this.opts.endpoint.replace(/\/$/, '')}/batch/`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: request.signal,
        body: JSON.stringify({
          api_key: this.opts.token,
          batch: batch.map(e => ({ uuid: e.uuid, event: e.event, timestamp: e.timestamp, properties: {
            ...this.opts.context, ...e.properties, distinct_id: id, $process_person_profile: false, $geoip_disable: true,
          } })),
        }),
      })
      // A rejected batch (bad request, wrong token) will never succeed: drop it rather than retry forever.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429
      if ((res.ok || permanent) && this.opts.enabled() && this.state.installationId === id) {
        const sent = new Set(batch.map(e => e.uuid))
        this.state.pending = this.state.pending.filter(e => !sent.has(e.uuid))
        this.save()
      }
    } catch { /* offline: the same UUIDs go next time */ }
    finally { clearTimeout(timeout); this.request = undefined; this.sending = false }
  }

  setEnabled(enabled: boolean) {
    this.lastTick = this.now()
    if (enabled) { void this.flush(); return }
    // Stop, discard anything unsent, and forget the installation ID when the user says no.
    this.request?.abort()
    this.state = this.empty()
    this.save()
  }

  stop() { if (this.timer) clearInterval(this.timer); this.tick() }
}
