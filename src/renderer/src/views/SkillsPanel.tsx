// Skills: how Manul does each kind of work, built into the app. Switch them on per profile.
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/ui/panel-header'
import { cn } from '@/lib/utils'

type State = Awaited<ReturnType<typeof window.manul.skills.state>>

export function SkillsPanel() {
  const [st, setSt] = useState<State | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  useEffect(() => { window.manul.skills.state().then(setSt) }, [])
  if (!st) return null
  return (
    <div>
      <PanelHeader title="Skills" description="How Manul does each kind of work, built into the app and updated with it. Manul reads a skill before the work it covers; when you correct it for good, it remembers (Memory)." />
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xs text-dim">Profile</span>
        <select value={st.profile.id} onChange={async e => setSt(await window.manul.skills.useProfile(e.target.value))}
          className="h-7 rounded-md border border-line bg-bg px-1.5 text-xs outline-none">
          {st.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {naming == null
          ? <Button size="sm" variant="ghost" onClick={() => setNaming('')}><Plus />New profile</Button>
          : <form className="flex gap-1" onSubmit={async e => { e.preventDefault(); if (naming.trim()) { setSt(await window.manul.skills.newProfile(naming.trim())); setNaming(null) } }}>
              <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder="e.g. Podcasts" className="h-7 rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-amber/60" />
              <Button size="sm" type="submit">Create</Button>
            </form>}
      </div>
      <div className="space-y-1.5">
        {st.skills.map(k => {
          const on = st.enabled.includes(k.id)
          return (
            <div key={k.id} className="flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
              <button role="switch" aria-checked={on} title={on ? 'On' : 'Off'} onClick={async () => setSt(await window.manul.skills.enable(k.id, !on))}
                className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-amber' : 'bg-line-strong')}>
                <span className={cn('block size-3 rounded-full bg-bg transition-transform', on && 'translate-x-3')} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{k.name}</div>
                <p className="mt-0.5 text-xs leading-relaxed text-dim">{k.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
