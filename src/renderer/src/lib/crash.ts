// Renderer errors for crash reports. Events go to the main process, whose transport sends them only with the
// user's yes (src/main/crash.ts); the same scrubbing runs here first.
import * as Sentry from '@sentry/electron/renderer'
import { keepCrumb, scrubCrumb, scrubEvent } from '../../../shared/telemetry'

export async function startCrashReports() {
  const st = await window.manul.telemetry.state().catch(() => null)
  if (!st?.available.crashes) return
  Sentry.init({
    dataCollection: { userInfo: false },
    integrations: defaults => defaults.filter(i => !['Breadcrumbs', 'BrowserSession'].includes(i.name)),
    beforeSend: event => scrubEvent(event),
    beforeBreadcrumb: b => (keepCrumb(b) ? scrubCrumb(b) : null),
  })
}
