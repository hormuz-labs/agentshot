import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/button'
import { length, type Edit, type Item } from '../../../shared/timeline'

export function ClipActions({ item, items, start, time, onEdit, onClose, onOpen }: {
  item: Item; items: Item[]; start: number; time: number
  onEdit(edits: Edit[]): Promise<void>; onClose(): void; onOpen?(): void
}) {
  const [before, setBefore] = useState(items[items.findIndex(i => i.id === item.id) + 1]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const run = async (edit: Edit) => {
    setBusy(true); setError('')
    try { await onEdit([edit]); onClose() } catch (e) { setError(String((e as Error).message)) } finally { setBusy(false) }
  }
  return <div role="dialog" aria-label="Clip actions" data-clip-actions className="rounded-xl border border-orange-500 bg-panel p-3 text-sm shadow-xl" onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') onClose() }}>
    <div className="mb-2 flex items-center gap-2"><strong className="min-w-0 flex-1 truncate">{item.kind === 'media' ? item.src.split('/').pop() : item.clip}</strong><button aria-label="Close clip actions" onClick={onClose}><X className="size-4" /></button></div>
    <div className="mt-3 flex flex-wrap gap-2">
      <Button disabled={busy || item.kind !== 'media' || time <= start + .001 || time >= start + length(item) - .001} onClick={() => run({ op: 'split', at: time })}>Split at playhead</Button>
      <Button disabled={busy || items.length <= 1} onClick={() => run({ op: 'delete', ids: [item.id] })}>Remove clip</Button>
      {onOpen && <Button onClick={onOpen}>Edit motion</Button>}
    </div>
    <div className="mt-3 flex gap-2"><select aria-label="Move clip before" value={before} onChange={e => setBefore(e.target.value)} className="min-w-0 flex-1 rounded bg-raised p-1">
      {items.filter(i => i.id !== item.id).map((i, k) => <option key={i.id} value={i.id}>Before {k + 1}: {i.kind === 'media' ? i.src.split('/').pop() : i.clip}</option>)}
      <option value="">End of timeline</option>
    </select><Button disabled={busy || items.length <= 1} onClick={() => run({ op: 'move', id: item.id, ...(before ? { before } : {}) })}>Move clip</Button></div>
    {error && <p role="alert" className="mt-2 text-red-500">{error}</p>}
  </div>
}
