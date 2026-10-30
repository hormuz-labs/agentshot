import { useRef, useState } from 'react'
import { AtSign, Mic, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, timecode } from '@/lib/utils'
import type { Edit } from '../../../shared/timeline'
import type { Voiceover, VoiceoverAsset } from '../../../shared/voiceover'
import { voiceoverName } from '../../../shared/voiceover'
import { Waveform } from './VoiceoverPanel'

export type LiveVoiceover = { start: number; duration: number; peaks: number[]; paused?: boolean }

/** Audio lanes use the video strip's full width inside the same zoom/scroll container. */
export function VoiceoverLanes({ tracks, assets, duration, fps, selected, disabled, live, onSelect, onSeek, onEdit }: {
  tracks: Voiceover[]; assets: VoiceoverAsset[]; duration: number; fps: number; selected: string | null; disabled: boolean; live?: LiveVoiceover | null
  onSelect(id: string): void; onSeek(t: number): void; onEdit?(edits: Edit[]): Promise<void>
}) {
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<{ id: string; start: number } | null>(null)
  const drag = useRef<{ track: Voiceover; x: number; width: number; moved: boolean; start: number } | null>(null)
  if (!tracks.length && !live) return null
  return <div data-voiceover-tracks className="mt-1 space-y-1" aria-label="Voiceover audio lanes">
    {tracks.map((v, index) => {
      const asset = assets.find(a => a.src === v.src), max = asset?.duration || v.out, peaks = asset?.peaks || []
      const start = preview?.id === v.id ? preview.start : v.start
      return <div key={v.id} data-audio-lane className="relative h-10 overflow-hidden rounded border border-line bg-hover/40" onPointerDown={e => {
        if (e.button !== 0 || live) return
        const r = e.currentTarget.getBoundingClientRect()
        onSeek(Math.min(duration, Math.max(0, (e.clientX - r.left) / r.width * duration)))
      }}>
        <button type="button" data-voiceover-clip={v.id} aria-label={`Voiceover ${index + 1}: ${v.src.split('/').pop()}`} aria-pressed={selected === v.id}
          title={`${timecode(start)} · ${timecode(v.out - v.in)} · Click to edit, drag to move`}
          style={{ left: `${start / duration * 100}%`, width: `${(v.out - v.in) / duration * 100}%` }}
          className={cn('absolute inset-y-0 min-w-1 touch-none overflow-hidden rounded-sm border text-emerald-700 dark:text-emerald-300', selected === v.id ? 'border-emerald-500 bg-emerald-500/25 ring-1 ring-inset ring-emerald-500' : 'border-emerald-500/40 bg-emerald-500/15 hover:bg-emerald-500/25', v.muted && 'opacity-40', !disabled && 'cursor-grab active:cursor-grabbing')}
          onPointerDown={e => {
            e.stopPropagation()
            if (e.button !== 0 || live) return
            onSelect(v.id); onSeek(v.start)
            if (disabled) return
            e.currentTarget.setPointerCapture(e.pointerId)
            drag.current = { track: v, x: e.clientX, width: e.currentTarget.parentElement!.getBoundingClientRect().width, moved: false, start: v.start }
          }}
          onPointerMove={e => {
            const g = drag.current
            if (!g || g.track.id !== v.id || (!g.moved && Math.abs(e.clientX - g.x) < 4)) return
            g.moved = true
            g.start = Math.max(0, Math.min(duration - Math.min(v.out - v.in, duration), Math.round((g.track.start + (e.clientX - g.x) / g.width * duration) * fps) / fps))
            setPreview({ id: v.id, start: g.start })
          }}
          onPointerUp={async () => {
            const g = drag.current; drag.current = null
            try {
              if (g?.moved && g.start !== v.start) { setError(''); await onEdit?.([{ op: 'voiceover', id: v.id, track: { ...v, start: g.start } }]) }
            } catch { setError('Could not move this voiceover. Please try again.') }
            finally { setPreview(null) }
          }}
          onPointerCancel={() => { drag.current = null; setPreview(null) }}
          onClick={e => { if (e.detail === 0 && !live) { onSelect(v.id); onSeek(v.start) } }}>
          <span className="flex h-5 items-center gap-1 truncate bg-emerald-500/10 px-1.5 text-[10px] font-medium"><Mic className="size-3 shrink-0" /><span className="truncate">A{index + 1} · {voiceoverName(assets, v.src)}</span></span>
          <div className="h-5 [&>svg]:h-full"><Waveform peaks={peaks.slice(Math.floor(v.in / max * peaks.length), Math.ceil(v.out / max * peaks.length))} /></div>
        </button>
      </div>
    })}
    {live && <div data-live-audio-lane className="relative h-10 overflow-hidden rounded border border-line bg-hover/40">
      <div className="absolute inset-y-0 min-w-1 overflow-hidden rounded border border-red-500/50 bg-red-500/15 text-red-500" style={{ left: `${live.start / duration * 100}%`, width: `${Math.min(live.duration, duration - live.start) / duration * 100}%` }}>
        <span className="block h-5 whitespace-nowrap px-1.5 text-[10px] font-medium">{live.paused ? 'Ⅱ Voiceover paused' : '● Recording voiceover'}</span>
        <div className="h-5 [&>svg]:h-full"><Waveform peaks={live.peaks} /></div>
      </div>
    </div>}
    {error && <p role="alert" className="text-xs text-bad">{error}</p>}
  </div>
}

/** Only the selected audio clip exposes its editing controls, below the shared timeline viewport. */
export function VoiceoverControls({ name, track: v, sourceDuration, duration, disabled, onEdit, onAttach, onClose }: {
  name: string; track: Voiceover; sourceDuration: number; duration: number; disabled: boolean
  onEdit(edits: Edit[]): Promise<void>; onAttach?(src: string): void; onClose(): void
}) {
  const [error, setError] = useState('')
  const [level, setLevel] = useState<number | null>(null)
  const db = level ?? v.db
  const change = async (patch: Partial<Voiceover> | null) => {
    try { setError(''); await onEdit([{ op: 'voiceover', id: v.id, track: patch ? { ...v, ...patch } : null }]) }
    catch { setError('Could not update this voiceover. Check the timing and try again.') }
  }
  return <div data-voiceover-controls className="mt-2 overflow-hidden rounded-xl border border-line bg-canvas/60 shadow-sm">
    <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gradient-to-r from-emerald-500/[0.06] to-transparent px-3 py-2.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/15 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Mic className="size-4" /></span>
      <div className="min-w-0 flex-1" title={v.src}><h3 className="truncate text-xs font-semibold text-fg">{name}</h3><p className="mt-0.5 text-[10px] text-dim">Recorded audio <span className="px-1 text-faint">·</span><span className="tabular">{(v.out - v.in).toFixed(2)} s</span></p></div>
      <Button size="sm" variant="ghost" className="border border-line bg-panel text-xs" aria-label="Mention voiceover in chat" title="Attach this recording and mention it in your message" disabled={!onAttach} onClick={() => onAttach?.(v.src)}><AtSign />Mention</Button>
      <span className="mx-0.5 h-4 w-px bg-line" />
      <Button size="iconSm" variant="ghost" className="hover:bg-bad/10 hover:text-bad" disabled={disabled} title="Remove from timeline" aria-label="Remove voiceover from video" onClick={() => change(null)}><Trash2 /></Button>
      <Button size="iconSm" variant="ghost" title="Close controls" aria-label="Close voiceover controls" onClick={onClose}><X /></Button>
    </div>
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3 p-3">
      <div className="grid min-w-0 flex-1 basis-[240px] grid-cols-3 gap-2">
      {([['Start', 'start', duration], ['Trim in', 'in', v.out - .04], ['Trim out', 'out', sourceDuration]] as const).map(([label, key, limit]) => <label key={key} className="min-w-0 space-y-1.5"><span className="block text-[10px] font-medium uppercase tracking-wider text-dim">{label}</span><span className="flex h-8 items-center rounded-md border border-line bg-panel pr-2 transition-colors focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/10"><input key={`${v.id}-${key}-${v[key]}`} aria-label={`Voiceover ${label.toLowerCase()} seconds`} type="number" step="0.01" min={key === 'out' ? v.in + .04 : 0} max={limit} defaultValue={Number(v[key].toFixed(3))} disabled={disabled} className="h-full w-full min-w-0 bg-transparent pl-2 text-xs tabular outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => { const n = e.target.valueAsNumber; if (n !== Number(v[key].toFixed(3))) void change({ [key]: n }) }} /><span className="text-[10px] text-faint">s</span></span></label>)}
      </div>
      <div className="min-w-[160px] flex-1 basis-[180px] space-y-1.5">
        <div className="flex items-center justify-between text-[10px]"><span className="font-medium uppercase tracking-wider text-dim">Volume</span><output className="tabular text-dim">{db > 0 ? '+' : ''}{db} dB</output></div>
        <div className="flex h-8 items-center gap-3">
          <Volume2 className="size-3.5 shrink-0 text-dim" />
          <input aria-label="Voiceover volume" type="range" min="-40" max="12" step="1" value={db} disabled={disabled} onChange={e => setLevel(Number(e.target.value))} onPointerUp={async e => { await change({ db: Number(e.currentTarget.value) }); setLevel(null) }} onKeyUp={async e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) { await change({ db: Number(e.currentTarget.value) }); setLevel(null) } }} onPointerCancel={() => setLevel(null)} className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-line-strong accent-emerald-500 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-emerald-500 [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:shadow-sm" style={{ background: `linear-gradient(to right, var(--color-emerald-500) ${(db + 40) / 52 * 100}%, var(--color-line-strong) ${(db + 40) / 52 * 100}%)` }} />
          <Button size="iconSm" variant="ghost" title={v.muted ? 'Unmute voiceover' : 'Mute voiceover'} aria-label="Mute voiceover" aria-pressed={!!v.muted} className={cn('shrink-0 border', v.muted ? 'border-amber/30 bg-amber-soft text-amber' : 'border-line')} disabled={disabled} onClick={() => change({ muted: !v.muted })}>{v.muted ? <VolumeX /> : <Volume2 />}</Button>
        </div>
      </div>
    </div>
    {error && <p role="alert" className="px-3 pb-3 text-xs text-bad">{error}</p>}
  </div>
}
