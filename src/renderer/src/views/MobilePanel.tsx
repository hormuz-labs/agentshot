import { useEffect, useState } from 'react'
import { Check, Copy, RefreshCw, Smartphone } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MobileStatus } from '../../../main/mobile-bridge'

export function MobilePanel() {
  const [state, setState] = useState<MobileStatus>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const refresh = () => window.manul.mobile.status().then(s => { setState(s); setNow(Date.now()) }).catch(e => setError(String(e)))
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [])

  const run = async (action: () => Promise<MobileStatus>) => {
    setBusy(true); setError(''); setCopied(false)
    try { setState(await action()); setNow(Date.now()) } catch (e) { setError(String(e)) } finally { setBusy(false) }
  }

  if (!state) return null
  const left = state.code && state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) : 0
  const code = state.code && left > 0 ? state.code : ''

  return (
    <div>
      <PanelHeader
        title="Mobile"
        description="Direct Manul from Android or iPhone. Your computer edits and renders; your phone sends footage, gives notes and reviews the film over the same Wi-Fi or Tailscale."
      />
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
          <button
            role="switch"
            aria-checked={state.running}
            disabled={busy}
            data-testid="mobile-enable"
            onClick={() => run(state.running ? window.manul.mobile.stop : window.manul.mobile.start)}
            className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-50', state.running ? 'bg-amber' : 'bg-line-strong')}
          >
            <span className={cn('block size-3 rounded-full bg-bg transition-transform', state.running && 'translate-x-3')} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Let my phone connect</div>
            <p className="mt-0.5 text-xs leading-relaxed text-dim">
              {state.running
                ? state.devices.length
                  ? `${state.devices.length === 1 ? '1 device' : `${state.devices.length} devices`} paired. Connections are encrypted and pinned to this computer’s certificate.`
                  : 'On. Enter the 6-digit code below in the Manul mobile app to pair.'
                : 'Off. Nothing on the network can reach Manul.'}
            </p>
          </div>
        </div>

        {state.running && (
          <div className="rounded-lg border border-line bg-bg/40 p-4">
            {!state.addresses.length ? (
              <p className="text-xs text-dim">Connect this computer to Wi-Fi or Tailscale first.</p>
            ) : code ? (
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium">Verification code</div>
                    <p className="mt-0.5 text-xs text-dim">
                      Enter this 6-digit code in the mobile app. Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(e => setError(String(e)))}
                    >
                      {copied ? <><Check />Copied</> : <><Copy />Copy code</>}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(window.manul.mobile.start)}>
                      <RefreshCw />New code
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1" data-testid="mobile-otp">
                  {code.split('').map((digit, idx) => (
                    <div
                      key={idx}
                      className={cn(
                        'flex h-12 w-10 items-center justify-center rounded-lg border border-line bg-surface font-mono text-xl font-semibold tracking-wider text-fg shadow-xs',
                        idx === 3 && 'ml-2',
                      )}
                    >
                      {digit}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-dim">{state.devices.length ? 'Pair another phone or tablet with a new 6-digit code.' : 'That code expired.'}</p>
                <Button size="sm" variant="primary" disabled={busy} onClick={() => run(window.manul.mobile.start)}>
                  <Smartphone />New code
                </Button>
              </div>
            )}
          </div>
        )}

        {state.running && (
          <div className="rounded-lg border border-line bg-raised/60 px-3 py-2.5" data-testid="mobile-tailscale">
            <div className="flex items-center gap-2 font-medium">
              <span className={cn('size-1.5 rounded-full', state.tailscale ? 'bg-ok' : 'bg-line-strong')} />
              Away from home
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-dim">
              {state.tailscale ? (
                <>This computer is on Tailscale (<span className="font-mono">{state.tailscale}</span>). A paired phone with Tailscale on reaches it from anywhere, encrypted end to end.</>
              ) : (
                <>Put this computer and your phone on the same <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-amber hover:underline">Tailscale</a> network and a paired phone reaches it from anywhere—nothing else to set up.</>
              )}
            </p>
          </div>
        )}

        {state.running && state.devices.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">Paired devices</div>
            <div className="space-y-1.5">
              {state.devices.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
                  <Smartphone className="size-4 text-dim" />
                  <div className="min-w-0 flex-1 truncate font-medium">{d.name}</div>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => window.manul.mobile.revoke(d.id))}>
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-bad">{error}</p>}
      </div>
    </div>
  )
}
