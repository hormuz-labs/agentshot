import { useEffect, useState } from 'react'
import type { MobileStatus } from '../../../main/mobile-bridge'

export function MobilePanel() {
  const [state, setState] = useState<MobileStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const refresh = () => window.manul.mobile.status().then(setState).catch(e => setError(String(e)))
    void refresh(); const timer = setInterval(refresh, 2000)
    return () => clearInterval(timer)
  }, [])
  const run = async (action: () => Promise<MobileStatus>) => {
    setBusy(true); setError('')
    try { setState(await action()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }
  const button = 'rounded-md border border-line px-3 py-2 text-sm hover:bg-hover disabled:opacity-50'
  return <div className="space-y-5">
    <h2 className="font-serif text-xl">Connect your phone</h2>
    <p className="text-sm text-dim">Your computer edits and renders; your phone sends footage, gives notes and reviews the film. Connect from anywhere over Wi-Fi or mobile data.</p>
    <div className="space-y-3 rounded-card border border-line p-4">
      <h3 className="font-medium">Your Manul account</h3>
      <p className="text-sm text-dim">Sign in to the same account on your phone. This computer appears automatically—no connection codes or network setup.</p>
      {state?.email && <p className="text-sm">{state.email}</p>}
      {state?.relay && <p role="status" className="text-sm">{state.relay}</p>}
      <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.signIn)}>{state?.email ? 'Sign in again' : 'Sign in to Manul'}</button>
        {state?.email && !state.running && <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.start)}>Enable connection</button>}
        {state?.email && <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.signOut)}>Sign out</button>}
      </div>
      <p className="text-xs text-dim">Keep this computer awake and Manul running. Traffic is encrypted between your phone and this computer through the Manul relay.</p>
    </div>
    {state?.running && <>
      {state.devices.map(d => <div key={d.id} className="flex flex-wrap items-center justify-between gap-3"><span>{d.name}</span><button className={button} disabled={busy} onClick={() => run(() => window.manul.mobile.revoke(d.id))}>Disconnect</button></div>)}
      <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.stop)}>Disable mobile connection</button>
    </>}
    {error && <p role="alert" className="text-sm text-bad">{error}</p>}
  </div>
}
