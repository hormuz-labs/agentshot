import { useState } from 'react'
import { Loader2, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { mediaUrl } from '@/lib/utils'
import { cameraLayout, type CameraCorner, type CameraShape } from '../../../shared/demo'
import type { Project } from '../../../shared/types'
import { demoChatRequest } from '../../../shared/demo-request'

const name = (s: string) => s.split('/').pop()
export function DemoToolbox({ project: p, attached, onClose, onSubmit }: { project: Project; attached: string[]; onClose(): void; onSubmit(request: { text: string; files: string[] }): Promise<void> }) {
  const videos = Object.keys(p.files || {}).filter(f => p.files![f].kind === 'video' && p.media[f]?.width)
  const pair = [...new Set([...attached.filter(f => videos.includes(f)), ...videos])]
  const [screen, setScreen] = useState(pair.find(f => /screen|demo|desktop/i.test(f)) || pair[0] || '')
  const [camera, setCamera] = useState(pair.find(f => /camera|face|webcam/i.test(f) && f !== screen) || pair.find(f => f !== screen) || '')
  const [shape, setShape] = useState<CameraShape>('circle'), [corner, setCorner] = useState<CameraCorner>('top-right')
  const [size, setSize] = useState(20), [cleanup, setCleanup] = useState<'none' | 'natural' | 'tight'>('natural')
  const [customWidth, setCustomWidth] = useState<number | undefined>(), [customHeight, setCustomHeight] = useState<number | undefined>()
  const [audio, setAudio] = useState<'screen' | 'camera'>(p.media[screen]?.hasAudio ? 'screen' : 'camera'), [overlap, setOverlap] = useState(false)
  const [manual, setManual] = useState(false), [screenMoment, setScreenMoment] = useState(''), [cameraMoment, setCameraMoment] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const info = p.media[screen], l = cameraLayout(info?.width || 1920, info?.height || 1080, { shape, width: customWidth ?? (info?.width || 1920) * size / 100, height: customHeight }, corner)
  const go = async () => {
    setBusy(true); setError('')
    try {
      if (manual && (!screenMoment.trim() || !cameraMoment.trim() || !Number.isFinite(Number(screenMoment)) || !Number.isFinite(Number(cameraMoment)))) throw new Error('Enter the time of the same word or clap in both recordings, in seconds.')
      await onSubmit(demoChatRequest({ screen, camera, corner, layout: { shape, width: l.width, height: l.height }, cleanup, audio, overlapOnly: overlap,
        manualOffset: manual ? Number(screenMoment) - Number(cameraMoment) : undefined }))
      onClose()
    } catch (e) { setError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { setBusy(false) }
  }
  return <section data-demo-toolbox className="space-y-3 rounded-xl border border-amber/30 bg-surface p-4" aria-label="Auto Demo toolbox">
    <div className="flex items-start gap-3"><div className="flex-1"><h3 className="font-medium">Auto Demo Edit</h3><p className="mt-1 text-xs text-dim">Choose your look here in chat. Manul will sync, edit and show the result beside the conversation.</p></div><Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Close</Button></div>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {([['Screen recording', screen, setScreen], ['Face camera', camera, setCamera]] as const).map(([label, value, set]) => <label key={label} className="text-xs text-dim">{label}
            <select aria-label={label} value={value} onChange={e => { set(e.target.value); if (label === 'Screen recording' && !p.media[e.target.value]?.hasAudio) setAudio('camera') }} className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg">
            <option value="">Choose recording</option>{videos.map(f => <option key={f} value={f}>{name(f)}</option>)}
          </select>
        </label>)}
      </div>
      {screen && camera && <div className="relative overflow-hidden rounded-lg border border-line bg-black" style={{ aspectRatio: `${info?.width || 1920}/${info?.height || 1080}` }}>
        <video key={screen} src={mediaUrl(`${p.dir}/${p.proxies?.[screen] || screen}`)} className="size-full object-contain" muted preload="metadata" onLoadedMetadata={e => { e.currentTarget.currentTime = Math.min(1, e.currentTarget.duration / 2) }} />
        <video key={camera} src={mediaUrl(`${p.dir}/${p.proxies?.[camera] || camera}`)} muted preload="metadata" onLoadedMetadata={e => { e.currentTarget.currentTime = Math.min(1, e.currentTarget.duration / 2) }} className="absolute object-cover"
          style={{ left: `${l.x / (info?.width || 1920) * 100}%`, top: `${l.y / (info?.height || 1080) * 100}%`, width: `${l.width / (info?.width || 1920) * 100}%`, height: `${l.height / (info?.height || 1080) * 100}%`, borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? 12 : 0, border: '1px solid white' }} />
        <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-white">Layout preview · your chat agent handles syncing</span>
      </div>}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-dim">Face shape<select aria-label="Face shape" value={shape} onChange={e => setShape(e.target.value as CameraShape)} className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg">{(['circle', 'square', 'rectangle', 'rounded'] as const).map(s => <option key={s} value={s}>{s === 'rounded' ? 'Rounded rectangle' : s[0].toUpperCase() + s.slice(1)}</option>)}</select></label>
        <label className="text-xs text-dim">Position<select aria-label="Camera position" value={corner} onChange={e => setCorner(e.target.value as CameraCorner)} className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg">{(['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const).map(s => <option key={s} value={s}>{s.replace('-', ' ')}</option>)}</select></label>
      </div>
      <label className="block text-xs text-dim">Face size · {l.width} × {l.height} px<input aria-label="Face size" type="range" min="10" max="35" value={size} onChange={e => { setSize(Number(e.target.value)); setCustomWidth(undefined); setCustomHeight(undefined) }} className="mt-2 w-full accent-[var(--color-amber)]" /></label>
      <details><summary className="cursor-pointer text-xs text-dim">Exact dimensions</summary><div className="mt-2 grid grid-cols-2 gap-2">
        <label className="text-xs text-dim">Width (px)<input aria-label="Initial camera width" type="number" min="2" value={l.width} onChange={e => { if (Number(e.target.value) >= 2) setCustomWidth(Number(e.target.value)) }} className="mt-1 w-full rounded border border-line bg-raised p-2 text-fg" /></label>
        <label className="text-xs text-dim">Height (px)<input aria-label="Initial camera height" type="number" min="2" value={l.height} disabled={shape === 'circle' || shape === 'square'} onChange={e => { if (Number(e.target.value) >= 2) setCustomHeight(Number(e.target.value)) }} className="mt-1 w-full rounded border border-line bg-raised p-2 text-fg" /></label>
      </div></details>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-xs text-dim">Pacing<select aria-label="Demo pacing" value={cleanup} onChange={e => setCleanup(e.target.value as typeof cleanup)} className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg"><option value="natural">Natural (recommended)</option><option value="tight">Tighter</option><option value="none">Keep everything</option></select></label>
        <label className="text-xs text-dim">Narration<select aria-label="Narration recording" value={audio} onChange={e => setAudio(e.target.value as typeof audio)} className="mt-1 block w-full rounded border border-line bg-raised p-2 text-fg"><option value="screen">Screen microphone</option><option value="camera">Camera microphone</option></select></label>
      </div>
      <p className="text-xs text-dim">Keeps explanations and screen actions. Trims pauses only when both speech and meaningful activity stop. You can adjust your face layout and undo edits afterward.</p>
      <label className="flex gap-2 text-xs text-dim"><input type="checkbox" checked={overlap} onChange={e => setOverlap(e.target.checked)} />Only keep footage covered by both recordings</label>
      <details><summary className="cursor-pointer text-xs text-dim">Manual sync if the audio cannot be matched</summary>
        <label className="my-2 flex gap-2 text-xs"><input type="checkbox" checked={manual} onChange={e => setManual(e.target.checked)} />Use matching moments</label>
        {manual && <div className="grid grid-cols-2 gap-2">{([['Same word in screen (seconds)', screenMoment, setScreenMoment], ['Same word in camera (seconds)', cameraMoment, setCameraMoment]] as const).map(([label, value, set]) => <label key={label} className="text-xs text-dim">{label}<input aria-label={label} type="number" min="0" step="0.01" value={value} onChange={e => set(e.target.value)} className="mt-1 w-full rounded border border-line bg-raised p-2 text-fg" /></label>)}</div>}
      </details>
    </fieldset>
    {error && <p role="alert" className="mt-3 text-xs text-bad" data-selectable>{error}</p>}
    <div className="mt-4 flex justify-end gap-2"><Button variant="primary" disabled={busy || !screen || !camera || screen === camera || !!p.proposal} onClick={go}>{busy ? <Loader2 className="animate-spin" /> : <WandSparkles />}{busy ? 'Sending to chat…' : 'Generate in chat'}</Button></div>
  </section>
}
