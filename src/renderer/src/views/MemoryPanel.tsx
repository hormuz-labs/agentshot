// What Manul remembers about the user across projects. Readable, editable, deletable.
import { useEffect, useState } from 'react'
import { Brain, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/ui/panel-header'

type Item = { name: string; description: string; body: string }

export function MemoryPanel() {
  const [items, setItems] = useState<Item[]>([])
  const [edit, setEdit] = useState<Item | null>(null)
  useEffect(() => { window.manul.memory.list().then(setItems) }, [])
  const save = async () => { if (!edit?.name.trim()) return; setItems(await window.manul.memory.save(edit.name, edit.description, edit.body)); setEdit(null) }

  return (
    <div>
      <PanelHeader title="Memory" description="What AgentShot has learned about your taste and rules. It uses these in every project; change or delete anything." />
      <div className="mb-3 flex justify-end"><Button size="sm" onClick={() => setEdit({ name: '', description: '', body: '' })}><Plus />Add</Button></div>
      {edit && (
        <div className="mb-3 space-y-2 rounded-lg border border-amber/30 bg-raised/60 p-3">
          <input value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} placeholder="name, e.g. caption-style" className="h-8 w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-amber/60" />
          <input value={edit.description} onChange={e => setEdit({ ...edit, description: e.target.value })} placeholder="one line: when this matters" className="h-8 w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-amber/60" />
          <textarea value={edit.body} onChange={e => setEdit({ ...edit, body: e.target.value })} rows={5} placeholder="the rule, and why" className="w-full resize-y rounded-md border border-line bg-bg p-2 text-xs outline-none focus:border-amber/60" />
          <div className="flex justify-end gap-1.5"><Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={save}>Save</Button></div>
        </div>
      )}
      {items.length === 0 && !edit && (
        <div className="rounded-lg border border-dashed border-line p-6 text-center text-dim"><Brain className="mx-auto mb-2 size-5" />Nothing yet. Tell AgentShot “remember that…” and it will keep it here.</div>
      )}
      <div className="space-y-1.5">
        {items.map(m => (
          <div key={m.name} className="group rounded-lg border border-line bg-raised/60 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 font-medium">{m.name}</span>
              <button className="text-faint opacity-0 hover:text-fg group-hover:opacity-100" onClick={() => setEdit(m)} title="Edit"><Pencil className="size-3.5" /></button>
              <button className="text-faint opacity-0 hover:text-bad group-hover:opacity-100" onClick={async () => setItems(await window.manul.memory.forget(m.name))} title="Delete"><Trash2 className="size-3.5" /></button>
            </div>
            <div className="text-xs text-dim">{m.description}</div>
            <div className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-faint" data-selectable>{m.body}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
