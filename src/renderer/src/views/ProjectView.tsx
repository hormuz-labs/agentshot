// A project on screen: the conversation first, the film beside it (the proposal to decide on, the picture, the timeline).
// Point at the film (a box, a range, N for the moment) and say what should change, right there or in the chat.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Clapperboard, Globe, MessagesSquare, PanelRight, Loader2, Upload, Check, FolderOpen, MessageSquarePlus, Pause, Play, SquareDashed, X } from 'lucide-react'
import { JobsTray } from '@/components/JobsTray'
import { HistoryButton } from '@/components/HistoryButton'
import { Conversations } from '@/components/Conversations'
import { InlineAsk } from '@/components/InlineAsk'
import { useCommands } from '@/lib/commands'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { paneStyle, Resizer, useWidth } from '@/components/ui/resizer'
import { Kbd } from '@/components/ui/kbd'
import { useAgent } from '@/lib/agui'
import { addFiles, attachFiles, clearAttached, detachFiles, pickFiles, useAttached } from '@/lib/attach'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { AgentPanel } from './AgentPanel'
import { BrowserPanel } from './BrowserPanel'
import { EditStatus } from './EditStatus'
import { ClipEditor } from './ClipEditor'
import { ExportDialog } from './ExportDialog'
import { useLiveMix, type MixSource } from '@/lib/liveMix'
import { dbToGain, type Mix } from '../../../shared/mix'
import { needsProxy } from '../../../shared/proxy'
import { sameCut, timelineOfFile, type Edit } from '../../../shared/timeline'
import { Scrubber } from './Scrubber'
import { Stage, type LiveEdit, type StageHandle } from './Stage'
import type { Anchor, Box, Project } from '../../../shared/types'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function ProjectView({ initial, firstPrompt, firstFiles, onKeys, ready, active = true, lead }: { initial: Project; firstPrompt?: string; firstFiles?: string[]; onKeys(): void; ready: boolean; active?: boolean; lead?: ReactNode }) {
  const [p, setP] = useState(initial)
  const agent = useAgent(p.dir)
  const stage = useRef<StageHandle>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  // files attached to the next message: ones just added, or picked in the sidebar's tree
  const attached = useAttached(p.dir)
  useEffect(() => { if (firstFiles?.length) attachFiles(p.dir, firstFiles) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const [drawing, setDrawing] = useState(false)
  const [compare, setCompare] = useState<'after' | 'before'>('after')
  const [over, setOver] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [source, setSource] = useState<MixSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [regions, setRegions] = useState<[number, number][]>([])
  // a motion clip open on the picture, to adjust or point at one of its elements
  const [editing, setEditing] = useState<{ itemId: string; clip: string; start: number } | null>(null)
  const sentFirst = useRef(false)
  const [browsing, setBrowsing] = useState(false)
  // the film beside the chat: as wide as the row allows while the conversation keeps 320 px
  const chatRow = useRef<HTMLDivElement>(null)
  const previewW = useWidth('manul.width.preview', 640, 360, () => (chatRow.current?.clientWidth ?? window.innerWidth) - 320)
  // the film shown beside the conversation, or the conversation alone
  const [preview, setPreview] = useState(() => localStorage.getItem('manul.preview') !== '0')
  useEffect(() => { try { localStorage.setItem('manul.preview', preview ? '1' : '0') } catch { /* private mode */ } }, [preview])
  useEffect(() => { if (browsing) setPreview(true) }, [browsing])
  // a proposal to look at brings the film back
  useEffect(() => { if (p.proposal) setPreview(true) }, [p.proposal])
  // the conversation snapped shut: the film takes the window (never both shut)
  const [chatShut, setChatShut] = useState(false)
  useEffect(() => { if (!preview) setChatShut(false) }, [preview])
  /** Put the cursor in the message box, opening the conversation first if it's shut. */
  const ask = () => { setChatShut(false); setTimeout(() => input.current?.focus(), 0) }
  // A message box at the selection itself (the box on the picture, the range or moment on the timeline): instructions
  // go from there without opening the chat.
  const [inline, setInline] = useState(false)
  useEffect(() => { if (!anchor) setInline(false) }, [anchor])
  // the agent opened or focused a browser window: show it (in the project on screen)
  useEffect(() => window.manul.browser.onReveal(() => { if (active) setBrowsing(true) }), [active])

  useEffect(() => window.manul.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => window.manul.onSeek((dir, t) => { if (dir === p.dir && stage.current?.video) stage.current.video.currentTime = t }), [p.dir])
  useEffect(() => { if (p.proposal) setCompare('after') }, [p.proposal])

  const send = useCallback(async (text: string) => {
    const a = anchor
    const still = a ? stage.current?.still(a.box) : undefined
    const files = attached
    setAnchor(undefined)
    setDrawing(false)
    clearAttached(p.dir)
    await window.manul.agent.send(p.dir, { text, anchor: a, still, files }).catch(e => alert((e as Error).message))
  }, [anchor, attached, p.dir])

  // the request typed on the start screen goes out once the project is open
  useEffect(() => {
    if (firstPrompt && ready && !sentFirst.current) { sentFirst.current = true; send(firstPrompt) }
  }, [firstPrompt, ready, send])

  const seek = (t: number) => { const v = stage.current?.video; if (v) v.currentTime = t; setTime(t) }
  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); setInline(true) }
  const playPause = () => { const v = stage.current?.video; if (v) v.paused ? v.play() : v.pause() }

  // keyboard: Space play/pause · N note · B box · ←/→ ±1 s (⇧ ±5 s) · Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || (e.target as HTMLElement).closest('textarea, input')) return
      const v = stage.current?.video
      if (e.key === ' ') { e.preventDefault(); playPause() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); noteHere() }
      else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); v?.pause(); setDrawing(d => !d) }
      else if (e.key === 'ArrowLeft' && v) seek(Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)))
      else if (e.key === 'ArrowRight' && v) seek(Math.min(duration, v.currentTime + (e.shiftKey ? 5 : 1)))
      else if (e.key === 'Escape') { setAnchor(undefined); setDrawing(false); setEditing(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  // a background project stops playing and leaves the menu, palette and keys to the one on screen
  useEffect(() => { if (!active) stage.current?.video?.pause() }, [active])

  const current = p.versions.find(v => v.id === p.current)!
  const proposal = p.proposal ? p.versions.find(v => v.id === p.proposal) : undefined
  const onScreen = proposal && compare === 'after' ? proposal : current
  // The edit (p.timeline) changed since the version on screen was rendered (the agent can leave it so): it plays from
  // its pieces until it's saved as a version.
  const tl = p.timeline!
  const edited = useMemo(() => !sameCut(tl, current.timeline ?? (p.media[current.path] ? timelineOfFile(current.path, p.media[current.path]) : tl)), [tl, current, p.media])
  const live = edited && onScreen === current
  // what the timeline shows: the edit, or the proposal's pieces while it is on screen
  const track = onScreen === current ? tl : onScreen.timeline ?? timelineOfFile(onScreen.path, p.media[onScreen.path])
  const liveEdit = useMemo<LiveEdit | null>(() => !live ? null : {
    pieces: tl.items.map(it => it.kind === 'media'
      ? { id: it.id, url: mediaUrl(`${p.dir}/${p.proxies?.[it.src] || it.src}`), in: it.in, out: it.out, gain: it.muted ? 0 : dbToGain(it.db || 0) }
      : { id: it.id, url: `${mediaUrl(`${p.dir}/${p.clips?.[it.clip]?.video}`)}?v=${p.clips?.[it.clip]?.updatedAt}`, in: 0, out: it.dur, gain: 0 }),
    fps: tl.fps, width: tl.width, height: tl.height,
    overlays: (tl.overlays || []).filter(o => p.clips?.[o.clip]).map(o => ({ id: o.id, url: `${mediaUrl(`${p.dir}/clips/${o.clip}/clip.html`)}?v=${p.clips![o.clip].updatedAt}`, start: o.start, dur: o.dur })),
  }, [live, tl, p.dir, p.proxies, p.clips])
  // the mix the version on screen was rendered with (or the edit's), heard live over its dry film
  const mix: Mix = (live ? tl.mix : onScreen.timeline?.mix) || { filmDb: 0 }
  const speechKey = live ? JSON.stringify(tl.items) : onScreen.id
  useEffect(() => { window.manul.mix.speech(p.dir, live ? 'edit' : onScreen.id).then(setRegions).catch(() => setRegions([])) }, [p.dir, speechKey, p.transcripts]) // eslint-disable-line react-hooks/exhaustive-deps
  useLiveMix(source, p.dir, mix, regions)

  /** Change the edit by hand (a piece moved, footage dropped in): it plays at once, ⌘Z undoes it. */
  const doEdit = async (edits: Edit[], then?: number) => {
    try { setP(await window.manul.timeline.edit(p.dir, edits)); if (then != null) seek(then) } catch (e) { alert(clean(e)) }
  }
  const insertFootage = (rel: string, t: number) => {
    const m = p.media[rel]
    if (!m?.width || !(m.duration > 0)) return alert(`${rel.split('/').pop()} isn't footage that can go in the film.`)
    doEdit([{ op: 'insert', at: t, src: rel, in: 0, out: Math.round(m.duration * 1000) / 1000 }], t)
  }
  const undoEdit = async (redo: boolean) => { try { setP(await window.manul.timeline.undo(p.dir, redo)) } catch (e) { alert(clean(e)) } }
  const saveVersion = async () => {
    setSaving(true)
    try { await window.manul.timeline.render(p.dir) } catch (e) { alert(clean(e)) } finally { setSaving(false) }
  }
  // the menu and palette run these with what is on screen now
  const act = useRef({ undoEdit, saveVersion, edited })
  act.current = { undoEdit, saveVersion, edited }
  useCommands(!active ? [] : [
    { id: 'export', title: 'Export…', keywords: 'save render mp4 vertical shorts captions srt', shortcut: `${mod}E`, run: () => setExporting(true) },
    { id: 'media', title: 'Add files…', keywords: 'import media footage image audio music logo subtitles srt vtt font lut folder zip', shortcut: `${mod}I`, run: () => pickFiles(p.dir) },
    { id: 'reveal', title: 'Show project in Finder', keywords: 'folder files', run: () => window.manul.project.reveal(p.dir) },
    { id: 'history', title: 'History', keywords: 'undo restore versions', run: () => setHistoryOpen(true) },
    { id: 'note', title: 'Add a note at the playhead', shortcut: 'N', run: () => noteHere() },
    { id: 'box', title: 'Draw a box on the picture', shortcut: 'B', run: () => { stage.current?.video?.pause(); setDrawing(true) } },
    { id: 'play', title: 'Play or pause', shortcut: 'Space', run: playPause },
    { id: 'agent.new', title: 'New conversation', run: () => window.manul.agent.newConversation(p.dir) },
    { id: 'agent.focus', title: 'Ask Manul', shortcut: `${mod}L`, run: () => ask() },
    { id: 'agent.panel', title: 'Show or hide the conversation', keywords: 'chat collapse film', run: () => { setChatShut(x => !x); setPreview(true) } },
    { id: 'agent.stop', title: 'Stop the agent', run: () => window.manul.agent.stop(p.dir) },
    { id: 'browser', title: 'Show or hide the browser', keywords: 'web internet bsk sign in google youtube', shortcut: `${mod}⇧B`, run: () => setBrowsing(x => !x) },
    { id: 'timeline.undo', title: 'Undo an edit', keywords: 'timeline back', shortcut: `${mod}Z`, run: () => act.current.undoEdit(false) },
    { id: 'timeline.redo', title: 'Redo an edit', keywords: 'timeline', shortcut: `⇧${mod}Z`, run: () => act.current.undoEdit(true) },
    { id: 'timeline.render', title: 'Save the edit as a version', keywords: 'render timeline', run: () => { if (act.current.edited) act.current.saveVersion() } },
  ], [p.dir, active])
  const playable = onScreen.dry || onScreen.path
  const decide = async (accept: boolean) => setP(await window.manul.project.decide(p.dir, accept))

  const anchorLabel = anchor && `${timecode(anchor.t0)}${anchor.t1 != null ? `–${timecode(anchor.t1)}` : ''}${anchor.box ? ' · box' : ''}`
  const inlineAsk = inline && anchor ? (
    <InlineAsk label={anchorLabel!} onSend={text => { setInline(false); send(text) }}
      onCancel={() => { setInline(false); setAnchor(undefined); setDrawing(false) }} />
  ) : null

  /** The film's column: the proposal to decide on, the picture, the timeline, and the transport. */
  const film = (
    <div
      className={cn('relative flex min-w-0 flex-col gap-2 bg-canvas p-3', chatShut ? 'flex-1 min-w-[360px]' : 'shrink-0 border-l border-line', over && 'bg-amber-soft')}
      style={chatShut ? undefined : paneStyle(previewW)}
    >
      <Resizer pane={previewW} edge="left" label="Resize the film preview"
        snap={{ self: shut => setPreview(!shut), other: setChatShut, otherCollapsed: chatShut }} />
      <BrowserPanel visible={browsing && active} onClose={() => setBrowsing(false)} />
      {proposal && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-1.5">
          <span className="font-medium text-amber">Proposed:</span>
          <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
          <div className="inline-flex rounded-md border border-line bg-panel p-0.5">
            {(['before', 'after'] as const).map(k => (
              <button key={k} onClick={() => setCompare(k)} className={cn('rounded px-2 py-0.5 text-xs capitalize', compare === k ? 'bg-raised text-fg' : 'text-dim')}>{k}</button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => decide(false)}><X />Reject</Button>
          <Button size="sm" variant="primary" onClick={() => decide(true)}><Check />Accept</Button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {p.media[onScreen.path] && needsProxy(p.media[onScreen.path]) && !p.proxies?.[onScreen.path] && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 text-center text-[#a39888]">
            <Loader2 className="size-5 animate-spin text-amber" />
            <span>Making a preview copy for smooth playback…</span>
            <span className="text-xs text-[#6f665b]">{needsProxy(p.media[onScreen.path]) && (needsProxy(p.media[onScreen.path]) as { why: string }).why} · exports use the original</span>
          </div>
        )}
        {editing && p.clips?.[editing.clip] && (
          <ClipEditor
            dir={p.dir}
            clip={p.clips[editing.clip]}
            width={(onScreen.timeline || p.timeline)!.width}
            height={(onScreen.timeline || p.timeline)!.height}
            time={time - editing.start}
            picked={anchor?.clip?.element}
            onPick={el => { setAnchor({ t0: time, clip: { id: editing.clip, element: el } }); ask() }}
            onClose={() => setEditing(null)}
          />
        )}
        <Stage
          ref={stage}
          src={mediaUrl(`${p.dir}/${p.proxies?.[playable] || playable}`)}
          edit={liveEdit}
          onSource={setSource}
          notes={p.notes}
          time={time}
          drawing={drawing}
          box={anchor?.box}
          working={agent.busy}
          onBox={(b: Box) => { setAnchor(a => ({ t0: a?.t0 ?? time, t1: a?.t1, box: b })); setDrawing(false); setInline(true) }}
          ask={anchor?.box ? inlineAsk : undefined}
          onTime={setTime}
          onDuration={setDuration}
          onPlaying={setPlaying}
        />
      </div>

      <Scrubber
        dir={p.dir}
        revision={onScreen.createdAt}
        fps={live ? tl.fps : p.media[onScreen.path]?.fps || 30}
        duration={duration}
        time={time}
        notes={p.notes}
        range={anchor}
        track={track}
        clips={p.clips || {}}
        selected={editing?.itemId ?? null}
        status={edited && !proposal ? <EditStatus saving={saving} onSave={saveVersion} /> : null}
        onSeek={seek}
        onRange={r => setAnchor(r ? { ...r, box: anchor?.box } : undefined)}
        onRangeEnd={() => setInline(true)}
        ask={anchor && !anchor.box && !anchor.clip ? inlineAsk : undefined}
        onNote={n => seek(n.anchor.t0)}
        movable={!proposal}
        onMove={(id, before) => doEdit([{ op: 'move', id, ...(before ? { before } : {}) }])}
        onInsert={insertFootage}
        onOpenClip={(id, clip, start) => {
          stage.current?.video?.pause()
          seek(start + Math.min((p.clips?.[clip]?.duration ?? 2) / 2, 1))
          setEditing({ itemId: id, clip, start })
        }}
      />

      <div className="flex items-center gap-1">
        <Button size="iconSm" variant="ghost" onClick={playPause}>
          {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
        </Button>
        <span className="tabular text-xs text-dim">{timecode(time)} <span className="text-faint">/ {timecode(duration)}</span></span>
        <span className="flex-1" />
        <Tip label={<>Note at the playhead <Kbd>N</Kbd></>}>
          <Button size="sm" variant="ghost" onClick={noteHere}><MessageSquarePlus />Note</Button>
        </Tip>
        <Tip label={<>Draw a box on the picture <Kbd>B</Kbd></>}>
          <Button size="sm" variant={drawing ? 'secondary' : 'ghost'} onClick={() => { stage.current?.video?.pause(); setDrawing(d => !d) }}><SquareDashed />Box</Button>
        </Tip>
      </div>
    </div>
  )

  return (
    <div
      className="flex h-full flex-col bg-panel"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={async e => {
        e.preventDefault(); setOver(false)
        await addFiles(p.dir, Array.from(e.dataTransfer.files).map(f => window.manul.pathForFile(f)).filter(Boolean))
      }}
    >
      <ExportDialog dir={p.dir} open={exporting} onOpenChange={setExporting} />
      {/* as in Claude's app: the conversation's title (its menu switches threads), then the project and the version as chips */}
      <div className={cn('drag flex h-[52px] shrink-0 items-center gap-1.5 pr-3', lead ? 'pl-[88px]' : 'pl-3')}>
        {lead}
        <Clapperboard className="ml-1 size-4 shrink-0 text-dim" strokeWidth={1.75} />
        <Conversations project={p} />
        <span className="max-w-[200px] shrink-0 truncate rounded-md bg-hover/80 px-1.5 py-0.5 text-xs text-dim" data-project-title={p.title} title={p.dir}>{p.title}</span>
        <select
          className="no-drag h-[22px] max-w-[200px] shrink-0 cursor-default appearance-none rounded-md bg-hover/80 px-1.5 text-xs text-dim outline-none hover:text-fg"
          value={p.current}
          onChange={async e => {
            if (edited && !confirm('The edit isn\'t saved as a version. Switch anyway? (History keeps it.)')) return
            setP(await window.manul.project.setCurrent(p.dir, e.target.value))
          }}
          title="Versions"
        >
          {p.versions.filter(v => v.id !== p.proposal).map((v, i) => <option key={v.id} value={v.id}>v{i + 1} · {v.title}</option>)}
        </select>
        <span className="flex-1" />
        <JobsTray />
        <HistoryButton project={p} open={historyOpen} onOpenChange={setHistoryOpen} onRestored={np => { setP(np); setEditing(null) }} />
        <Tip label="Show in Finder" side="bottom"><Button className="no-drag" size="iconSm" variant="ghost" onClick={() => window.manul.project.reveal(p.dir)}><FolderOpen /></Button></Tip>
        <Tip label="Manul's browser (the agent uses it for the web)" side="bottom">
          <Button className="no-drag" size="iconSm" variant={browsing ? 'secondary' : 'ghost'} onClick={() => setBrowsing(x => !x)} aria-label="Browser"><Globe /></Button>
        </Tip>
        <Tip label={chatShut ? 'Show the conversation' : 'Hide the conversation'} side="bottom">
          <Button className="no-drag" size="iconSm" variant={chatShut ? 'ghost' : 'secondary'} onClick={() => { setChatShut(x => !x); setPreview(true) }} aria-label="Conversation"><MessagesSquare /></Button>
        </Tip>
        <Tip label={preview ? 'Hide the film' : 'Show the film'} side="bottom">
          <Button className="no-drag" size="iconSm" variant={preview ? 'secondary' : 'ghost'} onClick={() => setPreview(x => !x)} aria-label="Film preview"><PanelRight /></Button>
        </Tip>
        <Button className="no-drag" size="sm" variant="primary" onClick={() => setExporting(true)}><Upload />Export</Button>
      </div>

      <div ref={chatRow} className="flex min-h-0 flex-1">
        {!chatShut && (
          <div className="min-w-[320px] flex-1">
            <AgentPanel
              project={p.dir}
              projectInfo={p}
              model={p.model}
              agent={agent}
              active={active}
              anchor={anchor}
              onClearAnchor={() => { setAnchor(undefined); setDrawing(false) }}
              attached={attached}
              onAttach={rels => attachFiles(p.dir, rels)}
              onDetach={rels => detachFiles(p.dir, rels)}
              onAdd={() => pickFiles(p.dir)}
              onSend={send}
              onStop={() => window.manul.agent.stop(p.dir)}
              ready={ready}
              onKeys={onKeys}
              inputRef={input}
            />
          </div>
        )}
        {preview && film}
      </div>
    </div>
  )
}
