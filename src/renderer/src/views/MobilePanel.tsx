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
  const [qr, setQr] = useState<{ link: string; svg: string; mesh: boolean } | null>(null)
  useEffect(() => {
    const refresh = () => {
      window.manul.mobile.status().then(s => { setState(s); setNow(Date.now()) }).catch(e => setError(message(e)))
      window.manul.worker?.status().then(w => setWorker(w)).catch(() => {})
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

  const left = state?.code && state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - now) / 1000)) : 0
  const code = state?.code && left > 0 ? state.code : ''
  useEffect(() => {
    if (!code) { setQr(null); return }
    let live = true
    window.manul.mobile.qr().then(q => { if (live) setQr(q) }).catch(() => {})
    return () => { live = false }
  }, [code, state?.mesh])

  if (!state) return null

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
                  : 'On. Scan the code below with your phone to pair.'
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
              <div className="flex items-start gap-4">
                <div
                  className="size-36 shrink-0 rounded-lg bg-white p-2.5 [&>svg]:size-full"
                  data-testid="mobile-qr"
                  role="img"
                  aria-label="Pairing QR code"
                  // trusted: an SVG the qrcode package rendered in the main process from our own link
                  dangerouslySetInnerHTML={qr ? { __html: qr.svg } : undefined}
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div>
                    <div className="font-medium">Scan with your phone</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-dim">
                      Use the phone’s camera or the AgentShot app.{' '}
                      {qr?.mesh
                        ? 'Works from anywhere: your phone joins your private AgentShot mesh.'
                        : state.mesh
                          ? 'Works on this Wi-Fi and Tailscale. Sign in to AgentShot to pair from anywhere.'
                          : 'Works on this Wi-Fi and Tailscale.'}{' '}
                      Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
                    </p>
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-faint">Or enter this code on the same Wi-Fi</div>
                    <div className="flex items-center gap-1" data-testid="mobile-otp">
                      {code.split('').map((digit, idx) => (
                        <div
                          key={idx}
                          className={cn(
                            'flex h-8 w-7 items-center justify-center rounded-md border border-line bg-surface font-mono text-base font-semibold text-fg',
                            idx === 3 && 'ml-1.5',
                          )}
                        >
                          {digit}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!qr}
                      onClick={() => qr && navigator.clipboard.writeText(qr.link).then(() => setCopied(true)).catch(e => setError(message(e)))}
                    >
                      {copied ? <><Check />Copied</> : <><Copy />Copy pairing link</>}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(window.manul.mobile.start)}>
                      <RefreshCw />New code
                    </Button>
                  </div>
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

        {state.devices.length > 0 && (
          <div>
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">Paired devices</div>
            <div className="space-y-1.5">
              {state.devices.map(d => (
                <div key={d.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
                  <Smartphone className="size-4 shrink-0 text-dim" />
                  <div className="min-w-0 flex-1 truncate font-medium">{d.name}</div>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => window.manul.mobile.revoke(d.id))}>
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
              onClick={() => runWorker(async () => setDiscovered(await window.manul.worker.discover()))}
            >
              <RefreshCw />Find workers
            </Button>
            <Button
              size="sm"
              variant="primary"
              disabled={workerBusy || !!worker?.active}
              onClick={() => runWorker(async () => setWorker(await window.manul.worker.lease()))}
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
                    runWorker(async () => setWorker(await (act.pool ? window.manul.worker.release(act.id) : window.manul.worker.disconnect())))
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
                <Button size="sm" variant="primary" disabled={workerBusy} onClick={() => runWorker(async () => setWorker(await window.manul.worker.connect(w)))}>
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
                runWorker(async () => { setWorker(await window.manul.worker.pair({ url: pairUrl.trim(), code: pairCode })); setPairCode('') })
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
