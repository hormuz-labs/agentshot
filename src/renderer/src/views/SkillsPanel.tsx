// Skills: how AgentShot does each kind of work. The built-in ones come with the app; a person adds their own to say how
// they want their videos made. Each is switched on per profile.
import { useEffect, useState } from 'react'
import { Pencil, PenLine, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/ui/panel-header'
import { cn } from '@/lib/utils'

type State = Awaited<ReturnType<typeof window.agentshot.skills.state>>
type Skill = State['skills'][number]
type Draft = { id?: string; name: string; description: string; body: string }

// the limits the app keeps (src/main/skills.ts): shown before they are hit, not only as an error after
const MOST = { name: 60, description: 400, body: 20_000 }
const said = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
const field = 'w-full rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-amber/60'

function Switch({ on, onChange }: { on: boolean; onChange(on: boolean): void }) {
  return (
    <button role="switch" aria-checked={on} title={on ? 'On' : 'Off'} onClick={() => onChange(!on)}
      className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-amber' : 'bg-line-strong')}>
      <span className={cn('block size-3 rounded-full bg-bg transition-transform', on && 'translate-x-3')} />
    </button>
  )
}

/** Writing a skill, or changing one: its name, when it applies, and what to do. */
function Editor({ start, onDone, onCancel }: { start: Draft; onDone(st: State): void; onCancel(): void }) {
  const [d, setD] = useState(start)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const change = (patch: Partial<Draft>) => { setD({ ...d, ...patch }); setError(null) }
  const run = async (what: () => Promise<State>) => {
    setBusy(true)
    try { onDone(await what()) } catch (e) { setError(said(e)); setBusy(false) }
  }
  const over = d.body.length > MOST.body
  return (
    <form data-skill-editor className="mb-5 space-y-3 rounded-lg border border-amber/30 bg-raised/60 p-3"
      onSubmit={e => { e.preventDefault(); run(() => window.agentshot.skills.save(d)) }}>
      <div className="font-medium">{d.id ? 'Change this skill' : 'A new skill of your own'}</div>
      <label className="block">
        <span className="mb-1 block text-xs text-dim">Name</span>
        <input autoFocus name="name" value={d.name} maxLength={MOST.name} onChange={e => change({ name: e.target.value })} placeholder="My podcast style" className={cn(field, 'h-8')} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-dim">When to use it</span>
        <input name="description" value={d.description} maxLength={MOST.description} onChange={e => change({ description: e.target.value })} placeholder="Editing episodes of my podcast" className={cn(field, 'h-8')} />
        <span className="mt-1 block text-[11px] leading-relaxed text-faint">AgentShot reads this one line to decide whether the skill applies, so say what kind of video or request it is for.</span>
      </label>
      <label className="block">
        <span className="mb-1 block text-xs text-dim">What to do</span>
        <textarea name="body" value={d.body} onChange={e => change({ body: e.target.value })} rows={7} data-selectable
          placeholder={'- Open on the strongest line, never on the intro.\n- Cut every “um” and any pause over a second.\n- Captions: white, bold, two lines at most, never over a face.\n- Keep the laughs, even when they run long.\n- End on the call to action, then one second of black.'}
          className={cn(field, 'resize-y py-2 leading-relaxed')} />
        <span className={cn('mt-1 block text-[11px] leading-relaxed', over ? 'text-bad' : 'text-faint')}>
          {over
            ? `That is ${(d.body.length - MOST.body).toLocaleString('en-US')} characters more than AgentShot can keep in mind at once. Split it into two skills.`
            : 'Plain words, as you’d brief an editor. Where this and a built-in skill disagree, yours wins.'}
        </span>
      </label>
      {error && <p className="text-xs text-bad" role="alert" data-selectable>{error}</p>}
      <div className="flex items-center gap-1.5">
        {d.id && (deleting
          ? <>
              <span className="text-xs text-dim">Delete this skill for good?</span>
              <Button size="sm" variant="danger" type="button" disabled={busy} onClick={() => run(() => window.agentshot.skills.remove(d.id!))}>Delete</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setDeleting(false)}>Keep it</Button>
            </>
          : <Button size="sm" variant="ghost" type="button" onClick={() => setDeleting(true)}><Trash2 />Delete</Button>)}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" type="button" onClick={onCancel}>Cancel</Button>
        <Button size="sm" variant="primary" type="submit" disabled={busy || over}>{d.id ? 'Save changes' : 'Save skill'}</Button>
      </div>
    </form>
  )
}

function Row({ k, on, onSwitch, onEdit }: { k: Skill; on: boolean; onSwitch(on: boolean): void; onEdit?(): void }) {
  return (
    <div data-skill={k.id} data-own={k.own ? '' : undefined} className="group flex items-start gap-3 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
      <Switch on={on} onChange={onSwitch} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{k.name}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-dim">{k.description}</p>
      </div>
      {onEdit && <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Change ${k.name}`}><Pencil />Edit</Button>}
    </div>
  )
}

export function SkillsPanel() {
  const [st, setSt] = useState<State | null>(null)
  const [naming, setNaming] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { window.agentshot.skills.state().then(setSt) }, [])
  if (!st) return null
  const mine = st.skills.filter(k => k.own), builtIn = st.skills.filter(k => !k.own)
  const flip = async (k: Skill, on: boolean) => setSt(await window.agentshot.skills.enable(k.id, on))
  const edit = async (k: Skill) => {
    setError(null)
    try { setDraft(await window.agentshot.skills.own(k.id)) } catch (e) { setError(said(e)); setSt(await window.agentshot.skills.state()) }
  }
  const heading = 'text-xs font-medium uppercase tracking-wider text-faint'
  return (
    <div>
      <PanelHeader title="Skills" description="How AgentShot does each kind of work. Yours say how you want your own videos made; the built-in ones come with the app and are updated with it. AgentShot reads a skill before the work it covers." />
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs text-dim">Profile</span>
        <select value={st.profile.id} onChange={async e => setSt(await window.agentshot.skills.useProfile(e.target.value))}
          className="h-7 rounded-md border border-line bg-bg px-1.5 text-xs outline-none">
          {st.profiles.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {naming == null
          ? <Button size="sm" variant="ghost" onClick={() => setNaming('')}><Plus />New profile</Button>
          : <form className="flex gap-1" onSubmit={async e => { e.preventDefault(); if (naming.trim()) { setSt(await window.agentshot.skills.newProfile(naming.trim())); setNaming(null) } }}>
              <input autoFocus value={naming} onChange={e => setNaming(e.target.value)} placeholder="e.g. Podcasts" className="h-7 rounded-md border border-line bg-bg px-2 text-xs outline-none focus:border-amber/60" />
              <Button size="sm" type="submit">Create</Button>
            </form>}
      </div>

      <div className="mb-2 flex items-center">
        <span className={cn(heading, 'flex-1')}>Yours</span>
        {!draft && mine.length > 0 && <Button size="sm" onClick={() => setDraft({ name: '', description: '', body: '' })}><Plus />New skill</Button>}
      </div>
      {error && <p className="mb-2 text-xs text-bad" role="alert" data-selectable>{error}</p>}
      {draft
        ? <Editor key={draft.id || 'new'} start={draft} onCancel={() => setDraft(null)} onDone={next => { setSt(next); setDraft(null) }} />
        : mine.length === 0
          ? (
            <div data-own-empty className="mb-5 rounded-lg border border-dashed border-line p-5 text-center">
              <PenLine className="mx-auto mb-2 size-5 text-dim" />
              <p className="mx-auto max-w-sm text-dim">Tell AgentShot once how you like your videos made (your pacing, your captions, what to always cut) and it follows that every time.</p>
              <Button size="sm" variant="primary" className="mt-3" onClick={() => setDraft({ name: '', description: '', body: '' })}><Plus />Write your first skill</Button>
            </div>
            )
          : <div className="mb-5 space-y-1.5">{mine.map(k => <Row key={k.id} k={k} on={st.enabled.includes(k.id)} onSwitch={on => flip(k, on)} onEdit={() => edit(k)} />)}</div>}

      <div className={cn(heading, 'mb-2')}>Built in</div>
      <div className="space-y-1.5">
        {builtIn.map(k => <Row key={k.id} k={k} on={st.enabled.includes(k.id)} onSwitch={on => flip(k, on)} />)}
      </div>
    </div>
  )
}
