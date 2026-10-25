import { useEffect, useState } from 'react'
import { Check, Cloud, Copy, RefreshCw, Server, Smartphone } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MobileStatus } from '../../../main/mobile-bridge'
import type { WorkerClientStatus } from '../../../main/worker-client'
import type { DiscoveredWorker } from '../../../main/account'

const field = 'h-8 rounded-lg border border-line bg-bg px-2.5 text-xs outline-none placeholder:text-faint focus:border-amber/60'
const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function MobilePanel() {
  const [state, setState] = useState<MobileStatus>()
  const [error, setError] = useState('')
  const [workerError, setWorkerError] = useState('')
  const [busy, setBusy] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  const [worker, setWorker] = useState<WorkerClientStatus>()
  const [discovered, setDiscovered] = useState<{ workers: DiscoveredWorker[]; poolAvailable: number }>()
  const [pairUrl, setPairUrl] = useState('')
  const [pairCode, setPairCode] = useState('')
  useEffect(() => {
    const refresh = () => {
      window.agentshot.mobile.status().then(s => { setState(s); setNow(Date.now()) }).catch(e => setError(message(e)))
      window.agentshot.worker?.status().then(w => setWorker(w)).catch(() => {})
    }
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [])

  const run = async (action: () => Promise<MobileStatus>) => {
    setBusy(true); setError(''); setCopied(false)
    try { setState(await action()); setNow(Date.now()) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const runWorker = async (action: () => Promise<void>) => {
    setWorkerBusy(true); setWorkerError('')
    try { await action() } catch (e) { setWorkerError(message(e)) } finally { setWorkerBusy(false) }
  }

  if (!state) return null
  const left = state.code && state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) : 0
  const code = state.code && left > 0 ? state.code : ''

  return (
    <div>
      <PanelHeader
        title="Mobile"
        description="Direct AgentShot from Android or iPhone. Your computer edits and renders; your phone sends footage, gives notes and reviews the film over the same Wi-Fi, Tailscale or your AgentShot mesh."
      />
      <div className="space-y-4">
        <div className="flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
          <button
            role="switch"
            aria-checked={state.running}
            disabled={busy}
            data-testid="mobile-enable"
            onClick={() => run(state.running ? window.agentshot.mobile.stop : window.agentshot.mobile.start)}
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
                  : 'On. Enter the 6-digit code below in the AgentShot mobile app to pair.'
                : state.devices.length
                  ? 'Off. Nothing on the network can reach AgentShot; paired devices reconnect when you turn this back on.'
                  : 'Off. Nothing on the network can reach AgentShot.'}
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
                      onClick={() => navigator.clipboard.writeText(code).then(() => setCopied(true)).catch(e => setError(message(e)))}
                    >
                      {copied ? <><Check />Copied</> : <><Copy />Copy code</>}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(window.agentshot.mobile.start)}>
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
                <Button size="sm" variant="primary" disabled={busy} onClick={() => run(window.agentshot.mobile.start)}>
                  <Smartphone />New code
                </Button>
              </div>
            )}
          </div>
        )}

        {state.running && (
          <div className="rounded-lg border border-line bg-raised/60 px-3 py-2.5" data-testid="mobile-tailscale">
            <div className="flex items-center gap-2 font-medium">
              <span className={cn('size-1.5 rounded-full', state.tailscale || state.mesh ? 'bg-ok' : 'bg-line-strong')} />
              Away from home
            </div>
            <p className="mt-0.5 text-xs leading-relaxed text-dim">
              {state.tailscale ? (
                <>This computer is on Tailscale (<span className="font-mono">{state.tailscale}</span>). A paired phone with Tailscale on reaches it from anywhere, encrypted end to end.</>
              ) : (
                <>Put this computer and your phone on the same <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-amber hover:underline">Tailscale</a> network and a paired phone reaches it from anywhere—nothing else to set up.</>
              )}
            </p>
            {state.mesh && (
              <p className="mt-1.5 text-xs leading-relaxed text-dim" data-testid="mobile-mesh">
                Also on your AgentShot mesh as <span className="font-mono text-fg">{state.mesh}</span>. A phone on the same Headscale network can pair by entering this address in the app.
              </p>
            )}
          </div>
        )}

        {state.devices.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">Paired devices</div>
            <div className="space-y-1.5">
              {state.devices.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
                  <Smartphone className="size-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1 truncate font-medium">{d.name}</div>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => window.agentshot.mobile.revoke(d.id))}>
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {error && <p role="alert" className="text-xs text-bad">{error}</p>}

        <div className="border-t border-line pt-4" data-testid="worker-section">
          <div className="mb-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Cloud &amp; home workers</div>
              <p className="mt-0.5 text-xs leading-relaxed text-dim">
                Offload rendering and agent edits to a cloud worker, or to another computer running AgentShot with <span className="font-mono">--worker</span>, over your mesh.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              disabled={workerBusy}
              onClick={() => runWorker(async () => setDiscovered(await window.agentshot.worker.discover()))}
            >
              <RefreshCw />Find workers
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={workerBusy || !!worker?.active}
              onClick={() => runWorker(async () => setWorker(await window.agentshot.worker.lease()))}
            >
              <Cloud />Use cloud worker
            </Button>
          </div>

          <div className="space-y-1.5">
            {worker?.active && (
              <div className="flex items-center gap-3 rounded-lg border border-amber/40 bg-amber/10 px-3 py-2" data-testid="active-worker">
                <Server className="size-4 shrink-0 text-amber" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">Connected to {worker.active.name}</div>
                  <div className="truncate font-mono text-xs text-dim">{worker.active.activeUrl}</div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={workerBusy}
                  onClick={() => {
                    const act = worker.active!
                    runWorker(async () => setWorker(await (act.pool ? window.agentshot.worker.release(act.id) : window.agentshot.worker.disconnect())))
                  }}
                >
                  Disconnect
                </Button>
              </div>
            )}

            {discovered && discovered.workers.filter(w => w.id !== worker?.active?.id).map(w => (
              <div key={w.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
                <Server className="size-4 shrink-0 text-dim" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate font-medium">
                    {w.name}
                    <span className="rounded border border-line px-1 text-[10px] font-normal uppercase tracking-wider text-faint">{w.pool ? 'Pool' : 'Personal'}</span>
                  </div>
                  <div className="truncate font-mono text-xs text-dim">{w.urls[0]}</div>
                </div>
                <Button size="sm" variant="primary" disabled={workerBusy} onClick={() => runWorker(async () => setWorker(await window.agentshot.worker.connect(w)))}>
                  Connect
                </Button>
              </div>
            ))}
            {discovered && !discovered.workers.length && (
              <p className="px-1 text-xs text-dim">
                No personal workers found.{discovered.poolAvailable > 0 ? ` ${discovered.poolAvailable} cloud ${discovered.poolAvailable === 1 ? 'worker is' : 'workers are'} free—use Use cloud worker.` : ''}
              </p>
            )}

            <form
              className="flex items-center gap-2 pt-1"
              onSubmit={e => {
                e.preventDefault()
                runWorker(async () => { setWorker(await window.agentshot.worker.pair({ url: pairUrl.trim(), code: pairCode })); setPairCode('') })
              }}
            >
              <input
                type="text"
                aria-label="Worker address"
                placeholder="Worker address, e.g. 100.64.0.2"
                autoCorrect="off"
                spellCheck={false}
                value={pairUrl}
                onChange={e => setPairUrl(e.target.value)}
                className={cn(field, 'min-w-0 flex-1 font-mono')}
              />
              <input
                type="text"
                inputMode="numeric"
                aria-label="Worker pairing code"
                placeholder="6-digit code"
                maxLength={6}
                value={pairCode}
                onChange={e => setPairCode(e.target.value.replace(/\D/g, ''))}
                className={cn(field, 'w-28 font-mono tracking-widest')}
              />
              <Button size="sm" variant="ghost" type="submit" disabled={workerBusy || !pairUrl.trim() || pairCode.length !== 6}>
                Pair worker
              </Button>
            </form>
          </div>
          {workerError && <p role="alert" className="mt-2 text-xs text-bad">{workerError}</p>}
        </div>
      </div>
    </div>
  )
}
