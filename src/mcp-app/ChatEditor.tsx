// AgentShot's editor inside Claude or ChatGPT: the app's own film panel (FilmPanel, as beside AgentShot's chat in the
// app), under a header of its own (versions, undo, history, files, export). The chat it sits in is the agent: a note,
// a box or a range is asked there, as the user's message, and what the user does by hand is told to its model.
import { useEffect, useRef, useState } from 'react'
import { FilePlus2, Images, Loader2, Maximize2, Minimize2, Redo2, Undo2, Upload } from 'lucide-react'
import { FilmPanel, useFilm } from '@/views/FilmPanel'
import { ExportDialog } from '@/views/ExportDialog'
import { FootagePanel } from '@/views/FootagePanel'
import { HistoryButton } from '@/components/HistoryButton'
import { InlineAsk } from '@/components/InlineAsk'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { Kbd } from '@/components/ui/kbd'
import { cn, timecode } from '@/lib/utils'
import { voiceoverName } from '../shared/voiceover'
import type { Anchor, Project } from '../shared/types'
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
  const [problem, setProblem] = useState('')
  const fail = (e: unknown) => setProblem(clean(e))
  const film = useFilm({
    p, setP, fail, mediaVersion,
    onEdited: edits => chat.note(`In the AgentShot editor the user changed the edit by hand (${edits.map(e => e.op).join(', ')}); it isn't rendered yet.`),
    onSaved: () => chat.note('In the AgentShot editor the user saved the edit as a new version.'),
    onDecided: (accept, title) => chat.note(accept ? `In the AgentShot editor the user kept the proposed cut "${title}". It's the current version now.` : `In the AgentShot editor the user sent back the proposed cut "${title}". The version they had stays.`),
  })
  const { stage, time, duration, recordingVoiceover, proposal, onScreen, edited } = film
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  const [inline, setInline] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [footage, setFootage] = useState(false)
  // what the ask at the selection is about, when it isn't the film's time (a voiceover to talk about)
  const [about, setAbout] = useState<string | undefined>()
  const picker = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState<{ name: string; done: number } | null>(null)

  useEffect(() => window.agentshot.project.onChange(np => { if (np.dir === p.dir) setP(np) }), [p.dir])
  useEffect(() => { if (!anchor) { setInline(false); setAbout(undefined) } }, [anchor])
  // another version on screen, or a cut to decide on: the face camera and framing tools close
  useEffect(() => { film.setCameraMode(null); film.setVideoEditing(false) }, [p.current, !!proposal]) // eslint-disable-line react-hooks/exhaustive-deps

  const noteHere = () => { stage.current?.video?.pause(); setAnchor(a => (a?.t1 != null ? a : { t0: time })); setInline(true) }

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
    film.setNotice('Sent to the chat.')
  }

  /** Files the user chose, into this project one after another; then Files shows them, to put in the film. */
  const addFiles = async (files: File[]) => {
    if (!chat.upload || sending) return
    for (const file of files) {
      setSending({ name: file.name, done: 0 })
      try { await chat.upload(file, done => setSending({ name: file.name, done })) }
      catch (e) { fail(e); setSending(null); return }
    }
    setSending(null)
    film.setNotice(files.length === 1 ? `${files[0].name} is in the project. Put it in the film from Files.` : `${files.length} files are in the project. Put them in the film from Files.`)
    setFootage(true)
  }

  const setCurrent = async (id: string) => {
    if (edited && !confirm('The edit isn’t saved as a version. Switch anyway? (History keeps it.)')) return
    try { setP(await window.agentshot.project.setCurrent(p.dir, id)) } catch (e) { fail(e) }
  }

  // keyboard, as in the app: Space · N note · B box · G go to · ←/→ ±1 s (⇧ ±5 s) · ⌘Z / ⇧⌘Z · Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (recordingVoiceover || (e.target as HTMLElement).closest('textarea, input, select')) return
      const v = stage.current?.video
      const mod = e.metaKey || e.ctrlKey
      if (e.key === ' ') { e.preventDefault(); film.playPause() }
      else if (mod && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); void film.undoEdit(e.shiftKey) }
      else if (mod && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); void film.undoEdit(true) }
      else if ((e.key === 'n' || e.key === 'N') && !mod) { e.preventDefault(); noteHere() }
      else if ((e.key === 'b' || e.key === 'B') && !mod) { e.preventDefault(); v?.pause(); setDrawing(d => !d) }
      else if (e.key === 'ArrowLeft' && v) film.seek(Math.max(0, v.currentTime - (e.shiftKey ? 5 : 1)))
      else if (e.key === 'ArrowRight' && v) film.seek(Math.min(duration, v.currentTime + (e.shiftKey ? 5 : 1)))
      else if ((e.key === 'g' || e.key === 'G') && !mod && !e.altKey) { e.preventDefault(); film.goTo.current?.focus() }
      else if (e.key === 'Escape') { setAnchor(undefined); setDrawing(false); film.setEditing(null); film.setMoveMode(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

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
        <Tip label={<>Undo <Kbd>⌘Z</Kbd></>} side="bottom"><Button size="iconSm" variant="ghost" aria-label="Undo" onClick={() => film.undoEdit(false)}><Undo2 /></Button></Tip>
        <Tip label={<>Redo <Kbd>⇧⌘Z</Kbd></>} side="bottom"><Button size="iconSm" variant="ghost" aria-label="Redo" onClick={() => film.undoEdit(true)}><Redo2 /></Button></Tip>
        <HistoryButton project={p} open={historyOpen} onOpenChange={setHistoryOpen} onRestored={np => { setP(np); film.setEditing(null) }} />
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
        <FilmPanel
          film={film} p={p} setP={setP} fail={fail}
          anchor={anchor} setAnchor={setAnchor} drawing={drawing} setDrawing={setDrawing}
          inlineAsk={inlineAsk} noteHere={noteHere} onBox={() => setInline(true)}
          onClipPick={a => { setAnchor(a); setInline(true) }}
          onRangeEnd={r => { setAnchor({ t0: r.t0, t1: r.t1 }); setInline(true) }}
          onAttachVoiceover={src => { stage.current?.video?.pause(); setAbout(`@${voiceoverName(p.voiceovers || [], src)}`); setAnchor({ t0: time }); setInline(true) }}
          onVoiceoverSaved={() => {
            film.setNotice('Voiceover added to your video. You can trim, move or adjust it, or ask for changes in the chat.')
            chat.note('In the AgentShot editor the user recorded a voiceover; it is in the film now.')
          }}
          cameraHere
          overlays={footage && <FootagePanel project={p} onClose={() => setFootage(false)} onInsert={rel => { setFootage(false); film.insertFootage(rel, time) }} />}
          extra={sending && (
            <div role="status" className="space-y-1 rounded-lg bg-hover/60 px-3 py-2 text-xs">
              <p className="flex items-center gap-2"><Loader2 className="size-3.5 animate-spin text-amber" />Sending {sending.name}… {Math.round(sending.done * 100)}%</p>
              <div className="h-1 overflow-hidden rounded-full bg-hover"><div className="h-full bg-amber" style={{ width: `${sending.done * 100}%` }} /></div>
            </div>
          )}
          problem={problem} onDismissProblem={() => setProblem('')}
        />
      </div>
    </div>
  )
}
