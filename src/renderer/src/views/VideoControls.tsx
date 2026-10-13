import { Button } from '@/components/ui/button'
import { framing } from '../../../shared/framing'
import type { Edit, MediaItem } from '../../../shared/timeline'

export function VideoControls({ item, editing, onEditing, onEdit }: { item: MediaItem; editing: boolean; onEditing(v: boolean): void; onEdit(edits: Edit[]): Promise<void> }) {
  const f = item.framing || framing()
  const set = (patch: Partial<typeof f>) => onEdit([{ op: 'frame', ids: [item.id], framing: patch }])
  return <div data-video-controls className="rounded-lg border border-line bg-raised/40 p-2">
    <div className="flex items-center gap-2"><Button size="sm" variant={editing ? 'primary' : 'ghost'} onClick={() => onEditing(!editing)}>Video placement</Button><span className="min-w-0 flex-1 truncate text-xs text-dim">{item.src.split('/').pop()}</span></div>
    {editing && <div className="mt-2 grid grid-cols-2 gap-2">
      <label className="text-xs text-dim">Framing<select aria-label="Video fit" value={f.fit} onChange={e => set({ fit: e.target.value as typeof f.fit })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg"><option value="contain">Fit whole video</option><option value="cover">Fill canvas</option></select></label>
      <label className="text-xs text-dim">Scale (%)<input aria-label="Video scale" type="number" min="25" max="400" value={Math.round(f.zoom * 100)} onChange={e => set({ zoom: Number(e.target.value) / 100 })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg" /></label>
      {(['x', 'y'] as const).map(k => <label key={k} className="text-xs text-dim">{k === 'x' ? 'Horizontal' : 'Vertical'} offset (%)<input aria-label={`Video offset ${k}`} type="number" min="-200" max="200" value={Math.round(f[k] * 100)} onChange={e => set({ [k]: Number(e.target.value) / 100 })} className="mt-1 w-full rounded border border-line bg-panel p-1 text-fg" /></label>)}
      <div className="col-span-2 flex items-center gap-2"><Button size="sm" variant="ghost" onClick={() => onEdit([{ op: 'frame', ids: [item.id], framing: null }])}>Reset placement</Button><span className="text-[11px] text-dim">Drag to position. Gold handle resizes. Scroll to zoom. Undo restores your previous framing.</span></div>
    </div>}
  </div>
}
