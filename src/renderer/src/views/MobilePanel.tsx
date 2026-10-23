import { useEffect, useState } from 'react'
import type { MobileStatus } from '../../../main/mobile-bridge'

export function MobilePanel() {
  const [state, setState] = useState<MobileStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState('')
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
    <p className="text-sm text-dim">Direct Manul from Android or iPhone. Your computer edits and renders; your phone sends footage, gives notes and reviews the film. Keep both devices on the same network.</p>
    <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.start)}>{state?.running ? 'New pairing code' : 'Enable mobile connection'}</button>
    {state?.running && <>
      <p className="text-sm text-dim">Paste a connection code below into the mobile app. Codes expire after five minutes and pair one device. Choose the address reachable from your phone.</p>
      {state.code && state.expiresAt! > Date.now() && state.addresses.map(url => {
        const payload = JSON.stringify({ url, fingerprint: state.fingerprint, code: state.code })
        return <div key={url} className="space-y-2 rounded-card border border-line p-3">
          <div className="text-sm">{url}</div>
          <textarea aria-label={`Connection code for ${url}`} readOnly value={payload} rows={4} className="w-full resize-none break-all rounded border border-line bg-surface p-2 font-mono text-xs" />
          <button className={button} onClick={() => navigator.clipboard.writeText(payload).then(() => setCopied(url)).catch(e => setError(String(e)))}>{copied === url ? 'Copied' : 'Copy connection code'}</button>
        </div>
      })}
      {!state.addresses.length && <p>Connect this computer to a network first.</p>}
      {state.devices.map(d => <div key={d.id} className="flex items-center justify-between gap-3"><span>{d.name}</span><button className={button} onClick={() => run(() => window.manul.mobile.revoke(d.id))}>Disconnect</button></div>)}
      <button className={button} disabled={busy} onClick={() => run(window.manul.mobile.stop)}>Disable mobile connection</button>
      <p className="text-xs text-dim">Connections are encrypted and pinned to this computer’s certificate. Disabling the bridge or quitting Manul revokes all devices.</p>
    </>}
    {error && <p role="alert" className="text-sm text-bad">{error}</p>}
  </div>
}
