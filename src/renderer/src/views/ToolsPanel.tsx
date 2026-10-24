import { useEffect, useState } from 'react'
import { AudioLines, Check, Cloud, Download, FolderSearch, Loader2, Package, RefreshCw, Trash2 } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { JobRow, useJobs } from '@/components/JobsTray'
import type { OnDemandTool, ToolStatus, WhisperStatus } from '../../../shared/types'
import { CLOUD_TOOLS } from '../../../shared/cloud-tools'

const short = (p?: string) => p?.replace(/^\/Users\/[^/]+/, '~')
const modelName = (p: string) => p.split('/').pop()!.replace(/^ggml-|\.bin$/g, '')

function SpeechSection({ onChange }: { onChange(): void }) {
  const [st, setSt] = useState<WhisperStatus | null>(null)
  useEffect(() => { window.manul.whisper.status().then(setSt) }, [])
  if (!st) return null
  const apply = async (c: Parameters<typeof window.manul.whisper.set>[0]) => { setSt(await window.manul.whisper.set(c)); onChange() }
  const sys = st.active?.engine === 'system' ? st.active : null
  const engineButton = (engine: 'bundled' | 'managed', label: string) =>
    st.active?.engine !== engine && <Button size="sm" variant="ghost" onClick={() => apply({ mode: 'custom', engine })}>{label}</Button>
  const custom = st.config?.mode === 'custom'
  const pick = async (what: 'binary' | 'model') => {
    const path = await window.manul.whisper.pick(what)
    if (path) apply({ mode: 'custom', engine: 'system', binary: what === 'binary' ? path : sys?.binary || st.found.binaries[0], model: what === 'model' ? path : sys?.model || st.found.models[0] })
  }
  return (
    <div className="mb-5 rounded-lg border border-line bg-raised/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <AudioLines className="size-4 text-amber" />
        <span className="flex-1 font-medium">Speech recognition</span>
        <span className="rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-dim">{!st.active ? 'not set up' : custom && sys ? 'your paths' : sys ? 'found on this computer' : st.active.engine === 'bundled' ? 'built into AgentShot' : 'Python engine'}</span>
      </div>
      {st.active ? (
        <div className="space-y-1 text-xs">
          <div className="text-fg">{st.active.label}</div>
          {sys && <>
            <div className="truncate text-faint" title={sys.binary}>Program: <span className="font-mono" data-selectable>{short(sys.binary)}</span></div>
            <div className="truncate text-faint" title={sys.model}>Model: <span className="font-mono" data-selectable>{short(sys.model)}</span></div>
          </>}
        </div>
      ) : (
        <p className="text-xs text-dim">{st.bundledBinary
          ? 'AgentShot has whisper.cpp built in; it needs its model (148 MB, below). Or point AgentShot at your own whisper-cli and model.'
          : 'No whisper.cpp found on this computer. Install the Python engine below, or point AgentShot at your own whisper-cli and model.'}</p>
      )}
      {sys && st.found.models.length > 1 && (
        <label className="mt-2 flex items-center gap-2 text-xs text-dim">
          Model
          <select className="h-7 flex-1 rounded-md border border-line bg-bg px-1.5 text-xs text-fg outline-none" value={sys.model}
            onChange={e => apply({ mode: 'custom', engine: 'system', binary: sys.binary, model: e.target.value })}>
            {st.found.models.map(m => <option key={m} value={m}>{modelName(m)} — {short(m)}</option>)}
          </select>
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => apply({ mode: 'auto' })} title="Search this computer again and use what is found"><RefreshCw />Detect again</Button>
        <Button size="sm" variant="ghost" onClick={() => pick('binary')}><FolderSearch />Choose program…</Button>
        <Button size="sm" variant="ghost" onClick={() => pick('model')}><FolderSearch />Choose model…</Button>
        {st.bundledReady && engineButton('bundled', 'Use built-in')}
        {st.managedInstalled && engineButton('managed', 'Use Python engine')}
      </div>
    </div>
  )
}

const mb = (b?: number) => (b == null ? '' : b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`)

export function ToolsPanel() {
  const [bundled, setBundled] = useState<ToolStatus[]>([])
  const [tools, setTools] = useState<OnDemandTool[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const jobs = useJobs().filter(j => j.kind === 'install' || j.kind === 'download')
  const refresh = () => { window.manul.tools.bundled().then(setBundled); window.manul.tools.list().then(setTools) }
  useEffect(() => { refresh() }, [])

  const act = async (id: string, fn: () => Promise<void>) => {
    setBusy(id); setError(null)
    try { await fn() } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    setBusy(null); refresh()
  }

  return (
    <div>
      <PanelHeader title="Tools" description="AgentShot ships with ffmpeg and whisper.cpp. Heavier tools download only when you need them, into AgentShot's own folder." />
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Built in</div>
      <div className="mb-5 space-y-1.5">
        {bundled.map(t => (
          <div key={t.name} className="flex items-center gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2">
            <Package className="size-4 text-dim" />
            <span className="flex-1 font-medium">{t.name}</span>
            <span className="text-xs text-faint">{t.version || 'missing'}</span>
            {t.ok ? <Check className="size-4 text-ok" /> : <span className="text-xs text-bad">not working</span>}
          </div>
        ))}
      </div>
      <SpeechSection onChange={refresh} />
      <div className="mb-2 text-xs font-medium uppercase tracking-wider text-faint">Downloaded when needed</div>
      <div className="space-y-1.5">
        {tools.map(t => (
          <div key={t.id} className="rounded-lg border border-line bg-raised/60 px-3 py-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-faint">{t.installed ? `${t.version ?? 'installed'} · ${mb(t.diskBytes)}` : `about ${t.sizeMB} MB`}</div>
              </div>
              {busy === t.id ? <Loader2 className="size-4 animate-spin text-amber" /> : t.installed ? (
                <Button size="sm" variant="ghost" onClick={() => act(t.id, () => window.manul.tools.remove(t.id))}><Trash2 />Remove</Button>
              ) : (
                <Button size="sm" onClick={() => act(t.id, () => window.manul.tools.install(t.id))}><Download />Install</Button>
              )}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-dim">{t.description}</p>
          </div>
        ))}
      </div>
      <div className="mb-2 mt-5 text-xs font-medium uppercase tracking-wider text-faint">In the cloud</div>
      <div className="space-y-1.5">
        {CLOUD_TOOLS.map(t => (
          <div key={t.id} className="rounded-lg border border-line bg-raised/60 px-3 py-2.5" data-cloud-tool={t.id} aria-disabled={t.status !== 'live'}>
            <div className="flex items-center gap-3">
              <Cloud className="size-4 text-dim" />
              <span className="min-w-0 flex-1 font-medium">{t.name}</span>
              {t.status !== 'live' && <span className="rounded bg-bg px-1.5 py-0.5 text-[10.5px] text-dim">Coming soon</span>}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-dim">{t.description}</p>
          </div>
        ))}
      </div>
      {jobs.length > 0 && <div className="mt-4 space-y-3 rounded-lg border border-line p-3">{jobs.map(j => <JobRow key={j.id} j={j} />)}</div>}
      {error && <p className="mt-3 text-xs text-bad" data-selectable>{error}</p>}
    </div>
  )
}
