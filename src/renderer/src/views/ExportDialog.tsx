// Export the film: size, how other shapes are filled, captions. Progress shows in the jobs tray.
import { useEffect, useState } from 'react'
import { Check, Download, FolderOpen, Info, Loader2, Upload } from 'lucide-react'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PRESETS, type PresetId } from '../../../shared/export'

export function ExportDialog({ dir, open, onOpenChange }: { dir: string; open: boolean; onOpenChange(v: boolean): void }) {
  const [preset, setPreset] = useState<PresetId>('original')
  const [fit, setFit] = useState<'pad' | 'crop'>('pad')
  const [captions, setCaptions] = useState<'none' | 'burn' | 'srt'>('none')
  const [largeInstalled, setLargeInstalled] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  useEffect(() => {
    if (open) window.manul.tools.list().then(tools => setLargeInstalled(tools.some(t => t.id === 'whisper-large-v3' && t.installed))).catch(() => {})
  }, [open])
  const downloadLarge = async () => {
    setDownloading(true); setDownloadError('')
    try {
      await window.manul.tools.install('whisper-large-v3')
      setLargeInstalled(true)
    } catch (e) {
      setDownloadError(String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300))
    } finally { setDownloading(false) }
  }
  const [state, setState] = useState<'idle' | 'busy' | { file: string } | { error: string }>('idle')
  const go = async () => {
    setState('busy')
    try {
      const r = await window.manul.export.run(dir, { preset, fit, captions })
      setState(r ? { file: r.file } : 'idle')
    } catch (e) { setState({ error: String((e as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, '').slice(0, 300) }) }
  }
  const choice = (on: boolean) => cn('rounded-lg border px-3 py-2 text-left transition-colors', on ? 'border-amber bg-amber-soft' : 'border-line bg-raised/60 hover:border-line-strong')
  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) setState('idle') }} title="Export" description="A finished MP4 of the version on screen.">
      <div className="mb-4 grid grid-cols-2 gap-2">
        {PRESETS.map(p => (
          <button key={p.id} onClick={() => setPreset(p.id)} className={choice(preset === p.id)}>
            <div className="font-medium">{p.label}</div><div className="text-xs text-dim">{p.hint}</div>
          </button>
        ))}
      </div>
      {preset !== 'original' && (
        <div className="mb-4">
          <div className="mb-1.5 text-xs text-dim">When the shape differs</div>
          <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
            {([['pad', 'Blurred fill'], ['crop', 'Crop to fill']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFit(k)} className={cn('rounded-md px-3 py-1 text-xs', fit === k ? 'bg-raised text-fg' : 'text-dim')}>{l}</button>
            ))}
          </div>
        </div>
      )}
      <div className="mb-5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-dim">
          Captions (from the transcript)
          <Tip label={<span className="block max-w-64">For corrected wording and custom styles, try asking in chat: “Correct the transcript and add styled captions.” If those captions are already in your video, choose None here to avoid adding a second set.</span>}>
            <button type="button" aria-label="Tips for better captions" className="rounded text-faint hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"><Info className="size-3.5" /></button>
          </Tip>
        </div>
        <div className="inline-flex rounded-lg border border-line bg-bg p-0.5">
          {([['none', 'None'], ['burn', 'In the picture'], ['srt', 'Separate .srt']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setCaptions(k)} className={cn('rounded-md px-3 py-1 text-xs', captions === k ? 'bg-raised text-fg' : 'text-dim')}>{l}</button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {largeInstalled ? <div className="flex items-center gap-1.5 text-xs text-ok"><Check className="size-3.5" />Whisper Large-v3 installed</div> : (
            <Button size="sm" onClick={downloadLarge} disabled={downloading || state === 'busy'}>
              {downloading ? <Loader2 className="animate-spin" /> : <Download />}{downloading ? 'Downloading… See jobs for progress' : 'Download Whisper Large-v3 · 3.1 GB'}
            </Button>
          )}
          <Tip label={<span className="block max-w-64">Whisper Large-v3 can improve transcript accuracy for export captions. This optional 3.1 GB download runs locally and is used automatically once installed. It needs more memory and processing time than Base.</span>}>
            <button type="button" aria-label="About Whisper Large-v3" className="rounded text-faint hover:text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber"><Info className="size-3.5" /></button>
          </Tip>
        </div>
        {downloadError && <p role="alert" className="mt-2 text-xs text-bad">{downloadError}</p>}
        {captions !== 'none' && <p className="mt-2 text-xs text-dim">{largeInstalled ? 'Using Whisper Large-v3 for export captions.' : 'Using your current transcription model.'}</p>}
      </div>
      {typeof state === 'object' && 'file' in state && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-ok/30 bg-ok/10 px-3 py-2 text-xs">
          <Check className="size-3.5 text-ok" /><span className="flex-1 truncate" data-selectable>{state.file}</span>
          <Button size="sm" variant="ghost" onClick={() => window.manul.export.reveal(state.file)}><FolderOpen />Show</Button>
        </div>
      )}
      {typeof state === 'object' && 'error' in state && <p className="mb-3 text-xs text-bad" data-selectable>{state.error}</p>}
      <div className="flex justify-end">
        <Button variant="primary" onClick={go} disabled={state === 'busy' || (downloading && captions !== 'none')}>{state === 'busy' ? <Loader2 className="animate-spin" /> : <Upload />}Export</Button>
      </div>
    </Dialog>
  )
}
