// The film beside the chat: the proposal to decide on, the picture, the timeline and the transport. One panel for the
// app (ProjectView, beside AgentShot's chat) and for AgentShot inside Claude or ChatGPT (src/mcp-app/ChatEditor, beside
// theirs). useFilm holds what it plays and how it edits; FilmPanel draws it. What differs is passed in: where a note,
// a box or a range is asked, what a recorded voiceover becomes, how a problem is shown.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Check, Loader2, MessageSquarePlus, MoveHorizontal, Mic, Pause, Play, SplitSquareHorizontal, SquareDashed, X } from 'lucide-react'
import { Stage, type LiveEdit, type StageHandle } from './Stage'
import { Scrubber } from './Scrubber'
import { VideoControls } from './VideoControls'
import { CameraControls } from './CameraControls'
import { EditStatus } from './EditStatus'
import { ClipEditor } from './ClipEditor'
import { VoiceoverRecorder } from './VoiceoverPanel'
import type { LiveVoiceover } from './VoiceoverTimeline'
import { GoToTime } from '@/components/GoToTime'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { useLiveMix, type MixSource } from '@/lib/liveMix'
import { usePreview } from '@/lib/preview'
import { cn, mediaUrl } from '@/lib/utils'
import { dbToGain, type Mix } from '../../../shared/mix'
import { sameCut, sourceAt, timelineOfFile, itemAt, starts, length, type Edit } from '../../../shared/timeline'
import { cameraAt, cameraRange } from '../../../shared/demo'
import type { Anchor, Box, Project } from '../../../shared/types'

export type FilmOptions = {
  p: Project
  setP(p: Project): void
  /** a call that failed: say so (the app: a dialog; the chat: a line under the timeline) */
  fail(e: unknown): void
  /** after a hand edit, a saved version, a decided proposal: the chat tells its model */
  onEdited?(edits: Edit[]): void
  onSaved?(): void
  onDecided?(accept: boolean, title?: string): void
  /** changes when the page's files arrive another way (the chat): the live edit is made again */
  mediaVersion?: number
}

/** What the film panel plays and how it edits: its state, and the calls that change the project. */
export function useFilm(o: FilmOptions) {
  const { p, setP, fail } = o
  const stage = useRef<StageHandle>(null)
  const goTo = useRef<HTMLInputElement>(null)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [selectedPiece, setSelectedPiece] = useState<string | null>(null)
  const [moveMode, setMoveMode] = useState(false)
  const [compare, setCompare] = useState<'after' | 'before'>('after')
  const [cameraMode, setCameraMode] = useState<'move' | 'frame' | null>(null)
  const [videoEditing, setVideoEditing] = useState(false)
  const [source, setSource] = useState<MixSource | null>(null)
  const [saving, setSaving] = useState(false)
  const [regions, setRegions] = useState<[number, number][]>([])
  // a motion clip open on the picture, to adjust or point at one of its elements
  const [editing, setEditing] = useState<{ itemId: string; clip: string; start: number } | null>(null)
  const [voiceoverOpen, setVoiceoverOpen] = useState(false)
  const [recordingVoiceover, setRecordingVoiceover] = useState(false)
  const [liveVoiceover, setLiveVoiceover] = useState<LiveVoiceover | null>(null)
  const [notice, setNotice] = useState('')
  // a typed time: the zoomed timeline scrolls to show it
  const [reveal, setReveal] = useState({ t: 0, key: 0 })
  useEffect(() => { if (p.proposal) setCompare('after') }, [p.proposal])

  const seek = (t: number) => { const v = stage.current?.video; if (v) v.currentTime = t; setTime(t) }
  const playPause = () => { const v = stage.current?.video; if (v) v.paused ? v.play() : v.pause() }

  const current = p.versions.find(v => v.id === p.current)!
  const proposal = p.proposal ? p.versions.find(v => v.id === p.proposal) : undefined
  const onScreen = proposal && compare === 'after' ? proposal : current
  // The edit (p.timeline) changed since the version on screen was rendered (the agent can leave it so): it plays from
  // its pieces until it's saved as a version.
  const tl = p.timeline!
  const edited = useMemo(() => !sameCut(tl, current.timeline ?? (p.media[current.path] ? timelineOfFile(current.path, p.media[current.path]) : tl)), [tl, current, p.media])
  const live = (edited || (cameraMode && !!tl.demo) || videoEditing) && onScreen === current
  // what the timeline shows: the edit, or the proposal's pieces while it is on screen
  // Fallback timelines generate piece ids: retain them across clock updates so thumbnails do not remount.
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
  }, [live, tl, p.dir, p.proxies, p.clips, cameraMode, o.mediaVersion]) // eslint-disable-line react-hooks/exhaustive-deps
  // the mix the version on screen was rendered with (or the edit's), heard live over its dry film
  const mix: Mix = (live ? tl.mix : onScreen.timeline?.mix) || { filmDb: 0 }
  const speechKey = live ? JSON.stringify([tl.items, tl.mix?.voiceovers]) : onScreen.id
  useEffect(() => { window.agentshot.mix.speech(p.dir, live ? 'edit' : onScreen.id).then(setRegions).catch(() => setRegions([])) }, [p.dir, speechKey, p.transcripts]) // eslint-disable-line react-hooks/exhaustive-deps
  useLiveMix(source, p.dir, recordingVoiceover ? { filmDb: -100 } : mix, regions)

  /** Change the edit by hand (a piece moved, footage dropped in): it plays at once, ⌘Z undoes it. */
  const doEdit = async (edits: Edit[], then?: number) => {
    try { setP(await window.agentshot.timeline.edit(p.dir, edits)); if (then != null) seek(then); o.onEdited?.(edits) } catch (e) { fail(e) }
  }
  const insertFootage = (rel: string, t: number) => {
    const m = p.media[rel]
    if (!m?.width || !(m.duration > 0)) return fail(new Error(`${rel.split('/').pop()} isn't footage that can go in the film.`))
    void doEdit([{ op: 'insert', at: t, src: rel, in: 0, out: Math.round(m.duration * 1000) / 1000 }], t)
  }
  const undoEdit = async (redo: boolean) => { try { setP(await window.agentshot.timeline.undo(p.dir, redo)) } catch (e) { fail(e) } }
  const saveVersion = async () => {
    setSaving(true)
    try { await window.agentshot.timeline.render(p.dir); o.onSaved?.() } catch (e) { fail(e) } finally { setSaving(false) }
  }
  const decide = async (accept: boolean) => {
    try { setP(await window.agentshot.project.decide(p.dir, accept)); o.onDecided?.(accept, proposal?.title) } catch (e) { fail(e) }
  }

  const playable = onScreen.dry || onScreen.path
  const liveItem = live ? sourceAt(tl, time)?.item : undefined
  const previewMedia = liveItem?.kind === 'media' ? liveItem.src : liveItem?.kind === 'clip' ? p.clips?.[liveItem.clip]?.video || '' : playable
  const previewCopy = usePreview(p.dir, previewMedia)
  const selectedVideo = sourceAt(tl, time)?.item
  /** Put the playhead where the face camera shows, when it doesn't here. */
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

  return {
    stage, goTo, time, setTime, duration, setDuration, playing, setPlaying, selectedPiece, setSelectedPiece, moveMode, setMoveMode,
    compare, setCompare, cameraMode, setCameraMode, videoEditing, setVideoEditing, setSource, saving, editing, setEditing,
    voiceoverOpen, setVoiceoverOpen, recordingVoiceover, setRecordingVoiceover, liveVoiceover, setLiveVoiceover, notice, setNotice,
    reveal, setReveal, current, proposal, onScreen, tl, edited, live, track, canSplit, liveEdit, playable, previewCopy, selectedVideo,
    seek, playPause, doEdit, insertFootage, undoEdit, saveVersion, decide, revealCamera,
  }
}
export type Film = ReturnType<typeof useFilm>

export type FilmPanelProps = {
  film: Film
  p: Project
  setP(p: Project): void
  fail(e: unknown): void
  /** where the user points: a moment, a range, a box, a clip's element (shared with the chat's message box) */
  anchor?: Anchor
  setAnchor(a: Anchor | undefined | ((a: Anchor | undefined) => Anchor | undefined)): void
  drawing: boolean
  setDrawing(d: boolean | ((d: boolean) => boolean)): void
  /** the message box at the selection, or nothing */
  inlineAsk: ReactNode
  /** the note at the playhead (N, the Note button) */
  noteHere(): void
  /** a box was drawn: ask about it there */
  onBox(): void
  /** a clip's element was picked on the picture */
  onClipPick(anchor: Anchor): void
  /** a range dragged on the timeline, as it changes and when let go */
  onRange?(r: { t0: number; t1: number } | null): void
  onRangeEnd(r: { t0: number; t1: number }): void
  /** ranges written in the chat's message box, shown on the timeline */
  ranges?: Parameters<typeof Scrubber>[0]['ranges']
  /** "talk about this voiceover" on the timeline */
  onAttachVoiceover(src: string): void
  /** a voiceover was recorded and saved into the film */
  onVoiceoverSaved(next: Project, src: string): void
  /** the agent is working: the picture says so, and a voiceover waits */
  working?: boolean
  /** this project is the one on screen (a background one doesn't record) */
  active?: boolean
  /** the face camera's controls: here (the chat), or in the chat's own card beside the agent's message (the app) */
  cameraHere?: boolean
  /** drawn over the column: the browser, Files */
  overlays?: ReactNode
  /** under the transport: what the chat adds (an upload on its way…) */
  extra?: ReactNode
  /** a problem to show under the timeline (the chat; the app shows a dialog) */
  problem?: string
  onDismissProblem?(): void
}

/** The film's column: the proposal to decide on, the picture, the timeline, and the transport. */
export function FilmPanel(x: FilmPanelProps) {
  const { film: f, p, setP, anchor } = x
  const { stage, time, tl, proposal, onScreen, selectedVideo, recordingVoiceover } = f
  return (
    <>
      {x.overlays}
      {proposal && (
        <div data-tour="proposal" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-1.5">
          <span className="font-medium text-amber">Proposed:</span>
          <span className="min-w-0 flex-1 truncate">{proposal.title}</span>
          <div className="inline-flex rounded-md border border-line bg-panel p-0.5">
            {(['before', 'after'] as const).map(k => (
              <button key={k} onClick={() => f.setCompare(k)} className={cn('rounded px-2 py-0.5 text-xs capitalize', f.compare === k ? 'bg-raised text-fg' : 'text-dim')}>{k}</button>
            ))}
          </div>
          <Button size="sm" variant="ghost" onClick={() => f.decide(false)}><X />Reject</Button>
          <Button size="sm" variant="primary" onClick={() => f.decide(true)}><Check />Accept</Button>
        </div>
      )}
      {onScreen.timeline?.demo?.warning && <p className="px-2 text-xs text-dim">{onScreen.timeline.demo.warning}</p>}
      {onScreen.timeline?.demo?.summary && <p data-edit-summary className="rounded-lg bg-ok/10 px-3 py-2 text-xs text-fg"><strong>Cleanup:</strong> {onScreen.timeline.demo.summary.message}</p>}

      <div data-tour="picture" className="relative min-h-0 flex-1">
        {f.previewCopy.state?.status === 'running' && (
          <div data-preview-status className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
            <Loader2 className="size-4 shrink-0 animate-spin text-amber" />
            <span>Making a preview copy for smooth playback… {Math.round((f.previewCopy.state.progress || 0) * 100)}%</span>
          </div>
        )}
        {f.previewCopy.state?.status === 'failed' && <div data-preview-status className="absolute bottom-3 left-3 right-3 z-10 flex items-center gap-2 rounded-lg bg-black/80 px-3 py-2 text-xs text-white">
          <span className="flex-1" title={f.previewCopy.state.error}>Preview copy failed. Playing the original where supported.</span>
          <Button size="sm" variant="secondary" onClick={f.previewCopy.retry}>Retry preview</Button>
        </div>}
        {f.editing && p.clips?.[f.editing.clip] && (
          <ClipEditor
            dir={p.dir}
            clip={p.clips[f.editing.clip]}
            width={(onScreen.timeline || p.timeline)!.width}
            height={(onScreen.timeline || p.timeline)!.height}
            time={time - f.editing.start}
            picked={anchor?.clip?.element}
            onPick={el => x.onClipPick({ t0: time, clip: { id: f.editing!.clip, element: el } })}
            onClose={() => f.setEditing(null)}
          />
        )}
        <Stage
          ref={stage}
          src={mediaUrl(`${p.dir}/${p.proxies?.[f.playable] || f.playable}`)}
          edit={f.liveEdit}
          cameraEditing={!!f.cameraMode}
          cameraMode={f.cameraMode}
          videoEditing={f.videoEditing}
          onVideoFraming={framing => { if (selectedVideo?.kind === 'media') void f.doEdit([{ op: 'frame', ids: [selectedVideo.id], framing }]) }}
          onCameraLayout={layout => f.doEdit([{ op: 'camera', layout }])}
          onSource={f.setSource}
          notes={p.notes}
          time={time}
          drawing={x.drawing}
          box={anchor?.box}
          working={!!x.working}
          onBox={(b: Box) => { x.setAnchor(a => ({ t0: a?.t0 ?? time, t1: a?.t1, box: b })); x.setDrawing(false); x.onBox() }}
          ask={anchor?.box ? x.inlineAsk : undefined}
          onTime={f.setTime}
          onDuration={f.setDuration}
          onPlaying={f.setPlaying}
        />
      </div>

      <div data-contextual-tools className="max-h-[34vh] shrink-0 space-y-2 overflow-auto">
        {x.cameraHere && tl.demo && !proposal && <CameraControls timeline={tl} onEdit={f.doEdit} mode={f.cameraMode} sourceUrl={mediaUrl(`${p.dir}/${tl.demo.camera}`)} sourceInfo={p.media[tl.demo.camera]} sourceTime={cameraAt(tl, time)?.at || 0} onMode={v => { f.setCameraMode(v); if (v) { f.setVideoEditing(false); f.revealCamera(tl) } }} />}
        {(x.cameraHere || !tl.demo) && selectedVideo?.kind === 'media' && !proposal && <VideoControls item={selectedVideo} onEdit={f.doEdit} editing={f.videoEditing} onEditing={v => { stage.current?.video?.pause(); f.setVideoEditing(v); if (v) f.setCameraMode(null) }} />}
      </div>
      <div className="max-h-[42vh] shrink-0 space-y-2 overflow-y-auto">
        <Scrubber
          dir={p.dir}
          revision={onScreen.createdAt}
          fps={f.live ? tl.fps : p.media[onScreen.path]?.fps || 30}
          duration={f.duration}
          time={time}
          reveal={f.reveal}
          notes={p.notes}
          range={anchor}
          ranges={x.ranges || []}
          track={f.track}
          clips={p.clips || {}}
          voiceoverAssets={p.voiceovers}
          liveVoiceover={f.liveVoiceover}
          onAttachVoiceover={x.onAttachVoiceover}
          selected={f.selectedPiece ?? f.editing?.itemId ?? null}
          onSelect={id => { stage.current?.video?.pause(); f.setSelectedPiece(id) }}
          moveMode={f.moveMode}
          onExitMove={() => f.setMoveMode(false)}
          status={f.edited && !proposal ? <EditStatus saving={f.saving} onSave={f.saveVersion} /> : null}
          onSeek={t => { if (!recordingVoiceover) f.seek(t) }}
          onRange={r => { x.setAnchor(r ? { ...r, box: anchor?.box } : undefined); x.onRange?.(r) }}
          onRangeEnd={r => { stage.current?.video?.pause(); x.onRangeEnd(r) }}
          ask={anchor && !anchor.box && !anchor.clip ? x.inlineAsk : undefined}
          onNote={n => f.seek(n.anchor.t0)}
          movable={!proposal && !recordingVoiceover}
          onEdit={async edits => { stage.current?.video?.pause(); try { setP(await window.agentshot.timeline.edit(p.dir, edits)) } catch (e) { x.fail(e) } }}
          onMove={(id, before) => f.doEdit([{ op: 'move', id, ...(before ? { before } : {}) }])}
          onInsert={f.insertFootage}
          onOpenClip={(id, clip, start) => {
            stage.current?.video?.pause()
            f.seek(start + Math.min((p.clips?.[clip]?.duration ?? 2) / 2, 1))
            f.setEditing({ itemId: id, clip, start })
          }}
        />

        <div data-timeline-transport className="flex flex-wrap items-center gap-1">
          <Button size="iconSm" variant="ghost" disabled={recordingVoiceover} onClick={f.playPause} aria-label={f.playing ? 'Pause' : 'Play'}>
            {f.playing ? <Pause className="fill-current" /> : <Play className="fill-current" />}
          </Button>
          <GoToTime ref={f.goTo} time={time} duration={f.duration} disabled={recordingVoiceover} onGo={t => { stage.current?.video?.pause(); f.seek(t); f.setReveal(r => ({ t, key: r.key + 1 })) }} />
          <span className="flex-1" />
          <div data-manual-tools className="flex flex-wrap items-center gap-1">
            <Tip label={f.moveMode ? 'Move mode is on. Click Move clip again to turn it off, or press Esc.' : 'Click to enable moving, then grab a clip and drag it to a new position.'}>
              <Button size="sm" variant="ghost" className={cn('border border-transparent', f.moveMode && 'border-amber bg-amber-soft text-amber hover:bg-amber-soft hover:text-amber')} aria-label="Move clip" aria-pressed={f.moveMode} aria-describedby={f.moveMode ? 'move-clip-hint' : undefined} disabled={!!proposal || recordingVoiceover || f.track.items.length < 2} onClick={() => { stage.current?.video?.pause(); f.setMoveMode(v => !v) }}><MoveHorizontal />Move clip</Button>
            </Tip>
            <Tip label={<>Note at the playhead <Kbd>N</Kbd></>}>
              <Button size="sm" variant="ghost" disabled={recordingVoiceover} onClick={x.noteHere}><MessageSquarePlus />Note</Button>
            </Tip>
            <Tip label={<>Draw a box on the picture <Kbd>B</Kbd></>}>
              <Button data-tour="box" size="sm" variant={x.drawing ? 'secondary' : 'ghost'} disabled={recordingVoiceover} onClick={() => { stage.current?.video?.pause(); x.setDrawing(d => !d) }}><SquareDashed />Box</Button>
            </Tip>
            <Tip label="Split the selected clip at the playhead">
              <Button size="sm" variant="ghost" aria-label="Split" disabled={!!proposal || recordingVoiceover || !f.canSplit} onClick={() => { stage.current?.video?.pause(); void f.doEdit([{ op: 'split', at: time }]) }}><SplitSquareHorizontal />Split</Button>
            </Tip>
          </div>
          <Button size="sm" variant={f.voiceoverOpen ? 'secondary' : 'ghost'} disabled={!!proposal || f.voiceoverOpen || !!x.working || f.duration <= 0} onClick={() => { stage.current?.video?.pause(); f.setVoiceoverOpen(true); f.setMoveMode(false) }}><Mic />Voiceover <span className="text-[10px] font-semibold text-amber">PRO</span></Button>
        </div>
        {f.moveMode && <p id="move-clip-hint" className="text-right text-xs text-amber">Drag a clip to move it · Click Move clip again to turn off · Esc also exits</p>}
        {x.extra}
        {x.problem && <p role="alert" className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400"><span className="flex-1">{x.problem}</span><button aria-label="Dismiss" onClick={x.onDismissProblem}><X className="size-3" /></button></p>}
        {f.notice && <p role="status" className="flex items-center gap-2 rounded-lg bg-ok/10 px-3 py-2 text-xs"><Check className="size-4 text-ok" /><span className="flex-1">{f.notice}</span><button aria-label="Dismiss voiceover notification" onClick={() => f.setNotice('')}><X className="size-3" /></button></p>}
        {f.voiceoverOpen && <VoiceoverRecorder key={p.conversation} project={p} time={time} duration={f.duration} active={x.active ?? true} onLive={f.setLiveVoiceover} onClose={() => f.setVoiceoverOpen(false)} onRecording={(on, paused) => {
          f.setRecordingVoiceover(on)
          const v = stage.current?.video
          if (v) { if (on && !paused) void v.play().catch(() => {}); else { v.pause(); f.setTime(v.currentTime) } }
        }} onSaved={(next, src) => { setP(next); x.onVoiceoverSaved(next, src) }} />}
      </div>
    </>
  )
}
