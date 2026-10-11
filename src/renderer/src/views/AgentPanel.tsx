// The conversation: not a chat log. The user's requests, the agent's short replies, one card per tool call
// (rendered by tool), question cards, and the input, anchored to whatever is selected on the film.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Message } from '@ag-ui/core'
import { ArrowUp, AudioLines, Plus, Check, ChevronRight, Sparkles, Clapperboard, Crosshair, Eye, FileSearch, Images, Loader2, MessageSquareText, ScanFace, ScanSearch, Users, Square, Terminal, TriangleAlert, Wrench, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { resultsOf, type AgentState } from '@/lib/agui'
import { ConsentCard, useConsents } from '@/components/ConsentStack'
import { ModelPicker } from '@/components/ModelPicker'
import { ManulCompanion } from '@/components/mascot/ManulCompanion'
import type { Project } from '../../../shared/types'
import { cn, timecode } from '@/lib/utils'
import type { Anchor } from '../../../shared/types'
import { splitAttached } from '../../../shared/attached'
import { chipGroups, FileIcon } from './FilesPanel'
import { insertMention, matches, mentionables, mentionAt, refChip, type Mention } from '@/lib/mentions'

type Call = { id: string; name: string; args: Record<string, any> }

const parse = (s: string) => { try { return JSON.parse(s) } catch { return {} } }

/** A shell command as a sentence: a script's first comment, the tool and its output, or the command's first line. */
export function shellTitle(command: string) {
  const c = command.trim()
  const lines = c.split('\n')
  const word = (lines[0].split(/\s+/)[0] || '').split('/').pop() || ''
  const script = /^(python3?|node|ruby|perl|bash|sh|zsh)$/.test(word) && lines.length > 1
  if (script) {
    const comment = lines.slice(1).map(l => /^\s*(?:#|\/\/)\s*(.{4,})$/.exec(l)?.[1]).find(Boolean)
    return comment ? comment.replace(/^let'?s\s+/i, '').replace(/^./, x => x.toUpperCase()) : `Ran a ${word.replace(/\d+$/, '')} script`
  }
  if (word === 'ffmpeg') { const out = lines[0].trim().split(/\s+/).at(-1) || ''; return /\.\w{2,4}$/.test(out) ? `Rendering ${out.split('/').pop()}` : 'Ran ffmpeg' }
  if (word === 'ffprobe') return 'Read file details'
  if (word === 'curl') { const host = /https?:\/\/([^/\s"']+)/.exec(c)?.[1]; return host ? `Called ${host}` : 'Made a web request' }
  if (word === 'bsk') return 'Used the browser'
  return lines[0].length > 64 ? `${lines[0].slice(0, 63)}…` : lines[0]
}

// ---------------------------------------------------------------- tool cards: one renderer per tool, a generic fallback
const code = (s: string) => <code className="block max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-faint" data-selectable>{s}</code>
const TOOL: Record<string, { icon: ReactNode; title: (a: Record<string, any>) => string; body?: (a: Record<string, any>) => ReactNode; detail?: (a: Record<string, any>) => ReactNode }> = {
  project_state: { icon: <Eye />, title: () => 'Looked at the project' },
  probe: { icon: <FileSearch />, title: a => `Read ${String(a.path || '').split('/').pop() || 'a file'}` },
  ffmpeg: {
    icon: <Clapperboard />,
    title: a => { const out = (a.args || []).at(-1); return out ? `Rendering ${String(out).split('/').pop()}` : 'Running ffmpeg' },
    body: a => <code className="block max-h-24 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-faint" data-selectable>ffmpeg {(a.args || []).join(' ')}</code>,
  },
  propose_version: { icon: <Check />, title: a => `Proposed “${a.title || 'a new cut'}”` },
  resolve_note: { icon: <MessageSquareText />, title: a => a.reply ? `Note: ${a.reply}` : 'Resolved a note' },
  create_clip: { icon: <Sparkles />, title: a => `Made clip “${a.title || a.id}”` },
  render_clip: { icon: <Sparkles />, title: a => `Re-rendered clip ${a.id}` },
  insert_clip: { icon: <Sparkles />, title: a => `Inserted ${a.id} at ${timecode(a.at || 0)}` },
  rerender_timeline: { icon: <Clapperboard />, title: () => 'Rendered the film' },
  transcript: { icon: <AudioLines />, title: a => a.search ? `Searched the transcript for “${a.search}”` : 'Read the transcript' },
  seek: { icon: <Crosshair />, title: a => `Showed you ${timecode(a.t || 0)}` },
  bash: { icon: <Terminal />, title: a => shellTitle(String(a.command || '')), detail: a => code(`$ ${a.command || ''}`) },
  analyze_video: { icon: <ScanSearch />, title: a => `Measured ${String(a.media || 'the video').split('/').pop()}: shots, shake, exposure, colour, sound` },
  speakers: { icon: <Users />, title: a => `Found who speaks when in ${String(a.media || 'the video').split('/').pop()}` },
  find_subjects: { icon: <ScanFace />, title: a => `Found the faces and subjects${a.aspect ? ` for ${a.aspect}` : ''}` },
  analyze_music: { icon: <AudioLines />, title: a => `Found the beat of ${String(a.media || 'the music').split('/').pop()}` },
  look: { icon: <Images />, title: a => a.image ? `Looked at ${String(a.image).split('/').pop()}` : `Looked at ${a.times?.length || a.count || 6} frames${a.box ? ' (zoomed in)' : ''}` },
  read: { icon: <FileSearch />, title: a => `Read ${String(a.path || '').split('/').pop()}` },
  write: { icon: <Wrench />, title: a => `Wrote ${String(a.path || '').split('/').pop()}` },
  edit: { icon: <Wrench />, title: a => `Edited ${String(a.path || '').split('/').pop()}` },
}

function ToolCard({ call, state, result }: { call: Call; state: 'streaming' | 'running' | 'done' | 'error'; result?: string }) {
  const t = TOOL[call.name] || { icon: <Wrench />, title: () => call.name.replace(/_/g, ' ') }
  const [open, setOpen] = useState(false)
  return (
    <div className={cn('rounded-lg bg-raised/70 text-xs', state === 'running' || state === 'streaming' ? 'beam' : state === 'error' && 'ring-1 ring-bad/40')}>
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className={cn('[&_svg]:size-3.5', state === 'error' ? 'text-bad' : 'text-dim')}>{state === 'running' || state === 'streaming' ? <Loader2 className="size-3.5 animate-spin text-amber" /> : t.icon}</span>
        <span className="flex-1 truncate text-fg/90">{t.title(call.args)}</span>
        {state === 'error' && <TriangleAlert className="size-3.5 text-bad" />}
      </button>
      {(t.body || (open && (result || t.detail))) && (
        <div className="space-y-1.5 px-2.5 pb-2">
          {t.body?.(call.args)}
          {open && t.detail?.(call.args)}
          {open && result && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10.5px] text-faint" data-selectable>{result}</pre>}
        </div>
      )}
    </div>
  )
}

type Opt = { label: string; description?: string }
type Question = { question: string; options: Opt[]; multiple?: boolean }

export const YOU_DECIDE = 'You decide: use your recommendations.'

/** The message a filled-in question card sends. */
export function askAnswer(qs: Question[], picks: string[][]) {
  if (qs.length === 1 && !qs[0].multiple) return picks[0][0] ?? YOU_DECIDE
  if (qs.length === 1) return picks[0].length ? `Apply: ${picks[0].join('; ')}` : 'None of these.'
  return qs.map((q, i) => `${q.question} → ${picks[i].length ? picks[i].join(', ') : 'none'}`).join('\n')
}

function AskCard({ call, answered, onAnswer }: { call: Call; answered: boolean; onAnswer: (s: string) => void }) {
  const qs: Question[] = call.args.questions?.length ? call.args.questions
    : [{ question: call.args.question, options: call.args.options || [], multiple: call.args.multiple }]
  const quick = qs.length === 1 && !qs[0].multiple // one plain question: a click answers it
  // single choice starts on the first (recommended) option; the fixes checklist starts all ticked
  const [picks, setPicks] = useState<string[][]>(() => qs.map(q => (q.multiple ? (qs.length === 1 ? q.options.map(o => o.label) : []) : q.options.slice(0, 1).map(o => o.label))))
  const pick = (qi: number, label: string) => setPicks(all => all.map((p, i) => {
    if (i !== qi) return p
    if (!qs[qi].multiple) return [label]
    return p.includes(label) ? p.filter(l => l !== label) : [...p, label]
  }))
  return (
    <div className="space-y-3 rounded-lg border border-amber/30 bg-amber-soft p-3">
      {qs.map((q, qi) => (
        <div key={qi}>
          <div className="mb-1.5 font-medium">{q.question}</div>
          {quick ? (
            <div className="flex flex-wrap gap-1.5">
              {q.options.map(o => (
                <Button key={o.label} size="sm" variant={answered ? 'ghost' : 'secondary'} disabled={answered} title={o.description} onClick={() => onAnswer(o.label)}>{o.label}</Button>
              ))}
            </div>
          ) : q.multiple ? (
            <div className="space-y-0.5">
              {q.options.map(o => (
                <label key={o.label} className={cn('flex gap-2 rounded-md px-1.5 py-1', !answered && 'cursor-pointer hover:bg-raised/60')}>
                  <input type="checkbox" className="mt-0.5 accent-[var(--color-amber)]" checked={picks[qi].includes(o.label)} disabled={answered} onChange={() => pick(qi, o.label)} />
                  <span className="min-w-0">
                    <span className="block text-fg/95">{o.label}</span>
                    {o.description && <span className="block text-xs text-dim">{o.description}</span>}
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5">
                {q.options.map(o => (
                  <Button key={o.label} size="sm" variant={picks[qi].includes(o.label) ? 'primary' : 'secondary'} disabled={answered} onClick={() => pick(qi, o.label)}>{o.label}</Button>
                ))}
              </div>
              {(() => { const d = q.options.find(o => picks[qi].includes(o.label))?.description; return d ? <div className="mt-1 text-xs text-dim">{d}</div> : null })()}
            </>
          )}
        </div>
      ))}
      {!answered && (
        <div className="flex flex-wrap items-center gap-1.5">
          {!quick && (
            <Button size="sm" variant="primary" disabled={qs.length === 1 && !picks[0].length} onClick={() => onAnswer(askAnswer(qs, picks))}>
              {qs.length === 1 ? `Apply ${picks[0].length === qs[0].options.length ? 'all' : picks[0].length}` : 'Go'}
            </Button>
          )}
          {!quick && qs.length === 1 && <Button size="sm" variant="ghost" onClick={() => onAnswer('None of these.')}>None</Button>}
          <Button size="sm" variant="ghost" onClick={() => onAnswer(YOU_DECIDE)}>You decide</Button>
          <span className="text-[11px] text-faint">or type your own answer below</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- runs of small steps, folded
/** Steps that only matter as progress: three or more in a row show as one row with the current step on it. */
const STEP = new Set(['bash', 'read', 'write', 'edit', 'probe'])
const isStep = (m: Message) => m.role === 'assistant' && !String(m.content ?? '').trim() && !!m.toolCalls?.length && m.toolCalls.every(c => STEP.has(c.function.name))

export function foldSteps(shown: Message[]) {
  const out: ({ kind: 'one'; m: Message; i: number } | { kind: 'steps'; ms: Message[]; i: number })[] = []
  for (let i = 0; i < shown.length; i++) {
    let j = i
    while (j < shown.length && isStep(shown[j])) j++
    const calls = shown.slice(i, j).reduce((n, m) => n + (m.role === 'assistant' ? m.toolCalls?.length || 0 : 0), 0)
    if (calls >= 3) { out.push({ kind: 'steps', ms: shown.slice(i, j), i }); i = j - 1 }
    else out.push({ kind: 'one', m: shown[i], i })
  }
  return out
}

function StepGroup({ ms, results, busy }: { ms: Message[]; results: ReturnType<typeof resultsOf>; busy: boolean }) {
  const [open, setOpen] = useState(false)
  const calls = ms.flatMap(m => (m.role === 'assistant' && m.toolCalls) || []).map(c => ({ id: c.id, name: c.function.name, args: parse(c.function.arguments) }))
  const state = (c: Call): 'running' | 'done' | 'error' => { const r = results[c.id]; return r ? (r.error ? 'error' : 'done') : busy ? 'running' : 'error' }
  const last = calls[calls.length - 1]
  const running = state(last) === 'running'
  const errors = calls.filter(c => state(c) === 'error').length
  const title = (c: Call) => (TOOL[c.name] || { title: () => c.name }).title(c.args)
  return (
    <div className={cn('rounded-lg bg-raised/70 text-xs', running && 'beam')}>
      <button className="flex w-full items-center gap-2 px-2.5 py-2 text-left" onClick={() => setOpen(!open)}>
        <span className="text-dim [&_svg]:size-3.5">{running ? <Loader2 className="animate-spin text-amber" /> : <Terminal />}</span>
        <span className="flex-1 truncate text-fg/90">{running ? title(last) : `${calls.length} steps · last: ${title(last)}`}</span>
        {errors > 0 && <span className="text-[10.5px] text-bad">{errors} failed</span>}
        <span className="text-[10.5px] text-faint tabular">{running ? `step ${calls.length}` : ''}</span>
        <ChevronRight className={cn('size-3.5 text-faint transition-transform', open && 'rotate-90')} />
      </button>
      {open && <div className="space-y-1 px-1.5 pb-1.5">{calls.map(c => <ToolCard key={c.id} call={c} result={results[c.id]?.content} state={state(c)} />)}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- the panel
const NOTE = /^\[note \S+ ([^\]]*)\] /
const EDITOR = /^\[editor\] /

function Item({ m, project, results, busy, onAnswer, laterUser }: { m: Message; project: Project; results: ReturnType<typeof resultsOf>; busy: boolean; onAnswer: (s: string) => void; laterUser: boolean }) {
  if (m.role === 'user') {
    const text = String(m.content ?? '')
    if (EDITOR.test(text)) return <div className="text-center text-[11px] text-faint">{text.replace(EDITOR, '')}</div>
    const note = NOTE.exec(text)
    const msg = splitAttached(text.replace(NOTE, ''))
    return (
      <div className="ml-auto w-fit max-w-[85%] rounded-2xl bg-raised px-4 py-2.5 text-[14px]" data-selectable>
        {note && <div className="mb-1 inline-flex items-center gap-1 rounded bg-note/15 px-1.5 py-0.5 text-[10.5px] text-note"><MessageSquareText className="size-3" />{note[1].replace(/^@ /, '').replace(/, box [\d.,]+/, ' · box').replace(/, clip (\S+) element (\S+)/, ' · $1 · $2')}</div>}
        {msg.text && <div className="whitespace-pre-wrap">{msg.text}</div>}
        {msg.files.length > 0 && (
          <div className={cn('flex flex-wrap gap-1', msg.text && 'mt-1.5')}>
            {chipGroups(msg.files).map(g => <FileChip key={g.rels[0]} {...chipOf(project, g)} title={g.rels.join('\n')} />)}
            {msg.more > 0 && <span className="px-1 text-[11px] text-faint">+{msg.more} more</span>}
          </div>
        )}
      </div>
    )
  }
  if (m.role === 'assistant') {
    return (
      <div className="space-y-1.5">
        {m.toolCalls?.map(c => {
          const call = { id: c.id, name: c.function.name, args: parse(c.function.arguments) }
          if (call.name === 'ask_user') return <AskCard key={c.id} call={call} answered={laterUser} onAnswer={onAnswer} />
          const r = results[c.id]
          return <ToolCard key={c.id} call={call} result={r?.content} state={r ? (r.error ? 'error' : 'done') : busy ? 'running' : 'error'} />
        })}
        {m.content && <div className="whitespace-pre-wrap font-serif text-[16px] leading-7 text-fg" data-selectable>{m.content}</div>}
      </div>
    )
  }
  return null
}

/** An attached file (or a folder's worth) in the input or a sent message. */
function FileChip({ label, kind, title, onRemove }: { label: string; kind: Parameters<typeof FileIcon>[0]['kind']; title?: string; onRemove?(): void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-[11px] text-dim" title={title}>
      <FileIcon kind={kind} className="size-3" />
      <span className="truncate">{label}</span>
      {onRemove && <button className="text-faint hover:text-fg" onClick={onRemove} aria-label={`Remove ${label}`}><X className="size-3" /></button>}
    </span>
  )
}

/** A chip's name and icon: a folder's worth, or one file, version or clip. */
const chipOf = (p: Project, g: { label: string; rels: string[] }) => (g.rels.length > 1 ? { label: g.label, kind: 'folder' as const } : refChip(p, g.rels[0]))

/** The list that opens on @ in the message box: what in the project matches the word typed after it. */
function MentionList({ items, query, pick, onPick, onHover }: { items: Mention[]; query: string; pick: number; onPick(m: Mention): void; onHover(i: number): void }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }) }, [pick])
  return (
    <div ref={list} role="listbox" aria-label="Files, versions and clips" data-mentions
      className="absolute inset-x-0 bottom-full z-50 mb-1 max-h-64 overflow-y-auto rounded-card border border-line bg-panel p-1 shadow-2xl shadow-shade">
      {items.length === 0 && <div className="px-2 py-1.5 text-xs text-faint">Nothing in the project called “{query}”</div>}
      {items.map((m, i) => (
        <div key={m.id} role="option" aria-selected={i === pick} title={m.id}
          onMouseDown={e => { e.preventDefault(); onPick(m) }} onMouseEnter={() => onHover(i)}
          className={cn('flex cursor-default items-center gap-2 rounded px-2 py-1', i === pick && 'bg-hover')}>
          <FileIcon kind={m.kind} className="text-dim" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{m.title}</span>
            <span className="block truncate text-[11px] text-faint">{m.detail}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

export function AgentPanel({ project, projectInfo, model, agent, anchor, onClearAnchor, attached = [], onAttach, onDetach, onAdd, onSend, onStop, ready, onKeys, inputRef, active = true }: {
  project: string
  projectInfo: Project
  model?: { provider: string; modelId: string }
  agent: AgentState
  active?: boolean
  anchor?: Anchor
  onClearAnchor(): void
  /** What's attached to the next message: files (paths in media/), versions (their renders), motion clips (clips/<id>). */
  attached?: string[]
  onAttach?(rels: string[]): void
  onDetach?(rels: string[]): void
  /** the + in the message box: add files to the project and attach them */
  onAdd?(): void
  onSend(text: string): void
  onStop(): void
  ready: boolean
  onKeys(): void
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}) {
  const [text, setText] = useState('')
  const consents = useConsents().filter(c => c.project === project)
  const scroller = useRef<HTMLDivElement>(null)
  const results = resultsOf(agent.messages)
  const shown = agent.messages.filter(m => m.role === 'user' || m.role === 'assistant')

  useEffect(() => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }) }, [agent.messages.length, agent.streaming?.text.length, Object.keys(agent.pending).length, consents.length])

  const submit = () => { const t = text.trim(); if (!t && !attached.length) return; onSend(t); setText('') }
  // @ in the message box: a list of the project's files, versions and clips; picking one attaches it
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [pick, setPick] = useState(0)
  const at = mentionAt(text, caret)
  const mentioning = at && at.start !== dismissed ? at : null
  const found = mentioning ? matches(mentionables(projectInfo), mentioning.query).slice(0, 50) : []
  useEffect(() => setPick(0), [mentioning?.query])
  // the caret goes after the picked name as the text changes (later, keys typed meanwhile would land before it)
  const placeCaret = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (placeCaret.current == null) return
    inputRef.current?.setSelectionRange(placeCaret.current, placeCaret.current)
    placeCaret.current = null
  }, [text, inputRef])
  const choose = (m: Mention) => {
    const next = insertMention(text, mentioning!, m)
    placeCaret.current = next.caret
    setText(next.text)
    setCaret(next.caret)
    onAttach?.([m.id])
  }
  const anchorLabel = anchor && (anchor.clip?.element ? `${anchor.clip.id} · ${anchor.clip.element}`
    : `${timecode(anchor.t0)}${anchor.t1 != null ? `–${timecode(anchor.t1)}` : ''}${anchor.box ? ' · box' : ''}`)

  // the conversation is the page: one centred column, the replies set for reading
  const col = 'mx-auto w-full max-w-[760px] px-6'
  const empty = shown.length === 0 && !agent.busy
  const box = !ready ? (
    <button onClick={onKeys} className="w-full rounded-2xl border border-dashed border-amber/50 px-3 py-3 text-amber hover:bg-amber-soft">Add an API key to start editing</button>
  ) : (
    <div className={cn('rounded-2xl border bg-surface shadow-[0_1px_2px_var(--color-shade),0_6px_24px_-14px_var(--color-shade)] transition-colors focus-within:border-line-strong', anchor ? 'border-amber/50' : 'border-line')}>
      {attached.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-2.5">
          {chipGroups(attached).map(g => (
            <FileChip key={g.rels[0]} {...chipOf(projectInfo, g)}
              title={g.rels.map(r => `${r}${projectInfo.files?.[r] ? ` — ${projectInfo.files[r].summary}` : ''}`).join('\n')}
              onRemove={() => onDetach?.(g.rels)} />
          ))}
        </div>
      )}
      {anchor && (
        <div className="flex items-center gap-1.5 px-3 pt-2.5">
          <span className="inline-flex items-center gap-1 rounded bg-amber-soft px-1.5 py-0.5 text-[11px] text-amber"><MessageSquareText className="size-3" />Note at {anchorLabel}</span>
          <button className="text-faint hover:text-fg" onClick={onClearAnchor}><X className="size-3" /></button>
        </div>
      )}
      <div className="relative px-1.5 pt-1.5">
        {mentioning && <MentionList items={found} query={mentioning.query} pick={pick} onPick={choose} onHover={setPick} />}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          aria-autocomplete="list"
          aria-expanded={!!mentioning}
          onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart) }}
          onSelect={e => setCaret(e.currentTarget.selectionStart)}
          onBlur={() => setDismissed(at?.start ?? null)}
          onFocus={() => setDismissed(null)}
          onKeyDown={e => {
            if (mentioning) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setPick(i => (found.length ? (i + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length : 0)); return }
              if ((e.key === 'Enter' || e.key === 'Tab') && found[pick]) { e.preventDefault(); choose(found[pick]); return }
              if (e.key === 'Escape') { e.preventDefault(); setDismissed(mentioning.start); return }
            }
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            if (e.key === 'Escape') { (e.target as HTMLTextAreaElement).blur(); onClearAnchor() }
          }}
          placeholder={anchor ? 'What should change here?' : attached.length ? 'What should Manul do with these?' : agent.busy ? 'Steer the edit…' : 'Ask for an edit, or @ a file, version or clip…'}
          className="max-h-60 min-h-12 w-full resize-none bg-transparent px-1.5 py-1.5 text-[15px] outline-none placeholder:text-faint [field-sizing:content]"
        />
      </div>
      <div className="flex items-center gap-1 px-1.5 pb-1.5">
        {onAdd && <button onClick={onAdd} title="Add files" aria-label="Add files" className="flex size-7 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg"><Plus className="size-4" /></button>}
        <span className="flex-1" />
        {agent.cost > 0 && <span className="px-1 text-[11px] text-faint tabular" title="Spent on AI in this project">${agent.cost.toFixed(agent.cost < 1 ? 3 : 2)}</span>}
        <ModelPicker dir={project} picked={model} />
        {agent.busy && !text && !attached.length ? (
          <Button size="iconSm" variant="secondary" className="rounded-lg" onClick={onStop} title="Stop"><Square className="size-3 fill-current" /></Button>
        ) : (
          <Button size="iconSm" variant="primary" className="rounded-lg" disabled={!text.trim() && !attached.length} onClick={submit} aria-label="Send"><ArrowUp /></Button>
        )}
      </div>
    </div>
  )

  return (
    <div className="flex h-full flex-col">
      <div ref={scroller} className="flex-1 overflow-y-auto">
        <div className={cn(col, 'space-y-5 pb-8 pt-3')}>
        {empty && (
          <div className="pt-[14vh] text-center">
            <ManulCompanion agent={agent} needsConsent={consents.length > 0} active={active} hero />
            <h2 className="font-serif text-[30px] font-normal tracking-[-0.01em]">What should change?</h2>
            <p className="mx-auto mt-2 max-w-[460px] text-dim">Say it in your own words. To point at a moment, press <Kbd>N</Kbd> on the film, drag across the timeline, or <Kbd>B</Kbd> to box part of the picture.</p>
          </div>
        )}
        {foldSteps(shown).map(b => b.kind === 'steps'
          ? <StepGroup key={b.ms[0].id} ms={b.ms} results={results} busy={agent.busy} />
          : <Item key={b.m.id} m={b.m} project={projectInfo} results={results} busy={agent.busy} onAnswer={onSend} laterUser={shown.slice(b.i + 1).some(x => x.role === 'user')} />)}
        {Object.entries(agent.pending).map(([id, p]) => <ToolCard key={id} call={{ id, name: p.name, args: parse(p.args) }} state="streaming" />)}
        {agent.streaming?.text && <div className="whitespace-pre-wrap font-serif text-[16px] leading-7 text-fg">{agent.streaming.text}</div>}
        {consents.map(c => <ConsentCard key={c.id} c={c} />)}
        {agent.error && (
          <div className="flex gap-2 rounded-lg border border-bad/30 bg-bad/10 p-2.5 text-xs text-bad"><TriangleAlert className="mt-px size-3.5 shrink-0" /><span data-selectable>{agent.error}</span></div>
        )}
        </div>
      </div>

      <div className={cn(col, 'pb-5')}>
        {!empty && <ManulCompanion agent={agent} needsConsent={consents.length > 0} active={active} />}
        {box}
      </div>
    </div>
  )
}
