// Settings → Keys → Other providers: any OpenAI- or Anthropic-compatible endpoint (Azure AI Foundry, a company gateway,
// a local server) and the models it serves. Their models join the model picker once the key is set.
import { useEffect, useState } from 'react'
import { Download, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PROVIDER_APIS, type CustomProviderInfo, type ProviderApi } from '../../../shared/providers'

type State = Awaited<ReturnType<typeof window.agentshot.providers.list>>
type Form = { name: string; baseUrl: string; api: ProviderApi; keyHeader: string; models: string; key: string }
const EMPTY: Form = { name: '', baseUrl: '', api: 'openai-responses', keyHeader: '', models: '', key: '' }
const field = 'h-8 w-full rounded-lg border border-line bg-bg px-2.5 text-xs outline-none placeholder:text-faint focus:border-amber/60'

/** onKeyed: whether any custom provider has its key (it unlocks the editing agent). */
export function ProvidersSection({ onKeyed }: { onKeyed?: (keyed: boolean) => void }) {
  const [state, setState] = useState<State>({ providers: [], omp: false })
  const [editing, setEditing] = useState<string | null>(null) // provider id, or '' for a new one
  const [form, setForm] = useState<Form>(EMPTY)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  useEffect(() => { window.agentshot.providers.list().then(setState) }, [])
  useEffect(() => { onKeyed?.(state.providers.some(p => p.keySet)) }, [state, onKeyed])

  const edit = (p?: CustomProviderInfo) => {
    setError(''); setNote('')
    setEditing(p ? p.id : '')
    setForm(p ? { name: p.name, baseUrl: p.baseUrl, api: p.api, keyHeader: p.keyHeader || '', models: p.models.map(m => m.id).join(', '), key: '' } : EMPTY)
  }
  const save = async () => {
    try {
      const models = form.models.split(/[\s,]+/).filter(Boolean)
      const old = state.providers.find(p => p.id === editing)
      const keep = new Map((old?.models || []).map(m => [m.id, m]))
      setState(await window.agentshot.providers.save({ name: form.name, baseUrl: form.baseUrl, api: form.api, keyHeader: form.keyHeader, models: models.map(id => keep.get(id) || { id }) },
        form.key.trim() || undefined, editing || undefined))
      setEditing(null)
    } catch (e) { setError(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  const importOmp = async () => {
    try {
      const r = await window.agentshot.providers.importOmp()
      setState(r)
      setNote(r.added.length ? `Imported ${r.added.map(a => `${a.name} (${a.models} model${a.models === 1 ? '' : 's'}${a.key ? '' : ', add its key'})`).join(', ')}.` : 'omp has no custom providers to import.')
    } catch (e) { setNote(`Couldn't read omp's models.yml: ${(e as Error).message}`) }
  }
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))

  const formView = (
    <form className="mt-3 space-y-2" onSubmit={e => { e.preventDefault(); save() }}>
      <div className="grid grid-cols-2 gap-2">
        <input autoFocus className={field} placeholder="Name, e.g. Azure AI Foundry" value={form.name} onChange={set('name')} />
        <select className={field} value={form.api} onChange={set('api')} aria-label="API">
          {PROVIDER_APIS.map(a => <option key={a.api} value={a.api}>{a.label}</option>)}
        </select>
      </div>
      <input className={cn(field, 'font-mono')} placeholder="Base URL, e.g. https://….services.ai.azure.com/openai/v1" value={form.baseUrl} onChange={set('baseUrl')} />
      <input className={cn(field, 'font-mono')} placeholder="Model ids, comma separated: gpt-5.6-terra, gpt-5.6-luna" value={form.models} onChange={set('models')} />
      <div className="grid grid-cols-[1fr_140px] gap-2">
        <input type="password" className={cn(field, 'font-mono')} placeholder={editing && state.providers.find(p => p.id === editing)?.keySet ? 'Key (leave empty to keep the saved one)' : 'API key'} value={form.key} onChange={set('key')} />
        <input className={cn(field, 'font-mono')} placeholder="Key header (opt.)" title="Also send the key in this header. Azure needs api-key." value={form.keyHeader} onChange={set('keyHeader')} />
      </div>
      {error && <div className="text-xs text-bad">{error}</div>}
      <div className="flex gap-2">
        <Button size="md" variant="primary" type="submit">Save</Button>
        <Button size="md" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
      </div>
    </form>
  )

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex-1">
          <div className="text-xs font-medium text-dim">Other providers</div>
          <div className="text-[11px] text-faint">Any OpenAI- or Anthropic-compatible endpoint: Azure AI Foundry, a company gateway, a local server.</div>
        </div>
        {state.omp && <Button size="sm" variant="ghost" onClick={importOmp} title="Copy the providers and keys from ~/.omp/agent/models.yml"><Download className="size-3.5" />Import from omp</Button>}
        {editing !== '' && <Button size="sm" onClick={() => edit()}><Plus className="size-3.5" />Add</Button>}
      </div>
      {note && <div className="mb-2 text-xs text-dim">{note}</div>}
      <div className="space-y-2">
        {editing === '' && <div className="rounded-lg border border-line bg-raised/60 p-3">{formView}</div>}
        {state.providers.map(p => (
          <div key={p.id} className="rounded-lg border border-line bg-raised/60 p-3">
            <div className="flex items-center gap-3">
              <span className={cn('size-2 rounded-full', p.keySet ? 'bg-ok' : 'bg-line-strong')} title={p.keySet ? 'Key set' : 'No key yet'} />
              <Server className="size-3.5 text-faint" />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{p.name}</div>
                <div className="truncate text-xs text-faint">{p.models.map(m => m.name || m.id).join(' · ')}</div>
              </div>
              {editing !== p.id && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={async () => setState(await window.agentshot.providers.remove(p.id))}>Remove</Button>
                  <Button size="sm" onClick={() => edit(p)}>{p.keySet ? 'Edit' : 'Add key'}</Button>
                </div>
              )}
            </div>
            {editing === p.id && formView}
          </div>
        ))}
      </div>
    </div>
  )
}
