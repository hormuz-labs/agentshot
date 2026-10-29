import { useEffect, useState } from 'react'
import { Check, ChevronRight, Cloud, Copy, RefreshCw, Server, Smartphone } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { MobileState } from '../../../main/mobile-bridge'
import type { WorkerClientStatus } from '../../../main/worker-client'
import type { DiscoveredWorker } from '../../../main/account'
import type { CloudWorkerStatus } from '../../../preload'
import { CodeSignIn, CopySignInLink } from '@/components/CodeSignIn'

const field = 'h-8 rounded-lg border border-line bg-bg px-2.5 text-xs outline-none placeholder:text-faint focus:border-amber/60'
const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function MobilePanel() {
  const [state, setState] = useState<MobileState>()
  const [other, setOther] = useState(false)
  const [error, setError] = useState('')
  const [workerError, setWorkerError] = useState('')
  const [busy, setBusy] = useState(false)
  const [workerBusy, setWorkerBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  const [worker, setWorker] = useState<WorkerClientStatus>()
  const [discovered, setDiscovered] = useState<{ workers: DiscoveredWorker[]; poolAvailable: number }>()
  const [cloud, setCloud] = useState<CloudWorkerStatus>()
  const [cloudKey, setCloudKey] = useState('')
  const [pairUrl, setPairUrl] = useState('')
  const [pairCode, setPairCode] = useState('')
  const [qr, setQr] = useState<{ link: string; svg: string; mesh: boolean } | null>(null)
  useEffect(() => {
    const refresh = () => {
      window.agentshot.mobile.status().then(s => { setState(s); setNow(Date.now()) }).catch(e => setError(message(e)))
      window.agentshot.worker?.status().then(w => setWorker(w)).catch(() => {})
      window.agentshot.cloudWorker?.status().then(c => setCloud(c)).catch(() => {})
    }
    void refresh()
    const timer = setInterval(refresh, 1000)
    return () => clearInterval(timer)
  }, [])

  const run = async (action: () => Promise<MobileState>) => {
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
    window.agentshot.mobile.qr().then(q => { if (live) setQr(q) }).catch(() => {})
    return () => { live = false }
  }, [code, state?.mesh])

  if (!state) return null
  const { account } = state
  const signIn = () => run(async () => { await window.agentshot.account.signIn(); return window.agentshot.mobile.status() })
  const toggle = (on: boolean, onClick: () => void, label: string) => (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={busy}
      onClick={onClick}
      className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors disabled:opacity-50', on ? 'bg-amber' : 'bg-line-strong')}
    >
      <span className={cn('block size-3 rounded-full bg-bg transition-transform', on && 'translate-x-3')} />
    </button>
  )

  return (
    <div>
      <PanelHeader
        title="Mobile"
        description="Use AgentShot from your Android phone or iPhone. This computer does the editing; your phone sends footage, gives notes and reviews the film, at home or away."
      />
      <div className="space-y-4">
        {account.signedIn ? (
          <div className="rounded-lg border border-line bg-raised/60 px-3 py-2.5" data-testid="mobile-account">
            <div className="flex items-start gap-3">
              {toggle(account.phones, () => run(() => window.agentshot.mobile.setAccountPhones(!account.phones)), 'Let my phones connect')}
              <div className="min-w-0 flex-1">
                <div className="font-medium">Let my phones connect</div>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">
                  {account.phones
                    ? <>Open the AgentShot app on your phone and choose <span className="font-medium text-fg">Continue with Google</span>{account.email ? <> as {account.email}</> : ''}. It finds this computer by itself, at home or away.</>
                    : 'Off. Your phones can’t reach this computer.'}
                </p>
              </div>
            </div>
            {account.phones && state.signedIn.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-line pt-2.5">
                {state.signedIn.map(d => (
                  <div key={`${d.name}-${d.lastSeen}`} className="flex items-center gap-2 text-xs">
                    <Smartphone className="size-3.5 text-dim" />
                    <span className="font-medium">{d.name}</span>
                    <span className="text-faint">connected</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5" data-testid="mobile-sign-in">
            <Smartphone className="mt-0.5 size-4 shrink-0 text-dim" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">Connect your phone with Google</div>
              <p className="mt-0.5 text-xs leading-relaxed text-dim">
                Sign in here, then choose Continue with Google in the AgentShot app on your phone. It finds this computer by itself, at home or away.
              </p>
            </div>
            <Button size="sm" variant="primary" disabled={busy} onClick={signIn}>Sign in</Button>
          </div>
        )}
        {!account.email && busy && <CopySignInLink />}
        {!account.email && (
          <CodeSignIn onSignedIn={async () => setState(await window.agentshot.mobile.status())} />
        )}

        <div>
          <button
            className="flex items-center gap-1 text-xs text-dim hover:text-fg"
            aria-expanded={other || state.devices.length > 0}
            onClick={() => setOther(!other)}
            data-testid="mobile-other"
          >
            <ChevronRight className={cn('size-3.5 transition-transform', (other || state.devices.length > 0) && 'rotate-90')} />
            Connect without an account
          </button>
          {(other || state.devices.length > 0) && (
            <div className="mt-2 space-y-3 rounded-lg border border-line bg-bg/40 p-4">
              {!state.running || !code ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs text-dim">Pair a phone on the same Wi-Fi with a code, no sign-in needed.</p>
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => run(window.agentshot.mobile.start)} data-testid="mobile-enable">
                    <Smartphone />Show a pairing code
                  </Button>
                </div>
              ) : !state.addresses.length ? (
                <p className="text-xs text-dim">Connect this computer to the internet first.</p>
              ) : (
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
                        Use the phone’s camera or the AgentShot app. {qr?.mesh ? 'Works at home and away.' : 'Works on this Wi-Fi.'}{' '}
                        Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}.
                      </p>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-faint">Or type this code in the app</div>
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
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(window.agentshot.mobile.start)}>
                        <RefreshCw />New code
                      </Button>
                      {state.running && !(account.signedIn && account.phones) && (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(window.agentshot.mobile.stop)}>
                          Turn off
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {state.devices.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">Paired with a code</div>
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
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-xs text-bad">{error}</p>}

        <div className="border-t border-line pt-4" data-testid="worker-section">
          <div className="mb-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-medium">Cloud &amp; home workers</div>
              <p className="mt-0.5 text-xs leading-relaxed text-dim">
                Hand rendering and agent edits to a cloud worker, or to another of your computers running AgentShot with <span className="font-mono">--worker</span>.
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
            {discovered && (
              <p className="px-1 text-xs text-dim" data-testid="pool-available">
                {!discovered.workers.length && 'No other computers of yours are working right now. '}
                {discovered.poolAvailable > 0
                  ? `${discovered.poolAvailable} cloud ${discovered.poolAvailable === 1 ? 'worker is' : 'workers are'} free: Use cloud worker takes one.`
                  : 'No cloud workers are free right now.'}
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
                placeholder="Worker address"
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

          {cloud && (
            <div className="mt-4 rounded-lg border border-line bg-raised/60 p-3" data-testid="share-cloud-worker">
              <div className="flex items-start gap-3">
                {toggle(cloud.share, () => runWorker(async () => setCloud(await window.agentshot.cloudWorker.set({ share: !cloud.share }))), 'Share this computer as a cloud worker')}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">Share this computer as a cloud worker</div>
                  <p className="mt-0.5 text-xs leading-relaxed text-dim">
                    Runs a separate AgentShot worker in the background, with its own projects folder. Whoever leases it from AgentShot works only with what they make there: none of your projects, keys or sign-in.
                  </p>
                  {cloud.share && cloud.keySet && (
                    <p className="mt-1.5 text-xs text-dim">{cloud.running ? `Running as ${cloud.name}.` : 'Starting…'}</p>
                  )}
                  {cloud.error && <p role="alert" className="mt-1.5 text-xs text-bad">{cloud.error}</p>}
                </div>
              </div>
              {cloud.share && !cloud.keySet && (
                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={e => {
                    e.preventDefault()
                    runWorker(async () => { setCloud(await window.agentshot.cloudWorker.set({ share: true, secret: cloudKey })); setCloudKey('') })
                  }}
                >
                  <input
                    type="password"
                    aria-label="Cloud worker key"
                    placeholder="Cloud worker key (from your AgentShot account service)"
                    autoComplete="off"
                    value={cloudKey}
                    onChange={e => setCloudKey(e.target.value)}
                    className={cn(field, 'min-w-0 flex-1 font-mono')}
                  />
                  <Button size="sm" variant="primary" type="submit" disabled={workerBusy || cloudKey.trim().length < 16}>
                    Save
                  </Button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
