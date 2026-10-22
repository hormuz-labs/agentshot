// The model dropdown in new-project drafts and the agent panel: every model the keys unlock. In existing projects
// with only the Manul key it's just a label: Manul's gateway picks the model.
import { useEffect, useMemo, useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Image as ImageIcon, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

type Info = Awaited<ReturnType<typeof window.manul.agent.models>>

const k = (n?: number) => (n == null ? '' : n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`)

export function ModelPicker({ dir, picked, onPick, disabled = false }: {
  dir?: string
  picked?: { provider: string; modelId: string }
  /** A new-project draft chooses locally; an existing project persists its choice through IPC. */
  onPick?(model: { provider: string; modelId: string } | undefined): void
  disabled?: boolean
}) {
  const [info, setInfo] = useState<Info | null>(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let live = true
    const refresh = () => window.manul.agent.models(dir).then(value => { if (live) { setInfo(value); setError('') } }).catch(() => { if (live) setError('Could not load models. Try reopening the dropdown.') })
    refresh()
    const off = window.manul.agent.onReady(refresh)
    return () => { live = false; off() }
  }, [dir, picked?.provider, picked?.modelId, open])
  const list = useMemo(() => (info?.models || []).filter(m => !q || `${m.name} ${m.providerLabel}`.toLowerCase().includes(q.toLowerCase())), [info, q])
  if (dir && !info?.current) return null
  const current = onPick ? picked ?? info?.current : info?.current
  const cur = info?.models.find(m => m.provider === current?.provider && m.modelId === current?.modelId)
  // only the Manul key: the gateway picks the model, there's nothing to choose
  if (dir && info?.models.length === 1 && info.current?.provider === 'manul') return <span className="inline-flex h-6 items-center px-1.5 text-[11px] text-dim" title="Manul picks the model">{cur?.name || 'Manul'}</span>
  const choose = async (m: { provider: string; modelId: string } | null) => {
    if (disabled) return
    if (onPick) { onPick(m ?? undefined); setOpen(false); setQ(''); return }
    if (!dir) return
    try { await window.manul.agent.setModel(dir, m); setOpen(false); setQ(''); setInfo(await window.manul.agent.models(dir)); setError('') }
    catch { setError('Could not change the model. Please try again.') }
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger type="button" disabled={disabled} aria-label={dir ? 'Choose project model' : 'Choose model for new project'} className="inline-flex h-6 max-w-[150px] items-center gap-1 rounded-md px-1.5 text-[11px] text-dim hover:bg-hover hover:text-fg disabled:opacity-50" title={dir ? 'Model for this project' : 'Model for your new project'}>
        <span className="truncate">{cur?.name || current?.modelId || 'Choose model'}</span><ChevronDown className="size-3 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-80 rounded-card border border-line bg-panel shadow-2xl shadow-shade">
          <div className="flex items-center gap-2 bg-bg/40 px-3 py-2">
            <Search className="size-3.5 text-faint" />
            <input autoFocus aria-label="Find a model" value={q} onChange={e => setQ(e.target.value)} placeholder="Find a model" className="h-6 flex-1 bg-transparent text-xs outline-none placeholder:text-faint" />
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            <button type="button" disabled={disabled} onClick={() => choose(null)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-dim hover:bg-hover hover:text-fg">
              <span className="flex-1">Best available (automatic)</span>{!picked && <Check className="size-3.5 text-amber" />}
            </button>
            {list.map(m => {
              const on = !!picked && picked.provider === m.provider && picked.modelId === m.modelId
              return (
                <button type="button" disabled={disabled} aria-pressed={on} key={`${m.provider}/${m.modelId}`} onClick={() => choose({ provider: m.provider, modelId: m.modelId })}
                  className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-hover', on && 'bg-raised')}>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs text-fg">{m.name}</div>
                    <div className="text-[10.5px] text-faint">{m.providerLabel}{m.context ? ` · ${k(m.context)} context` : ''}{m.price ? ` · $${m.price.input}/$${m.price.output} per M` : ''}</div>
                  </div>
                  {m.images && <ImageIcon className="size-3 text-faint" aria-label="sees images" />}
                  {on && <Check className="size-3.5 text-amber" />}
                </button>
              )
            })}
            {error ? <p role="alert" className="px-2 py-2 text-xs text-bad">{error}</p> : !info ? <p role="status" className="px-2 py-2 text-xs text-faint">Loading models…</p> : !info.models.length ? <p className="px-2 py-2 text-xs text-faint">Add an API key in Settings → Keys to choose a model.</p> : !list.length ? <p className="px-2 py-2 text-xs text-faint">No models match your search.</p> : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
