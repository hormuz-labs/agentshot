import { useEffect, useState } from 'react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { TelemetryChoices } from '@/views/AboutPanel'

type St = Awaited<ReturnType<typeof window.manul.telemetry.state>>

/** Asked once, on first run, in builds that can report. Both boxes start unticked; closing the dialog is a no. */
export function TelemetryConsent({ onSettled }: { onSettled?(settled: boolean): void }) {
  const [st, setSt] = useState<St | null>(null)
  const [usage, setUsage] = useState(false)
  const [crashes, setCrashes] = useState(false)
  useEffect(() => { window.manul.telemetry.state().then(setSt) }, [])
  useEffect(() => { onSettled?.(!!st && (st.asked || (!st.available.usage && !st.available.crashes))) }, [st, onSettled])
  if (!st || st.asked || (!st.available.usage && !st.available.crashes)) return null
  const answer = (c: { usage: boolean; crashes: boolean }) => window.manul.telemetry.set(c).then(setSt)
  return (
    <Dialog open onOpenChange={o => { if (!o) answer({ usage: false, crashes: false }) }} title="Help improve Manul?"
      description="Both are off unless you tick them. You can change your mind anytime in Settings → About.">
      <TelemetryChoices available={st.available} usage={usage} crashes={crashes} onUsage={setUsage} onCrashes={setCrashes} />
      <div className="mt-4 flex justify-end gap-2">
        <Button size="sm" variant="primary" onClick={() => answer({ usage, crashes })}>Continue</Button>
      </div>
    </Dialog>
  )
}
