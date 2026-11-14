// What can be done to the film on one of AgentShot's machines, for credits: upscaling, isolating the voice. Shown in
// the export dialog, and only when the worker says there is something on offer. A price is shown before anything is
// sent, and the person says yes to that price before a job starts.
import { useEffect, useState } from 'react'
import { Check, Cloud, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

type State = Awaited<ReturnType<typeof window.agentshot.cloud.offers>>
type Offer = State['offers'][number]
const said = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300)
const credits = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'credit' : 'credits'}`

export function CloudJobs({ dir, open }: { dir: string; open: boolean }) {
  const [st, setSt] = useState<State | null>(null)
  const [asking, setAsking] = useState<Offer | null>(null)
  const [busy, setBusy] = useState(false)
  const [started, setStarted] = useState<{ name: string; credits: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) return
    setAsking(null); setStarted(null); setError(null)
    window.agentshot.cloud.offers(dir).then(setSt).catch(() => setSt(null))
  }, [open, dir])
  if (!st || st.offers.length === 0) return null

  const run = async (o: Offer) => {
    setBusy(true); setError(null)
    try {
      const r = await window.agentshot.cloud.run(dir, o.kind)
      setStarted({ name: o.name, credits: r.credits })
      setAsking(null)
    } catch (e) { setError(said(e)) }
    setBusy(false)
  }

  return (
    <div data-cloud-jobs className="mt-5 border-t border-line pt-4">
      <div className="mb-1 font-medium">Do more to it in the cloud</div>
      <p className="mb-3 text-xs text-dim">Work your computer can’t do well, done on one of AgentShot’s machines and paid with your credits. Only this film is sent. What comes back is a new version for you to accept or reject.</p>
      {started && (
        <div role="status" className="mb-3 flex items-start gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs">
          <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
          <span>{started.name} has started, for {credits(started.credits)}. It carries on if you close this: the jobs tray shows where it has got to.</span>
        </div>
      )}
      {!st.signedIn && <p className="mb-3 text-xs text-dim">Sign in to AgentShot to use these (Settings → Keys).</p>}
      <div className="space-y-1.5">
        {st.offers.map(o => {
          const confirming = asking?.kind === o.kind
          return (
            <div key={o.kind} data-cloud-offer={o.kind} className="rounded-lg border border-line bg-raised/60 px-3 py-2.5">
              <div className="flex items-center gap-3">
                <Cloud className="size-4 shrink-0 text-dim" />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{o.name}</div>
                  <div className="text-xs text-dim">{o.cannot ?? (o.credits != null ? credits(o.credits) : '')}</div>
                </div>
                {!confirming && <Button size="sm" disabled={!st.signedIn || !!o.cannot || o.credits == null || busy || !!started} onClick={() => { setAsking(o); setError(null) }}>Run</Button>}
              </div>
              {confirming && o.credits != null && (
                <div className="mt-2.5 border-t border-line pt-2.5">
                  <p className="text-xs leading-relaxed text-dim">This takes {credits(o.credits)}, once the film has been sent. {o.refund}</p>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => setAsking(null)}>Not now</Button>
                    <Button size="sm" variant="primary" disabled={busy} onClick={() => run(o)}>{busy && <Loader2 className="animate-spin" />}Use {credits(o.credits)}</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-xs text-bad" data-selectable>{error}</p>}
    </div>
  )
}
