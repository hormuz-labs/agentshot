// A project on screen: the conversation first, the film beside it (the proposal to decide on, the picture, the timeline).
// Point at the film (a box, a range, N for the moment) and say what should change, right there or in the chat.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Clapperboard, Globe, Images, MessagesSquare, PanelRight, Upload, FolderOpen } from 'lucide-react'
import { voiceoverName } from '../../../shared/voiceover'
import { JobsTray } from '@/components/JobsTray'
import { HistoryButton } from '@/components/HistoryButton'
import { Conversations } from '@/components/Conversations'
import { InlineAsk } from '@/components/InlineAsk'
import { useCommands } from '@/lib/commands'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { paneStyle, Resizer, useWidth } from '@/components/ui/resizer'
import { useAgent } from '@/lib/agui'
import { addFiles, attachFiles, clearAttached, detachFiles, pickFiles, useAttached } from '@/lib/attach'
import { MAC, REVEAL, cn, mediaUrl, timecode } from '@/lib/utils'
import { FilmPanel, useFilm } from './FilmPanel'
import { AgentPanel } from './AgentPanel'
import { BrowserPanel } from './BrowserPanel'
import { FootagePanel } from './FootagePanel'
import { ExportDialog } from './ExportDialog'
import { DemoFollowup } from './DemoFollowup'
import { CameraControls } from './CameraControls'
import { VideoControls } from './VideoControls'
import { demoOutputMessage } from '@/lib/demo-output'
import { cameraAt } from '../../../shared/demo'
import type { Anchor, Project } from '../../../shared/types'
import { appendRange, parseRangeNotes } from '../../../shared/range-notes'

const clean = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function ProjectView({ initial, firstPrompt, firstFiles, onKeys, ready, active = true, lead }: { initial: Project; firstPrompt?: string; firstFiles?: string[]; onKeys(): void; ready: boolean; active?: boolean; lead?: ReactNode }) {
  const [p, setP] = useState(initial)
  const agent = useAgent(p.dir)
  const input = useRef<HTMLTextAreaElement>(null)
  // the film beside the chat (FilmPanel): what it plays and how it edits
  const film = useFilm({ p, setP, fail: e => alert(clean(e)) })
  const { stage, goTo, time, duration, recordingVoiceover, compare, cameraMode, setCameraMode, videoEditing, setVideoEditing, setEditing } = film
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  const [draft, setDraft] = useState('')
  const focusRange = useRef(false)
  useLayoutEffect(() => {
    if (!focusRange.current || !input.current) return
    focusRange.current = false
    input.current.focus()
    input.current.setSelectionRange(input.current.value.length, input.current.value.length)
  })
  // files attached to the next message: ones just added, or picked in the sidebar's tree
  const attached = useAttached(p.dir)
  const [drawing, setDrawing] = useState(false)
  const [over, setOver] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [demoAdjusting, setDemoAdjusting] = useState(false)
  const openAdjustment = useRef(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const started = useRef(false)
  const [browsing, setBrowsing] = useState(false)
  // every file brought into the project, as pictures (beside the film, in its place)
  const [footage, setFootage] = useState(false)
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
  const ask = () => { setChatShut(false); setTimeout(() => { input.current?.focus(); const end = input.current?.value.length ?? 0; input.current?.setSelectionRange(end, end) }, 0) }
  // A message box at the selection itself (the box on the picture, the range or moment on the timeline): instructions
  // go from there without opening the chat.
  const [inline, setInline] = useState(false)
  useEffect(() => { if (!anchor) setInline(false) }, [anchor])
  // the agent opened or focused a browser window: show it (in the project on screen)
  useEffect(() => window.agentshot.browser.onReveal(() => { if (active) setBrowsing(true) }), [active])
  useEffect(() => {
    const prepare = () => {
      if (!active) return
      stage.current?.video?.pause()
      setPreview(true); setChatShut(false); setBrowsing(false); setHistoryOpen(false)
    }
    window.addEventListener('agentshot:tour-prepare', prepare)
    return () => window.removeEventListener('agentshot:tour-prepare', prepare)
  }, [active])

  useEffect(() => window.agentshot.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => window.agentshot.onSeek((dir, t) => { if (dir === p.dir && stage.current?.video) stage.current.video.currentTime = t }), [p.dir])

  const send = useCallback(async (text: string, files = attached) => {
    const a = anchor
    const still = a ? stage.current?.still(a.box) : undefined
    try {
      const shown = p.versions.find(v => v.id === (p.proposal && compare === 'after' ? p.proposal : p.current))
      await window.agentshot.agent.send(p.dir, { text, anchor: a, still, files, playhead: stage.current?.video?.currentTime, media: shown?.path })
    } catch (e) { alert((e as Error).message); return false }
    setAnchor(undefined)
    setDrawing(false)
    clearAttached(p.dir)
    return true
  }, [anchor, attached, p.dir, p.versions, p.current, p.proposal, compare])

  // Startup files belong to the submitted request, or to the first draft when no request was typed.
  // Handle that handoff once, including StrictMode's replay of mount effects.
  useEffect(() => {
    if (started.current || (firstPrompt && !ready)) return
    started.current = true
    if (firstPrompt) send(firstPrompt, firstFiles)
    else if (firstFiles?.length) attachFiles(p.dir, firstFiles)
  }, [firstPrompt, firstFiles, ready, send, p.dir])

  const { seek, playPause } = film
  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); setInline(true) }

  // keyboard: Space play/pause · N note · B box · G go to a time · ←/→ ±1 s (⇧ ±5 s) · Esc clears
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!active || recordingVoiceover || (e.target as HTMLElement).closest('textarea, input')) return
      const v = stage.current?.video
      if (e.key === ' ') { e.preventDefault(); playPause() }
      else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); noteHere() }
      else if ((e.key === 'b' || e.key === 'B') && !e.metaKey && !e.ctrlKey) { e.preventDefault(); v?.pause(); setDrawing(d => !d) }
      else if (e.key === 'ArrowLeft' && v) seek(Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)))
      else if (e.key === 'ArrowRight' && v) seek(Math.min(duration, v.currentTime + (e.shiftKey ? 5 : 1)))
      else if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); goTo.current?.focus() }
      else if (e.key === 'Escape') { setAnchor(undefined); setDrawing(false); setEditing(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // a background project stops playing and leaves the menu, palette and keys to the one on screen
  useEffect(() => { if (!active) stage.current?.video?.pause() }, [active])

  const { current, proposal, tl, edited, undoEdit, saveVersion, insertFootage, doEdit, selectedVideo, revealCamera } = film
  // the menu and palette run these with what is on screen now
  const act = useRef({ undoEdit, saveVersion, edited })
  act.current = { undoEdit, saveVersion, edited }
  useCommands(!active ? [] : [
    { id: 'export', title: 'Export…', keywords: 'save render mp4 vertical shorts captions srt', run: () => setExporting(true) },
    { id: 'media', title: 'Add files…', keywords: 'import media footage image audio music logo subtitles srt vtt font lut folder zip', run: () => pickFiles(p.dir) },
    { id: 'reveal', title: MAC ? 'Show project in Finder' : 'Show project folder', keywords: 'folder files finder', run: () => window.agentshot.project.reveal(p.dir) },
    { id: 'history', title: 'History', keywords: 'undo restore versions', run: () => setHistoryOpen(true) },
    { id: 'note', title: 'Add a note at the playhead', shortcut: 'N', run: () => noteHere() },
    { id: 'box', title: 'Draw a box on the picture', shortcut: 'B', run: () => { stage.current?.video?.pause(); setDrawing(true) } },
    { id: 'play', title: 'Play or pause', shortcut: 'Space', run: playPause },
    { id: 'agent.new', title: 'New chat', keywords: 'conversation thread', run: () => window.agentshot.agent.newConversation(p.dir) },
    { id: 'agent.focus', title: 'Ask AgentShot', run: () => ask() },
    { id: 'agent.panel', title: 'Show or hide the chat', keywords: 'conversation collapse film', run: () => { setChatShut(x => !x); setPreview(true) } },
    { id: 'agent.stop', title: 'Stop the agent', run: () => window.agentshot.agent.stop(p.dir) },
    { id: 'browser', title: 'Show or hide the browser', keywords: 'web internet bsk sign in google youtube', run: () => setBrowsing(x => !x) },
    { id: 'timeline.undo', title: 'Undo', keywords: 'timeline edit back', run: () => act.current.undoEdit(false) },
    { id: 'timeline.redo', title: 'Redo', keywords: 'timeline edit', run: () => act.current.undoEdit(true) },
    { id: 'timeline.render', title: 'Save as version', keywords: 'render timeline edit', run: () => { if (act.current.edited) act.current.saveVersion() } },
  ], [p.dir, active])
  useEffect(() => {
    if (openAdjustment.current && tl.demo && !proposal) {
      openAdjustment.current = false; setDemoAdjusting(true); setCameraMode('move'); setVideoEditing(false); revealCamera(tl)
    } else { setCameraMode(null); setVideoEditing(false); setDemoAdjusting(false) }
  }, [p.current, !!proposal])
  const adjustDemo = async () => {
    stage.current?.video?.pause()
    if (proposal?.timeline?.demo) openAdjustment.current = true
    let next = p
    try { next = proposal?.timeline?.demo ? await window.agentshot.project.decide(p.dir, true) : p }
    catch (e) { openAdjustment.current = false; throw e }
    if (!next.timeline?.demo) throw new Error('Choose a demo version to adjust.')
    setP(next); setChatShut(false); setPreview(true); setBrowsing(false)
    if (!proposal) { setDemoAdjusting(true); setCameraMode('move'); setVideoEditing(false); revealCamera(next.timeline!) }
  }
  const shownDemo = proposal ? (proposal.timeline?.demo ? proposal : undefined) : current.timeline?.demo || tl.demo ? current : undefined
  // Follow the producing turn, not whichever message happens to be newest. A hand-saved layout inherits its
  // most recent agent output anchor until the agent actually produces another demo version.
  const demoAnchor = shownDemo && (demoOutputMessage(agent.messages, shownDemo) || [...p.versions].reverse().filter(v => v.timeline?.demo).map(v => demoOutputMessage(agent.messages, v)).find(Boolean))
  const demoTools = shownDemo ? <DemoFollowup key={demoAnchor || shownDemo.id} editing={demoAdjusting} busy={agent.busy} proposal={!!proposal} onAdjust={adjustDemo} onDone={() => { setDemoAdjusting(false); setCameraMode(null); setVideoEditing(false) }} onRender={async () => {
      if (!ready) throw new Error('Add an API key to render the adjusted video in chat.')
      await window.agentshot.agent.send(p.dir, { text: 'Render the face-layout and framing adjustments I made in the chat toolbox. They are already on the current timeline. Use rerender_timeline, preserve the existing sync and cuts, and show the updated video beside this chat.', files: [] })
    }}>
      <CameraControls timeline={tl} onEdit={doEdit} mode={cameraMode} sourceUrl={tl.demo ? mediaUrl(`${p.dir}/${tl.demo.camera}`) : undefined} sourceInfo={tl.demo ? p.media[tl.demo.camera] : undefined} sourceTime={cameraAt(tl, time)?.at || 0} onMode={v => { setCameraMode(v); if (v) { setVideoEditing(false); revealCamera(tl) } }} />
      {selectedVideo?.kind === 'media' && <VideoControls item={selectedVideo} onEdit={doEdit} editing={videoEditing} onEditing={v => { stage.current?.video?.pause(); setVideoEditing(v); if (v) setCameraMode(null) }} />}
    </DemoFollowup> : null

  const anchorLabel = anchor && `${timecode(anchor.t0)}${anchor.t1 != null ? `–${timecode(anchor.t1)}` : ''}${anchor.box ? ' · box' : ''}`
  // only while the film it points at is in view: Footage or the browser over it hide it (the note waits)
  const inlineAsk = inline && anchor && !footage && !(browsing && active) ? (
    <InlineAsk label={anchorLabel!} onSend={text => { setInline(false); send(text) }}
      onCancel={() => { setInline(false); setAnchor(undefined); setDrawing(false) }} />
  ) : null

  /** The film's column: the proposal to decide on, the picture, the timeline, and the transport. */
  const filmColumn = (
    <div
      className={cn('relative flex min-w-0 flex-col gap-2 bg-canvas p-3', chatShut ? 'flex-1 min-w-[360px]' : 'shrink-0 border-l border-line', over && 'bg-amber-soft')}
      style={chatShut ? undefined : paneStyle(previewW)}
    >
      <Resizer pane={previewW} edge="left" label="Resize the film preview"
        snap={{ self: shut => setPreview(!shut), other: setChatShut, otherCollapsed: chatShut }} />
      <FilmPanel
        film={film} p={p} setP={setP} fail={e => alert(clean(e))}
        anchor={anchor} setAnchor={setAnchor} drawing={drawing} setDrawing={setDrawing}
        inlineAsk={inlineAsk} noteHere={noteHere} onBox={() => setInline(true)}
        onClipPick={a => { setAnchor(a); ask() }}
        onRange={r => { if (r) setChatShut(false) }}
        onRangeEnd={r => {
          focusRange.current = true
          setDraft(text => appendRange(text, r.t0, r.t1))
          setAnchor(undefined); setInline(false); setChatShut(false)
        }}
        ranges={parseRangeNotes(draft).map(n => n.anchor)}
        onAttachVoiceover={src => {
          attachFiles(p.dir, [src])
          const mention = `@${voiceoverName(p.voiceovers || [], src)}`
          setDraft(text => text.includes(mention) ? text : `${text.trimEnd()}${text.trim() ? ' ' : ''}${mention} `)
          ask()
        }}
        onVoiceoverSaved={(_next, src) => {
          attachFiles(p.dir, [src]); setChatShut(false)
          film.setNotice('Voiceover added to your video and this chat\'s files. You can trim, move, adjust the volume, or ask for changes in the chat.')
        }}
        working={agent.busy} active={active}
        overlays={<>
          <BrowserPanel visible={browsing && active && !footage} onClose={() => setBrowsing(false)} />
          {footage && <FootagePanel project={p} onClose={() => setFootage(false)} onInsert={rel => { setFootage(false); insertFootage(rel, time) }} />}
        </>}
      />
    </div>
  )

  return (
    <div
      className="flex h-full flex-col bg-panel"
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={async e => {
        e.preventDefault(); setOver(false)
        await addFiles(p.dir, Array.from(e.dataTransfer.files).map(f => window.agentshot.pathForFile(f)).filter(Boolean))
      }}
    >
      <ExportDialog dir={p.dir} open={exporting} onOpenChange={setExporting} />
      {/* as in Claude's app: the conversation's title (its menu switches threads), then the project and the version as chips */}
      <div className={cn('drag flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line pr-3', lead && MAC ? 'pl-[88px]' : 'pl-3')}>
        {lead && <>{lead}<span className="mx-1 h-5 w-px bg-line" aria-hidden /></>}
        <Clapperboard className="ml-1 size-4 shrink-0 text-dim" strokeWidth={1.75} />
        <Conversations project={p} />
        <span className="max-w-[200px] shrink-0 truncate rounded-md bg-hover/80 px-1.5 py-0.5 text-xs text-dim" data-project-title={p.title} title={p.dir}>{p.title}</span>
        <select
          data-tour="versions"
          className="no-drag h-[22px] max-w-[200px] shrink-0 cursor-default appearance-none rounded-md bg-hover/80 px-1.5 text-xs text-dim outline-none hover:text-fg"
          value={p.current}
          onChange={async e => {
            if (edited && !confirm('The edit isn\'t saved as a version. Switch anyway? (History keeps it.)')) return
            setP(await window.agentshot.project.setCurrent(p.dir, e.target.value))
          }}
          title="Versions"
        >
          {p.versions.filter(v => v.id !== p.proposal).map((v, i) => <option key={v.id} value={v.id}>v{i + 1} · {v.title}</option>)}
        </select>
        <span className="flex-1" />
        <JobsTray />
        <HistoryButton project={p} open={historyOpen} onOpenChange={setHistoryOpen} onRestored={np => { setP(np); setEditing(null) }} />
        <Tip label={REVEAL} side="bottom"><Button className="no-drag" size="iconSm" variant="ghost" onClick={() => window.agentshot.project.reveal(p.dir)} aria-label={REVEAL}><FolderOpen /></Button></Tip>
        <Tip label="Files: everything you brought in" side="bottom">
          <Button className="no-drag" size="iconSm" variant={footage ? 'secondary' : 'ghost'} onClick={() => { setFootage(x => !x); setPreview(true) }} aria-label="Files"><Images /></Button>
        </Tip>
        <Tip label="AgentShot's browser (the agent uses it for the web)" side="bottom">
          <Button className="no-drag" size="iconSm" variant={browsing ? 'secondary' : 'ghost'} onClick={() => { setBrowsing(x => !x); setFootage(false) }} aria-label="Browser"><Globe /></Button>
        </Tip>
        <Tip label={chatShut ? 'Show the chat' : 'Hide the chat'} side="bottom">
          <Button className="no-drag" size="iconSm" variant={chatShut ? 'ghost' : 'secondary'} onClick={() => { setChatShut(x => !x); setPreview(true) }} aria-label="Chat"><MessagesSquare /></Button>
        </Tip>
        <Tip label={preview ? 'Hide the film' : 'Show the film'} side="bottom">
          <Button className="no-drag" size="iconSm" variant={preview ? 'secondary' : 'ghost'} onClick={() => setPreview(x => !x)} aria-label="Film preview"><PanelRight /></Button>
        </Tip>
        <Button data-tour="export" className="no-drag" size="sm" variant="primary" onClick={() => setExporting(true)}><Upload />Export</Button>
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
              text={draft}
              onText={setDraft}
              onClearAnchor={() => { setAnchor(undefined); setDrawing(false) }}
              attached={attached}
              onAttach={rels => attachFiles(p.dir, rels)}
              onDetach={rels => detachFiles(p.dir, rels)}
              onAdd={() => pickFiles(p.dir)}
              onSend={send}
              onStop={() => window.agentshot.agent.stop(p.dir)}
              ready={ready}
              onKeys={onKeys}
              inputRef={input}
              demoTools={demoTools}
              demoToolsMessage={demoAnchor}
            />
          </div>
        )}
        {preview && filmColumn}
      </div>
    </div>
  )
}
