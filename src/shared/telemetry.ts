// What AgentShot may report, when the user has said yes. Every usage event and every property is listed here; nothing
// else can be sent. Never add file names, paths, project titles, prompts, transcripts, keys or URLs.
// telemetry/README.md publishes this list; keep the two in step.

export type UsageEvents = {
  /** the app started */
  'app opened': Record<string, never>
  /** a project was made from a video */
  'project created': Record<string, never>
  /** a motion video was started from nothing: which gallery example (its public id, or none), the format, whether the user's own reference video came with it */
  'motion project created': { example: string; aspect: string; reference: boolean }
  /** seconds of focused, non-idle use since the last report */
  'active time': { seconds: number }
  /** one agent turn: which model family, which of AgentShot's tools it called, how it ended */
  'agent run': { provider: string; model: string; tools: string[]; toolCalls: number; ok: boolean; seconds: number }
  /** the user kept or rejected a proposed version */
  'version decided': { accepted: boolean }
  /** a film export, by the user or the agent */
  'export finished': { preset: string; captions: string; by: 'user' | 'agent'; ok: boolean; seconds: number }
  /** an optional tool (whisper, a model) was downloaded */
  'tool installed': { tool: string; ok: boolean }
}
export type UsageEvent = keyof UsageEvents

/** Property names each event may carry, checked at runtime as well as by the types. */
export const USAGE_EVENTS: { [E in UsageEvent]: (keyof UsageEvents[E])[] } = {
  'app opened': [],
  'project created': [],
  'motion project created': ['example', 'aspect', 'reference'],
  'active time': ['seconds'],
  'agent run': ['provider', 'model', 'tools', 'toolCalls', 'ok', 'seconds'],
  'version decided': ['accepted'],
  'export finished': ['preset', 'captions', 'by', 'ok', 'seconds'],
  'tool installed': ['tool', 'ok'],
}

type Value = string | number | boolean | string[]

/** Keep only the listed properties, as short plain values; anything else is dropped. */
export function sanitize(event: string, props: Record<string, unknown>): Record<string, Value> | null {
  const allowed = (USAGE_EVENTS as Record<string, string[]>)[event]
  if (!allowed) return null
  const short = (s: string) => s.slice(0, 64)
  const out: Record<string, Value> = {}
  for (const k of allowed) {
    const v = props[k]
    if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 10) / 10
    else if (typeof v === 'string') out[k] = short(v)
    else if (Array.isArray(v)) out[k] = v.filter(x => typeof x === 'string').slice(0, 50).map(short)
  }
  return out
}

/** Crash reports: replace anything that looks like a file path outside the app with <path>, so file and folder
 *  names (which can name a client or a film) never leave the machine. App frames are already app:/// paths.
 *  Names can have spaces, so a path runs to its closing quote, or to ": ", ", " or the end of the line. */
const PATH = String.raw`(?:(?:[A-Za-z]:)?[\\/](?:Users|home|Volumes|private|tmp|var|mnt|media|Documents and Settings)[\\/]|~[\\/])`
const QUOTED_PATH = new RegExp(String.raw`(['"\x60])${PATH}[^'"\x60\n]*\1`, 'g')
const BARE_PATH = new RegExp(String.raw`${PATH}[^'"\x60)\]\n]*?(?=: |, |['"\x60)\]\n]|$)`, 'g')
export function scrubPaths(text: string): string {
  return text.replace(QUOTED_PATH, '$1<path>$1').replace(BARE_PATH, '<path>')
}

// Breadcrumbs that could carry the user's data: console lines, request URLs, page navigations.
const NOISY_CRUMBS = /^(console|http|fetch|xhr|navigation|electron\.net)/
type Crumb = { category?: string; message?: string; data?: unknown }
type CrashEvent = { message?: string; exception?: { values?: { value?: string }[] }; breadcrumbs?: Crumb[]; server_name?: string; user?: unknown; request?: unknown }

export const keepCrumb = (b: Crumb) => !NOISY_CRUMBS.test(b.category ?? '')
export function scrubCrumb<T extends Crumb>(b: T): T {
  return { ...b, message: b.message ? scrubPaths(b.message) : b.message, data: undefined }
}

/** The last pass over a crash report before it is sent: no paths, no noisy breadcrumbs, no host or user. */
export function scrubEvent<T extends CrashEvent>(event: T): T {
  if (event.message) event.message = scrubPaths(event.message)
  for (const ex of event.exception?.values ?? []) if (ex.value) ex.value = scrubPaths(ex.value)
  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.filter(keepCrumb).map(scrubCrumb)
  delete event.server_name
  delete event.user
  delete event.request
  return event
}

/**
 * Crash reports as PostHog error tracking events ($exception): the exception's type, message and stack frames, already
 * scrubbed (scrubEvent), and nothing else from Sentry's event. Built here, and rebuilt by the proxy with cleanException.
 */
type SentryFrame = { filename?: string; abs_path?: string; function?: string; lineno?: number; colno?: number; in_app?: boolean }
type SentryException = { type?: string; value?: string; mechanism?: { type?: string; handled?: boolean }; stacktrace?: { frames?: SentryFrame[] } }
export type ExceptionEvent = { message?: string; level?: string; exception?: { values?: SentryException[] }; contexts?: Record<string, unknown> }

const MAX_EXCEPTIONS = 5
const MAX_FRAMES = 60
const cut = (v: unknown, n: number) => (typeof v === 'string' ? scrubPaths(v).slice(0, n) : undefined)
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined)
const LEVELS = ['fatal', 'error', 'warning', 'info']

export function exceptionProperties(event: ExceptionEvent): Record<string, unknown> {
  const values = event.exception?.values?.length
    ? event.exception.values
    // a native crash (a minidump) has no JavaScript exception: say what crashed, without the dump
    : [{ type: 'Native crash', value: event.message || 'The app or one of its windows crashed', mechanism: { type: 'minidump', handled: false } }]
  return cleanException({
    $exception_level: event.level || 'error',
    $exception_list: values.map(e => ({
      type: e.type, value: e.value, mechanism: e.mechanism,
      // Sentry lists frames oldest first; so does PostHog's raw stack trace
      stacktrace: { type: 'raw', frames: (e.stacktrace?.frames || []).map(f => ({ ...f, filename: f.filename || f.abs_path })) },
    })),
  })!
}

/** The $exception properties PostHog gets, rebuilt from scratch: short strings, scrubbed paths, nothing else. */
export function cleanException(p: Record<string, unknown>): Record<string, unknown> | null {
  const list = p.$exception_list
  if (!Array.isArray(list) || !list.length || list.length > MAX_EXCEPTIONS) return null
  const level = LEVELS.includes(p.$exception_level as string) ? p.$exception_level : 'error'
  return {
    $exception_level: level,
    $exception_list: list.map((e: any) => ({
      type: cut(e?.type, 100) || 'Error',
      value: cut(e?.value, 1000) || '',
      mechanism: { type: cut(e?.mechanism?.type, 32) || 'generic', handled: e?.mechanism?.handled !== false },
      stacktrace: {
        type: 'raw',
        frames: (Array.isArray(e?.stacktrace?.frames) ? e.stacktrace.frames : []).slice(-MAX_FRAMES).map((f: any) => ({
          platform: 'node:javascript',
          filename: cut(f?.filename, 300), function: cut(f?.function, 200),
          lineno: int(f?.lineno), colno: int(f?.colno), in_app: f?.in_app !== false,
        })),
      },
    })),
  }
}

/** The user's answers, and what this build can report at all (development builds: neither). */
export type TelemetryState = { usage: boolean; crashes: boolean; asked: boolean; available: { usage: boolean; crashes: boolean } }
