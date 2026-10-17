// Settings → Phone: let the Manul phone app reach the agent over this Wi-Fi. Off until turned on; a QR code pairs a
// phone (good for five minutes, one phone each); paired phones can be removed. Development builds only for now.
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { RefreshCw, Smartphone } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PhonePairing, PhoneState } from '../../../shared/types'

const ago = (t?: number) => {
  if (!t) return 'not connected yet'
  const m = Math.round((Date.now() - t) / 60_000)
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString()
}

export function PhonePanel() {
  const [st, setSt] = useState<PhoneState | null>(null)
  const [pairing, setPairing] = useState<(PhonePairing & { qr: string }) | null>(null)
  const [now, setNow] = useState(Date.now())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.manul.phone.state().then(setSt)
    return window.manul.phone.onState(s => {
      // a new phone appeared: that code is spent
      setSt(prev => { if (prev && s.phones.length > prev.phones.length) setPairing(null); return s })
    })
  }, [])
  useEffect(() => { if (!pairing) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [pairing])

  const newCode = async () => {
    setError(null)
    try {
      const p = await window.manul.phone.pair()
      setPairing({ ...p, qr: await QRCode.toDataURL(p.url, { margin: 1, width: 360, errorCorrectionLevel: 'M' }) })
      setNow(Date.now())
    } catch (e) { setError((e as Error).message) }
  }
  const toggle = async () => {
    const next = await window.manul.phone.enable(!st?.enabled)
    setSt(next)
    setPairing(null)
    if (next.enabled && !next.error && !next.phones.length) void newCode()
  }

  if (!st) return null
  const left = pairing ? Math.max(0, Math.ceil((pairing.expires - now) / 1000)) : 0

  return (
    <div>
      <PanelHeader title="Phone" description="Talk to the agent from the Manul phone app. Your phone reaches this Mac over the same Wi-Fi; everything between them is encrypted, and your keys and footage stay here." />
      {st.available && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
            <button role="switch" aria-checked={st.enabled} data-testid="phone-enable" onClick={toggle}
              className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors', st.enabled ? 'bg-amber' : 'bg-line-strong')}>
              <span className={cn('block size-3 rounded-full bg-bg transition-transform', st.enabled && 'translate-x-3')} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="font-medium">Let my phone connect</div>
              <p className="mt-0.5 text-xs leading-relaxed text-dim">
                {st.enabled
                  ? st.connected ? `${st.connected === 1 ? 'A phone is' : `${st.connected} phones are`} connected. This Mac stays awake while one is.` : 'On. Paired phones can connect while Manul is open.'
                  : 'Off. Nothing on the network can reach Manul.'}
              </p>
              {st.error && <p className="mt-1 text-xs text-bad">{st.error}</p>}
            </div>
          </div>

          {st.enabled && !st.error && (
            <div className="rounded-lg border border-line bg-bg/40 p-4">
              {pairing && left > 0 ? (
                <div className="flex items-center gap-5">
                  <img src={pairing.qr} alt="Pairing code" data-testid="phone-qr" className="size-44 rounded-md bg-white p-1.5" />
                  <div className="min-w-0 space-y-2 text-[13px]">
                    <p>Open the Manul app on your phone and scan this code.</p>
                    <p className="text-xs text-dim">It works once, for {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} more. Your phone needs to be on the same Wi-Fi as {pairing.name}.</p>
                    <Button size="sm" variant="ghost" onClick={newCode}><RefreshCw />New code</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-dim">{pairing ? 'That code expired.' : 'Pair a phone with a QR code.'}</p>
                  <Button size="sm" variant="primary" data-testid="phone-pair" onClick={newCode}><Smartphone />Pair a phone</Button>
                </div>
              )}
              {error && <p className="mt-2 text-xs text-bad">{error}</p>}
            </div>
          )}

          {st.phones.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-faint">Paired phones</div>
              <div className="space-y-1.5">
                {st.phones.map(p => (
                  <div key={p.id} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
                    <Smartphone className="size-4 text-dim" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{p.name}</div>
                      <div className="text-xs text-dim">Last seen {ago(p.lastSeen)}</div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={async () => setSt(await window.manul.phone.forget(p.id))}>Remove</Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
