import { useEffect, useState } from 'react'
import { FileText, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

type St = Awaited<ReturnType<typeof window.manul.updates.state>>
type Tel = Awaited<ReturnType<typeof window.manul.telemetry.state>>

const README = 'https://github.com/hormuz-labs/manul/blob/main/telemetry/README.md'

/** The two opt-ins, shown on first run and in About. */
export function TelemetryChoices({ available, usage, crashes, onUsage, onCrashes }: {
  available: Tel['available']; usage: boolean; crashes: boolean; onUsage(v: boolean): void; onCrashes(v: boolean): void
}) {
  return (
    <div className="space-y-3 text-xs">
      {available.crashes && <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={crashes} onChange={e => onCrashes(e.target.checked)} />
        <span><span className="font-medium text-fg">Send crash reports</span>
          <span className="block text-dim">When Manul crashes or hits an error: what failed, where in Manul's code, and your OS and app version. File names and paths are removed.</span></span>
      </label>}
      {available.usage && <label className="flex items-start gap-2">
        <input type="checkbox" className="mt-0.5" checked={usage} onChange={e => onUsage(e.target.checked)} />
        <span><span className="font-medium text-fg">Share usage statistics</span>
          <span className="block text-dim">Which features you use and for how long: exports, agent runs and the tools they call, kept or rejected versions. Tied to a random ID, not to you.</span></span>
      </label>}
      <p className="text-faint">Never your footage, file or project names, prompts, transcripts or keys. <a className="underline hover:text-fg" href={README} target="_blank" rel="noreferrer">Exactly what is sent</a></p>
    </div>
  )
}

export function AboutPanel() {
  const [info, setInfo] = useState<{ version: string; platform: string } | null>(null)
  const [st, setSt] = useState<St>()
  const [tel, setTel] = useState<Tel | null>(null)
  useEffect(() => { window.manul.info().then(setInfo); window.manul.updates.state().then(setSt); window.manul.telemetry.state().then(setTel); return window.manul.updates.onChange(setSt) }, [])
  const line = !st ? '' : st.mode === 'off' ? `Updates are off (${st.why}).` : st.mode === 'package-manager' ? `Updates come from your package manager (${st.why?.replace(/^installed with apt: /, '')}).`
    : st.status === 'checking' ? 'Checking for updates…' : st.status === 'downloading' ? `Downloading ${st.version ?? 'an update'}… ${Math.round((st.progress || 0) * 100)}%`
    : st.status === 'ready' ? `Manul ${st.version} is ready.` : st.status === 'none' ? 'Manul is up to date.' : st.status === 'error' ? `Couldn't check: ${st.error}` : 'Manul checks for updates in the background.'
  return (
    <div>
      <div className="mb-6 flex items-center gap-4">
        <img src="./manul.png" className="size-20 object-contain" alt="" />
        <div>
          <div className="text-[18px] font-semibold">Manul</div>
          <div className="text-dim">Version {info?.version} · {info?.platform === 'darwin' ? 'macOS' : info?.platform}</div>
          <div className="text-xs text-faint">An agentic video editor, named after the Pallas cat.</div>
        </div>
      </div>
      <div className="mb-3 rounded-lg border border-line bg-raised/60 p-3">
        <div className="mb-2 font-medium">Updates</div>
        <p className="mb-3 text-xs text-dim">{line}</p>
        <div className="flex gap-1.5">
          {st?.mode === 'self' && st.status !== 'ready' && <Button size="sm" onClick={async () => setSt(await window.manul.updates.check())} disabled={st.status === 'checking' || st.status === 'downloading'}>
            {st.status === 'checking' ? <Loader2 className="animate-spin" /> : <RefreshCw />}Check now</Button>}
          {st?.status === 'ready' && <Button size="sm" variant="primary" onClick={() => window.manul.updates.install()}>Restart to update</Button>}
        </div>
      </div>
      {tel && (tel.available.usage || tel.available.crashes) && <div className="mb-3 rounded-lg border border-line bg-raised/60 p-3">
        <div className="mb-2 font-medium">Crash reports and usage</div>
        <TelemetryChoices available={tel.available} usage={tel.usage} crashes={tel.crashes}
          onUsage={usage => window.manul.telemetry.set({ usage, crashes: tel.crashes }).then(setTel)}
          onCrashes={crashes => window.manul.telemetry.set({ usage: tel.usage, crashes }).then(setTel)} />
      </div>}
      <Button size="sm" variant="ghost" onClick={() => window.manul.notices()}><FileText />Open-source licences</Button>
    </div>
  )
}
