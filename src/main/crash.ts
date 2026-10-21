// Crash reports, only when the user said yes. Imported first by index.ts: the crash SDK must start before the app is
// ready to catch native crashes and to register its protocol for the renderer. Sentry's SDK only catches and scrubs:
// its transport below sends each report as a PostHog error tracking event ($exception), through Manul's proxy like
// usage statistics, and never to Sentry. It starts whenever the build has telemetry, but sends nothing unless the user
// agreed, so saying yes or no takes effect at once, and crashes from before a yes are never sent later. Local variables,
// console output, URLs and file paths are kept out of reports; minidumps never leave the machine.
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import * as Sentry from '@sentry/electron/main'
import { exceptionProperties, keepCrumb, scrubCrumb, scrubEvent, type ExceptionEvent } from '../shared/telemetry'
import { getConfig } from './config'

declare const __MANUL_TELEMETRY_URL__: string
declare const __MANUL_POSTHOG_TOKEN__: string
const ENDPOINT = typeof __MANUL_TELEMETRY_URL__ === 'string' ? __MANUL_TELEMETRY_URL__ : ''
const TOKEN = typeof __MANUL_POSTHOG_TOKEN__ === 'string' ? __MANUL_POSTHOG_TOKEN__ : ''

/** Whether this build can send crash reports at all (release builds). */
export const CRASHES_AVAILABLE = !!(ENDPOINT && TOKEN)
export const crashReportsOn = () => CRASHES_AVAILABLE && !!getConfig().telemetry?.crashes

// Integrations that could carry the user's data: local variable values, console lines, request URLs (some providers
// put keys in the query), and window screenshots.
const DROPPED = new Set(['LocalVariables', 'Console', 'NodeFetch', 'ElectronNet', 'Screenshots', 'Http'])
/** The SDK only runs with a DSN; this one is never contacted (the transport doesn't use it). */
const LOCAL_DSN = 'https://manul@crash.invalid/1'
/** Reports from one run share an id, so PostHog can group them; it means nothing outside that run. */
const RUN = randomUUID()

type Envelope = [unknown, [{ type?: string }, unknown][]]

/** The events in a Sentry envelope, as the batch the proxy takes. Sessions, attachments (minidumps) and the rest stay. */
export function crashBatch(envelope: Envelope, context: Record<string, string> = {}) {
  return envelope[1]
    .filter(([header]) => header.type === 'event')
    .map(([, payload]) => (typeof payload === 'string' ? JSON.parse(payload) : payload) as ExceptionEvent & { event_id?: string; timestamp?: number })
    .map(event => ({
      uuid: randomUUID(), event: '$exception',
      timestamp: new Date(typeof event.timestamp === 'number' ? event.timestamp * 1000 : Date.now()).toISOString(),
      properties: { ...context, ...exceptionProperties(event), distinct_id: RUN, $process_person_profile: false, $geoip_disable: true },
    }))
}

if (CRASHES_AVAILABLE) {
  Sentry.init({
    dsn: LOCAL_DSN,
    dataCollection: { userInfo: false },
    integrations: defaults => defaults.filter(i => !DROPPED.has(i.name)),
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: b => (keepCrumb(b) ? scrubCrumb(b) : null),
    // Without the user's yes nothing leaves the machine. A report that can't be sent (offline) is dropped, not queued.
    transport: () => ({
      send: async envelope => {
        if (!crashReportsOn()) return {}
        const batch = crashBatch(envelope as unknown as Envelope, { app_version: app.getVersion(), os: process.platform, arch: process.arch })
        if (!batch.length) return {}
        const res = await fetch(`${ENDPOINT.replace(/\/$/, '')}/batch/`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(10_000),
          body: JSON.stringify({ api_key: TOKEN, batch }),
        }).catch(() => null)
        return { statusCode: res?.status }
      },
      flush: async () => true,
    }),
  })
}
