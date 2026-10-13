import { useState } from 'react'
import { cameraLayout, fullSourceLayout, type CameraCorner, type CameraShape } from '../../../shared/demo'
import type { Edit, Timeline } from '../../../shared/timeline'
import { Button } from '@/components/ui/button'
import { framing } from '../../../shared/framing'
import { SourceFraming } from './SourceFraming'
import type { MediaInfo } from '../../../shared/types'

export function CameraControls({ timeline: tl, onEdit, mode, onMode, sourceUrl, sourceInfo, sourceTime = 0 }: { timeline: Timeline; onEdit(edits: Edit[]): Promise<void>; mode: 'move' | 'frame' | null; onMode(v: 'move' | 'frame' | null): void; sourceUrl?: string; sourceInfo?: MediaInfo; sourceTime?: number }) {
  const l = tl.demo!.layout, f = l.framing || framing({}, 'cover')
  const [error, setError] = useState('')
  const change = async (layout: Edit & { op: 'camera' }) => { try { await onEdit([layout]); setError('') } catch (e) { setError(String(e)) } }
  return <div className="rounded-lg border border-line bg-raised/40 p-2" data-camera-controls>
    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">Face camera</span><span className="flex-1 text-xs text-dim">{l.width} × {l.height} · {l.shape}</span><label className="flex gap-1 text-xs text-dim"><input type="checkbox" checked={!l.hidden} onChange={e => change({ op: 'camera', layout: { hidden: !e.target.checked } })} />Show</label></div>
    <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant={mode === 'move' ? 'primary' : 'secondary'} onClick={() => onMode(mode === 'move' ? null : 'move')}>Move & resize</Button><Button size="sm" variant={mode === 'frame' ? 'primary' : 'secondary'} onClick={async () => {
      if (mode !== 'frame' && l.crop && sourceInfo) await change({ op: 'camera', layout: fullSourceLayout(l, sourceInfo.width, sourceInfo.height) })
      onMode(mode === 'frame' ? null : 'frame')
    }}>Adjust video inside</Button></div>
    <div className="mt-2 grid grid-cols-2 gap-2">
      {mode === 'frame' && sourceUrl && <SourceFraming url={sourceUrl} layout={l} time={sourceTime} onChange={framing => change({ op: 'camera', layout: { framing } })} />}
      <label className="text-xs text-dim">Shape<select aria-label="Edit face shape" value={l.shape} onChange={e => change({ op: 'camera', layout: { shape: e.target.value as CameraShape } })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg">{['circle', 'square', 'rectangle', 'rounded'].map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="text-xs text-dim">Move to corner<select aria-label="Move face camera" value="" onChange={e => change({ op: 'camera', layout: cameraLayout(tl.width, tl.height, { ...l, x: undefined, y: undefined }, e.target.value as CameraCorner) })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg"><option value="">Choose…</option>{['top-right', 'top-left', 'bottom-right', 'bottom-left'].map(s => <option key={s}>{s}</option>)}</select></label>
      {(['width', 'height', 'x', 'y'] as const).map(k => <label key={k} className="text-xs capitalize text-dim">{k} (px)<input aria-label={`Camera ${k}`} type="number" min={k === 'width' || k === 'height' ? 2 : 0} value={l[k]} onChange={e => { if (Number(e.target.value) >= 0) change({ op: 'camera', layout: { [k]: Number(e.target.value) } }) }} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg" disabled={k === 'height' && (l.shape === 'circle' || l.shape === 'square')} /></label>)}
      <label className="col-span-2 text-xs text-dim">Video zoom · {Math.round(f.zoom * 100)}%<input aria-label="Camera video zoom" type="range" min="0.5" max="3" step="0.01" value={f.zoom} onChange={e => change({ op: 'camera', layout: { framing: { ...f, zoom: Number(e.target.value) } } })} className="mt-1 w-full accent-[var(--color-amber)]" /></label>
      {(['x', 'y'] as const).map(k => <label key={`source-${k}`} className="text-xs text-dim">Video {k === 'x' ? 'horizontal' : 'vertical'} offset (%)<input aria-label={`Camera source ${k}`} type="number" step="1" value={Math.round(f[k] * 100)} onChange={e => change({ op: 'camera', layout: { framing: { ...f, [k]: Number(e.target.value) / 100 } } })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg" /></label>)}
      <div className="col-span-2 flex gap-2"><Button size="sm" variant="ghost" onClick={() => change({ op: 'camera', layout: { crop: null, framing: framing({}, 'cover') } })}>Reset framing</Button><Button size="sm" variant="ghost" onClick={() => change({ op: 'camera', layout: { crop: null, framing: { ...f, fit: f.fit === 'contain' ? 'cover' : 'contain' } } })}>{f.fit === 'contain' ? 'Fill shape' : 'Fit whole video'}</Button></div>
      <p className="col-span-2 text-[11px] text-dim">{mode === 'frame' ? 'Drag the video inside the shape to fix a cropped head. The shape stays in place. Scroll to zoom.' : 'Move & resize: drag the shape anywhere on the picture; use the gold handle to resize.'} Changes are live and undoable.</p>
    </div>
    {error && <p role="alert" className="text-xs text-bad">{error}</p>}
  </div>
}
