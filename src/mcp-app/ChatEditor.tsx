// AgentShot's film panel inside Claude or ChatGPT: the column beside the chat in the app (ProjectView's `film`), made of
// the same parts (Stage, Scrubber with its filmstrip, the transport, VideoControls, the proposal bar, History, Files,
// Export, Voiceover). The chat it sits in is the agent: a note, a box or a range is asked there, as a message.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, FilePlus2, Images, Loader2, Maximize2, MessageSquarePlus, Minimize2, MoveHorizontal, Mic, Pause, Play, Redo2, SplitSquareHorizontal, SquareDashed, Undo2, Upload, X } from 'lucide-react'
import { Stage, type LiveEdit, type StageHandle } from '@/views/Stage'
import { Scrubber } from '@/views/Scrubber'
import { VideoControls } from '@/views/VideoControls'
import { CameraControls } from '@/views/CameraControls'
import { EditStatus } from '@/views/EditStatus'
import { ExportDialog } from '@/views/ExportDialog'
import { FootagePanel } from '@/views/FootagePanel'
import { ClipEditor } from '@/views/ClipEditor'
import { VoiceoverRecorder } from '@/views/VoiceoverPanel'
import type { LiveVoiceover } from '@/views/VoiceoverTimeline'
import { HistoryButton } from '@/components/HistoryButton'
import { GoToTime } from '@/components/GoToTime'
import { InlineAsk } from '@/components/InlineAsk'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { useLiveMix, type MixSource } from '@/lib/liveMix'
import { usePreview } from '@/lib/preview'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { dbToGain, type Mix } from '../shared/mix'
import { sameCut, sourceAt, timelineOfFile, itemAt, starts, length, type Edit } from '../shared/timeline'
import { cameraAt, cameraRange } from '../shared/demo'
import { voiceoverName } from '../shared/voiceover'
import type { Anchor, Box, Project } from '../shared/types'
import logo from './logo.png'

const clean = (e: unknown) => String((e as Error)?.message ?? e)

export type Chat = {
  /** Put the user's words (and maybe a still of the picture) into the chat, as their message. */
  say(text: string, still?: string): Promise<void>
  /** Tell the model what the user did here, quietly, for its next answer. */
  note(text: string): void
  /** Send a file the user chose into this project (AgentShot in the cloud only). */
  upload?(file: File, progress: (done: number) => void): Promise<{ folder: string; title?: string }>
  /** Ask the chat for the editor to fill the window (or back), when it can. */
  fullscreen?: { on: boolean; toggle(): void }
}

export function ChatEditor({ initial, folder, chat, mediaVersion }: { initial: Project; folder: string; chat: Chat; mediaVersion: number }) {
  const [p, setP] = useState(initial)
  const stage = useRef<StageHandle>(null)
  const goTo = useRef<HTMLInputElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null)
  const [moveMode, setMoveMode] = useState(false)
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  const [inline, setInline] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [compare, setCompare] = useState<'after' | 'before'>('after')
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [footage, setFootage] = useState(false)
  const [cameraMode, setCameraMode] = useState<'move' | 'frame' | null>(null)
  const [videoEditing, setVideoEditing] = useState(false)
  const [source, setSource] = useState<MixSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [regions, setRegions] = useState<[number, number][]>([])
  const [editing, setEditing] = useState<{ itemId: string; clip: string; start: number } | null>(null)
  const [voiceoverOpen, setVoiceoverOpen] = useState(false)
  const [recordingVoiceover, setRecordingVoiceover] = useState(false)
  const [liveVoiceover, setLiveVoiceover] = useState<LiveVoiceover | null>(null)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')
  const [reveal, setReveal] = useState({ t: 0, key: 0 })
  const picker = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState<{ name: string; done: number } | null>(null)
  /** Files the user chose, into this project one after another; then Files shows them, to put in the film. */
  const addFiles = async (files: File[]) => {
    if (!chat.upload || sending) return
    for (const file of files) {
      setSending({ name: file.name, done: 0 })
      try { await chat.upload(file, done => setSending({ name: file.name, done })) }
      catch (e) { fail(e); setSending(null); return }
    }
    setSending(null)
    setNotice(files.length === 1 ? `${files[0].name} is in the project. Put it in the film from Files.` : `${files.length} files are in the project. Put them in the film from Files.`)
    setFootage(true)
  }
  // what the ask at the selection is about, when it isn't the film's time (a voiceover to talk about)
  const [about, setAbout] = useState<string | undefined>()

  useEffect(() => window.agentshot.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => { if (p.proposal) setCompare('after') }, [p.proposal])
  useEffect(() => { if (!anchor) { setInline(false); setAbout(undefined) } }, [anchor])

  const fail = (e: unknown) => setProblem(clean(e))
  const seek = (t: number) => { const v = stage.current?.video; if (v) v.currentTime = t; setTime(t) }
  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); setInline(true) }
  const playPause = () => { const v = stage.current?.video; if (v) v.paused ? v.play() : v.pause() }

  const current = p.versions.find(v => v.id === p.current)!
  const proposal = p.proposal ? p.versions.find(v => v.id === p.proposal) : undefined
  const onScreen = proposal && compare === 'after' ? proposal : current

  /** The user's words from here go to the chat, which is the agent: where they point, and a still of a box. */
  const send = async (text: string) => {
    const a = anchor
    const still = a?.box ? stage.current?.still(a.box) : undefined
    const where = a ? `At ${timecode(a.t0)}${a.t1 != null ? `–${timecode(a.t1)}` : ''}${a.box ? ', in the box I drew on the picture' : ''}` : ''
    const said = `${about ? `About my voiceover ${about}: ` : where ? `${where}: ` : ''}${text}`
    const context = `(AgentShot editor · project "${folder}" · ${onScreen === proposal ? 'the proposed cut' : 'the current version'} "${onScreen.title}"` +
      `${a ? ` · film time ${a.t0}${a.t1 != null ? `–${a.t1}` : ''} s${a.box ? ` · box x ${a.box.x.toFixed(3)} y ${a.box.y.toFixed(3)} w ${a.box.w.toFixed(3)} h ${a.box.h.toFixed(3)} of the picture` : ''}` : ''})`
    try { await chat.say(`${said}\n\n${context}`, still) } catch (e) { fail(e); return }
    setAnchor(undefined); setDrawing(false); setInline(false); setAbout(undefined)
    setNotice('Sent to the chat.')
  }

  // keyboard, as in the app: Space · N note · B box · G go to · ←/→ ±1 s (⇧ ±5 s) · ⌘Z / ⇧⌘Z · Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recordingVoiceover || (e.target as HTMLElement).closest('textarea, input, select')) return
      const v = stage.current?.video
      const mod = e.metaKey || e.ctrlKey
      if (e.key === ' ') { e.preventDefault(); playPause() }
      else if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); void undoEdit(e.shiftKey) }
      else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); void undoEdit(true) }
      else if ((e.key === 'n' || e.key === 'N') && !mod) { e.preventDefault(); noteHere() }
      else if ((e.key === 'b' || e.key === 'B') && !mod) { e.preventDefault(); v?.pause(); setDrawing(d => !d) }
      else if (e.key === 'ArrowLeft' && v) seek(Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)))
      else if (e.key === 'ArrowRight' && v) seek(Math.min(duration, v.currentTime + (e.shiftKey ? 5 : 1)))
      else if ((e.key === 'g' || e.key === 'G') && !mod && !e.altKey) { e.preventDefault(); goTo.current?.focus() }
      else if (e.key === 'Escape') { setAnchor(undefined); setDrawing(false); setEditing(null); setMoveMode(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // the edit (p.timeline) changed since the version on screen was rendered: it plays from its pieces until saved
  const tl = p.timeline!
  const edited = useMemo(() => !sameCut(tl, current.timeline ?? (p.media[current.path] ? timelineOfFile(current.path, p.media[current.path]) : tl)), [tl, current, p.media])
  const live = (edited || (cameraMode && !!tl.demo) || videoEditing) && onScreen === current
  const track = useMemo(() => onScreen === current ? tl : onScreen.timeline ?? timelineOfFile(onScreen.path, p.media[onScreen.path]), [onScreen, current, tl, p.media])
  const manualItem = itemAt(track, time).item
  const manualStart = manualItem ? starts(track)[track.items.indexOf(manualItem)] : 0
  const canSplit = manualItem?.kind === 'media' && time > manualStart + .001 && time < manualStart + length(manualItem) - .001
  useEffect(() => { if (!track.items.some(it => it.id === selectedPiece)) setSelectedPiece(null) }, [track]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setMoveMode(false); setSelectedPiece(null) }, [onScreen.id, !!proposal]) // eslint-disable-line react-hooks/exhaustive-deps
  const liveEdit = useMemo<LiveEdit | null>(() => !live ? null : {
    pieces: tl.items.map(it => it.kind === 'media'
      ? { id: it.id, url: mediaUrl(`${p.dir}/${p.proxies?.[it.src] || it.src}`), in: it.in, out: it.out, gain: it.muted ? 0 : dbToGain(it.db || 0) }
      : { id: it.id, url: `${mediaUrl(`${p.dir}/${p.clips?.[it.clip]?.video}`)}?v=${p.clips?.[it.clip]?.updatedAt}`, in: 0, out: it.dur, gain: 0 }),
    fps: tl.fps, width: tl.width, height: tl.height,
    overlays: (tl.overlays || []).filter(o => p.clips?.[o.clip]).map(o => ({ id: o.id, url: `${mediaUrl(`${p.dir}/clips/${o.clip}/clip.html`)}?v=${p.clips![o.clip].updatedAt}`, start: o.start, dur: o.dur })),
    timeline: tl, cameraUrl: tl.demo ? mediaUrl(`${p.dir}/${cameraMode === 'frame' ? tl.demo.camera : p.proxies?.[tl.demo.camera] || tl.demo.camera}`) : undefined,
  }, [live, tl, p.dir, p.proxies, p.clips, cameraMode, mediaVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  const mix: Mix = (live ? tl.mix : onScreen.timeline?.mix) || { filmDb: 0 }
  const speechKey = live ? JSON.stringify([tl.items, tl.mix?.voiceovers]) : onScreen.id
  useEffect(() => { window.agentshot.mix.speech(p.dir, live ? 'edit' : onScreen.id).then(setRegions).catch(() => setRegions([])) }, [p.dir, speechKey, p.transcripts]) // eslint-disable-line react-hooks/exhaustive-deps
  useLiveMix(source, p.dir, recordingVoiceover ? { filmDb: -100 } : mix, regions)

  /** Change the edit by hand: it plays at once, Undo takes it back. */
  const doEdit = async (edits: Edit[], then?: number) => {
    try { setP(await window.agentshot.timeline.edit(p.dir, edits)); if (then != null) seek(then); chat.note(`In the AgentShot editor the user changed the edit by hand (${edits.map(e => e.op).join(', ')}); it isn't rendered yet.`) }
    catch (e) { fail(e) }
  }
  const insertFootage = (rel: string, t: number) => {
    const m = p.media[rel]
    if (!m?.width || !(m.duration > 0)) return fail(`${rel.split('/').pop()} isn't footage that can go in the film.`)
    void doEdit([{ op: 'insert', at: t, src: rel, in: 0, out: Math.round(m.duration * 1000) / 1000 }], t)
  }
  const undoEdit = async (redo: boolean) => { try { setP(await window.agentshot.timeline.undo(p.dir, redo)) } catch (e) { fail(e) } }
  const saveVersion = async () => {
    setSaving(true)
    try { await window.agentshot.timeline.render(p.dir); chat.note('In the AgentShot editor the user saved the edit as a new version.') } catch (e) { fail(e) } finally { setSaving(false) }
  }
  const decide = async (accept: boolean) => {
    try {
      setP(await window.agentshot.project.decide(p.dir, accept))
      chat.note(accept ? `In the AgentShot editor the user kept the proposed cut "${proposal?.title}". It's the current version now.` : `In the AgentShot editor the user sent back the proposed cut "${proposal?.title}". The version they had stays.`)
    } catch (e) { fail(e) }
  }
  const setCurrent = async (id: string) => {
    if (edited && !confirm('The edit isn’t saved as a version. Switch anyway? (History keeps it.)')) return
    try { setP(await window.agentshot.project.setCurrent(p.dir, id)) } catch (e) { fail(e) }
  }

  const playable = onScreen.dry || onScreen.path
  const liveItem = live ? sourceAt(tl, time)?.item : undefined
  const previewMedia = liveItem?.kind === 'media' ? liveItem.src : liveItem?.kind === 'clip' ? p.clips?.[liveItem.clip]?.video || '' : playable
  const previewCopy = usePreview(p.dir, previewMedia)
  const selectedVideo = sourceAt(tl, time)?.item
  useEffect(() => { setCameraMode(null); setVideoEditing(false) }, [p.current, !!proposal]) // eslint-disable-line react-hooks/exhaustive-deps
  const revealCamera = (timeline: typeof tl) => {
    if (timeline.demo && !cameraAt(timeline, time)) {
      let at = 0
      for (const it of timeline.items) {
        const range = it.kind === 'media' && it.src === timeline.demo.screen ? cameraRange(timeline.demo, it.in, it.out) : null
        if (range && it.kind === 'media') { seek(at + range.s - it.in + Math.min(1, (range.e - range.s) / 2)); break }
        at += it.kind === 'media' ? it.out - it.in : it.dur
      }
    }
  }

  const anchorLabel = about ? `voiceover ${about}` : anchor && `${timecode(anchor.t0)}${anchor.t1 != null ? `–${timecode(anchor.t1)}` : ''}${anchor.box ? ' · box' : ''}`
  const inlineAsk = inline && anchor && !footage ? (
    <InlineAsk label={anchorLabel!} onSend={text => { void send(text) }} onCancel={() => { setInline(false); setAnchor(undefined); setDrawing(false); setAbout(undefined) }} />
  ) : null
  const versions = p.versions.filter(v => v.id !== p.proposal)
  const fs = chat.fullscreen

  return (
    <div className={cn('flex flex-col bg-panel text-fg', fs?.on ? 'h-screen' : 'h-[680px]')}>
      <ExportDialog dir={p.dir} open={exporting} onOpenChange={setExporting} />
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <img src={logo} alt="" className="size-6 shrink-0 rounded-md" />
        <span className="text-[11px] font-extrabold tracking-[0.12em] text-amber">AGENTSHOT</span>
        <span className="min-w-0 max-w-[260px] truncate rounded-md bg-hover/80 px-1.5 py-0.5 text-xs text-dim" title={p.dir}>{p.title}</span>
        <select
          data-tour="versions"
          className="h-[22px] min-w-0 max-w-[240px] cursor-default appearance-none truncate rounded-md bg-hover/80 px-1.5 text-xs text-dim outline-none hover:text-fg"
          value={p.current} onChange={e => { void setCurrent(e.target.value) }} title="Versions"
        >
          {versions.map((v, i) => <option key={v.id} value={v.id}>v{i + 1} · {v.title}</option>)}
        </select>
        <span className="flex-1" />
        <Tip label={<>Undo <Kbd>⌘Z</Kbd></>} side="bottom"><Button size="iconSm" variant="ghost" aria-label="Undo" onClick={() => undoEdit(false)}><Undo2 /></Button></Tip>
        <Tip label={<>Redo <Kbd>⇧⌘Z</Kbd></>} side="bottom"><Button size="iconSm" variant="ghost" aria-label="Redo" onClick={() => undoEdit(true)}><Redo2 /></Button></Tip>
        <HistoryButton project={p} open={historyOpen} onOpenChange={setHistoryOpen} onRestored={np => { setP(np); setEditing(null) }} />
        {chat.upload && <Tip label="Add a video, picture or sound from this device" side="bottom">
          <Button size="iconSm" variant="ghost" disabled={!!sending} onClick={() => picker.current?.click()} aria-label="Add files"><FilePlus2 /></Button>
        </Tip>}
        <input ref={picker} type="file" multiple accept="video/*,audio/*,image/*" hidden onChange={e => { void addFiles(Array.from(e.target.files || []).filter(f => f.size > 0)); e.target.value = '' }} />
        <Tip label="Files: everything you brought in" side="bottom">
          <Button size="iconSm" variant={footage ? 'secondary' : 'ghost'} onClick={() => setFootage(x => !x)} aria-label="Files"><Images /></Button>
        </Tip>
        {fs && <Tip label={fs.on ? 'Back into the chat' : 'Fill the window'} side="bottom">
          <Button size="iconSm" variant="ghost" onClick={fs.toggle} aria-label={fs.on ? 'Back into the chat' : 'Fill the window'}>{fs.on ? <Minimize2 /> : <Maximize2 />}</Button>
        </Tip>}
        <Button data-tour="export" size="sm" variant="primary" onClick={() => setExporting(true)}><Upload />Export</Button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 bg-canvas p-3">
        {footage && <FootagePanel project={p} onClose={() => setFootage(false)} onInsert={rel => { setFootage(false); insertFootage(rel, time) }} />}
        {proposal && (
          <div data-tour="proposal" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-1.5">
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
        {onScreen.timeline?.demo?.warning && <p className="px-2 text-xs text-dim">{onScreen.timeline.demo.warning}</p>}
        {onScreen.timeline?.demo?.summary && <p data-edit-summary className="rounded-lg bg-ok/10 px-3 py-2 text-xs text-fg"><strong>Cleanup:</strong> {onScreen.timeline.demo.summary.message}</p>}

        <div data-tour="picture" className="relative min-h-0 flex-1">
          {previewCopy.state?.status === 'running' && (
            <div data-preview-status className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
              <Loader2 className="size-4 shrink-0 animate-spin text-amber" />
              <span>Making a preview copy for smooth playback… {Math.round((previewCopy.state.progress || 0) * 100)}%</span>
            </div>
          )}
          {previewCopy.state?.status === 'failed' && <div data-preview-status className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
            <span className="flex-1" title={previewCopy.state.error}>Preview copy failed. Playing the original where supported.</span>
            <Button size="sm" variant="secondary" onClick={previewCopy.retry}>Retry preview</Button>
          </div>}
          {editing && p.clips?.[editing.clip] && (
            <ClipEditor
              dir={p.dir} clip={p.clips[editing.clip]}
              width={(onScreen.timeline || p.timeline)!.width} height={(onScreen.timeline || p.timeline)!.height}
              time={time - editing.start} picked={anchor?.clip?.element}
              onPick={el => { setAnchor({ t0: time, clip: { id: editing.clip, element: el } }); setInline(true) }}
              onClose={() => setEditing(null)}
            />
          )}
          <Stage
            ref={stage}
            src={mediaUrl(`${p.dir}/${p.proxies?.[playable] || playable}`)}
            edit={liveEdit}
            cameraEditing={!!cameraMode}
            cameraMode={cameraMode}
            videoEditing={videoEditing}
            onVideoFraming={framing => { if (selectedVideo?.kind === 'media') void doEdit([{ op: 'frame', ids: [selectedVideo.id], framing }]) }}
            onCameraLayout={layout => doEdit([{ op: 'camera', layout }])}
            onSource={setSource}
            notes={p.notes}
            time={time}
            drawing={drawing}
            box={anchor?.box}
            working={false}
            onBox={(b: Box) => { setAnchor(a => ({ t0: a?.t0 ?? time, t1: a?.t1, box: b })); setDrawing(false); setInline(true) }}
            ask={anchor?.box ? inlineAsk : undefined}
            onTime={setTime}
            onDuration={setDuration}
            onPlaying={setPlaying}
          />
        </div>

        <div data-contextual-tools className="max-h-[34vh] shrink-0 space-y-2 overflow-auto">
          {tl.demo && !proposal && <CameraControls timeline={tl} onEdit={doEdit} mode={cameraMode} sourceUrl={mediaUrl(`${p.dir}/${tl.demo.camera}`)} sourceInfo={p.media[tl.demo.camera]} sourceTime={cameraAt(tl, time)?.at || 0} onMode={v => { setCameraMode(v); if (v) { setVideoEditing(false); revealCamera(tl) } }} />}
          {selectedVideo?.kind === 'media' && !proposal && <VideoControls item={selectedVideo} onEdit={doEdit} editing={videoEditing} onEditing={v => { stage.current?.video?.pause(); setVideoEditing(v); if (v) setCameraMode(null) }} />}
        </div>
        <div className="max-h-[42vh] shrink-0 space-y-2 overflow-y-auto">
          <Scrubber
            dir={p.dir}
            revision={onScreen.createdAt}
            fps={live ? tl.fps : p.media[onScreen.path]?.fps || 30}
            duration={duration}
            time={time}
            reveal={reveal}
            notes={p.notes}
            range={anchor}
            ranges={[]}
            track={track}
            clips={p.clips || {}}
            voiceoverAssets={p.voiceovers}
            liveVoiceover={liveVoiceover}
            onAttachVoiceover={src => { stage.current?.video?.pause(); setAbout(`@${voiceoverName(p.voiceovers || [], src)}`); setAnchor({ t0: time }); setInline(true) }}
            selected={selectedPiece ?? editing?.itemId ?? null}
            onSelect={id => { stage.current?.video?.pause(); setSelectedPiece(id) }}
            moveMode={moveMode}
            onExitMove={() => setMoveMode(false)}
            status={edited && !proposal ? <EditStatus saving={saving} onSave={saveVersion} /> : null}
            onSeek={t => { if (!recordingVoiceover) seek(t) }}
            onRange={r => setAnchor(r ? { ...r, box: anchor?.box } : undefined)}
            onRangeEnd={r => { stage.current?.video?.pause(); setAnchor({ t0: r.t0, t1: r.t1 }); setInline(true) }}
            ask={anchor && !anchor.box && !anchor.clip ? inlineAsk : undefined}
            onNote={n => seek(n.anchor.t0)}
            movable={!proposal && !recordingVoiceover}
            onEdit={async edits => { stage.current?.video?.pause(); try { setP(await window.agentshot.timeline.edit(p.dir, edits)) } catch (e) { fail(e) } }}
            onMove={(id, before) => doEdit([{ op: 'move', id, ...(before ? { before } : {}) }])}
            onInsert={insertFootage}
            onOpenClip={(id, clip, start) => {
              stage.current?.video?.pause()
              seek(start + Math.min((p.clips?.[clip]?.duration ?? 2) / 2, 1))
              setEditing({ itemId: id, clip, start })
            }}
          />

          <div data-timeline-transport className="flex flex-wrap items-center gap-1">
            <Button size="iconSm" variant="ghost" disabled={recordingVoiceover} onClick={playPause} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
            </Button>
            <GoToTime ref={goTo} time={time} duration={duration} disabled={recordingVoiceover} onGo={t => { stage.current?.video?.pause(); seek(t); setReveal(r => ({ t, key: r.key + 1 })) }} />
            <span className="flex-1" />
            <div data-manual-tools className="flex flex-wrap items-center gap-1">
              <Tip label={moveMode ? 'Move mode is on. Click Move clip again to turn it off, or press Esc.' : 'Click to enable moving, then grab a clip and drag it to a new position.'}>
                <Button size="sm" variant="ghost" className={cn('border border-transparent', moveMode && 'border-amber bg-amber-soft text-amber hover:bg-amber-soft hover:text-amber')} aria-label="Move clip" aria-pressed={moveMode} disabled={!!proposal || recordingVoiceover || track.items.length < 2} onClick={() => { stage.current?.video?.pause(); setMoveMode(v => !v) }}><MoveHorizontal />Move clip</Button>
              </Tip>
              <Tip label={<>Note at the playhead <Kbd>N</Kbd></>}>
                <Button size="sm" variant="ghost" disabled={recordingVoiceover} onClick={noteHere}><MessageSquarePlus />Note</Button>
              </Tip>
              <Tip label={<>Draw a box on the picture <Kbd>B</Kbd></>}>
                <Button data-tour="box" size="sm" variant={drawing ? 'secondary' : 'ghost'} disabled={recordingVoiceover} onClick={() => { stage.current?.video?.pause(); setDrawing(d => !d) }}><SquareDashed />Box</Button>
              </Tip>
              <Tip label="Split the selected clip at the playhead">
                <Button size="sm" variant="ghost" aria-label="Split" disabled={!!proposal || recordingVoiceover || !canSplit} onClick={() => { stage.current?.video?.pause(); void doEdit([{ op: 'split', at: time }]) }}><SplitSquareHorizontal />Split</Button>
              </Tip>
            </div>
            <Button size="sm" variant={voiceoverOpen ? 'secondary' : 'ghost'} disabled={!!proposal || voiceoverOpen || duration <= 0} onClick={() => { stage.current?.video?.pause(); setVoiceoverOpen(true); setMoveMode(false) }}><Mic />Voiceover <span className="text-[10px] font-semibold text-amber">PRO</span></Button>
          </div>
          {moveMode && <p className="text-right text-xs text-amber">Drag a clip to move it · Click Move clip again to turn off · Esc also exits</p>}
          {sending && (
            <div role="status" className="space-y-1 rounded-lg bg-hover/60 px-3 py-2 text-xs">
              <p className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin text-amber" />Sending {sending.name}… {Math.round(sending.done * 100)}%</p>
              <div className="h-1 overflow-hidden rounded-full bg-hover"><div className="h-full bg-amber" style={{ width: `${sending.done * 100}%` }} /></div>
            </div>
          )}
          {(notice || problem) && (
            <p role="status" className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-xs', problem ? 'bg-red-500/10 text-red-400' : 'bg-ok/10')}>
              {!problem && <Check className="size-4 text-ok" />}
              <span className="flex-1">{problem || notice}</span>
              <button aria-label="Dismiss" onClick={() => { setNotice(''); setProblem('') }}><X className="size-3" /></button>
            </p>
          )}
          {voiceoverOpen && <VoiceoverRecorder key={p.conversation} project={p} time={time} duration={duration} active onLive={setLiveVoiceover} onClose={() => setVoiceoverOpen(false)} onRecording={(on, paused) => {
            setRecordingVoiceover(on)
            const v = stage.current?.video
            if (v) { if (on && !paused) void v.play().catch(() => {}); else { v.pause(); setTime(v.currentTime) } }
          }} onSaved={next => {
            setP(next)
            setNotice('Voiceover added to your video. You can trim, move or adjust it, or ask for changes in the chat.')
            chat.note('In the AgentShot editor the user recorded a voiceover; it is in the film now.')
          }} />}
        </div>
      </div>
    </div>
  )
}
