import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Clapperboard, KeyRound, Loader2, Paperclip, X } from 'lucide-react'
import { extOf, kindByName } from '../../../shared/file-kinds'
import { FileIcon } from './FilesPanel'
import { JobsTray } from '@/components/JobsTray'
import { ModelPicker } from '@/components/ModelPicker'
import { Button } from '@/components/ui/button'
import { Tip } from '@/components/ui/tooltip'
import { ManulMascot } from '@/components/mascot/ManulMascot'
import { Gallery, inputsOf, useGallery } from '@/components/Gallery'
import { ASPECTS, aspectOf, type Aspect } from '../../../shared/motion-formats'
import { wantsWalkthrough } from '../../../shared/walkthrough'
import { MAC, cn } from '@/lib/utils'
import type { GalleryExample, Project } from '../../../shared/types'

const IDEAS = ['Cut the ums and long pauses', 'Make a 60-second vertical for Shorts', 'Add a fade in and fade out', 'Trim to the best 30 seconds', 'Make a product walkthrough of my web app']
const message = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** A motion or walkthrough project's name: the first words of what the user asked for (a link as its site), else the
 *  example's title. */
const titleOf = (prompt: string, example: GalleryExample | null) =>
  prompt.replace(/https?:\/\/(?:www\.)?([^/\s:]+)\S*/g, '$1').split(/\s+/).slice(0, 6).join(' ').replace(/[.,:;!?]+$/, '') || example?.title || 'Motion video'

/** The home screen: one message box, and below it the motion gallery. Files with a video make an edit; no footage (a
 *  brief, an example or a reference video) makes a motion video on a blank canvas, or, when the brief asks for a
 *  walkthrough of a product, a walkthrough AgentShot films in the browser. Selected files come with the first message. */
export function Start({ onOpen, onKeys, ready, lead }: { onOpen: (p: Project, prompt?: string, files?: string[]) => void; onKeys: () => void; onTools?: () => void; ready: boolean; lead?: ReactNode }) {
  const [files, setFiles] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [example, setExample] = useState<GalleryExample | null>(null)
  const [reference, setReference] = useState<string | null>(null)
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [model, setModel] = useState<Project['model']>()
  const gallery = useGallery()
  const input = useRef<HTMLTextAreaElement>(null)
  const top = useRef<HTMLDivElement>(null)
  // footage in the box means an edit; otherwise a brief, an example or a reference makes a motion video
  const footage = files.some(f => kindByName(f) === 'video')
  const walkthrough = !footage && !example && !reference && wantsWalkthrough(prompt)
  const motion = !footage && !walkthrough && !!(example || reference || prompt.trim())
  const canGo = !busy && (footage || motion || walkthrough || files.length > 0)
  const asks = inputsOf(example?.prompt)

  const focus = () => setTimeout(() => input.current?.focus(), 0)
  const choose = (paths: string[]) => {
    if (busy || !paths.length) return
    setFiles(x => [...new Set([...x, ...paths.filter(Boolean)])])
    setError(null)
    focus()
  }
  const useExample = (e: GalleryExample) => {
    setExample(e)
    setAspect(aspectOf(e))
    setError(null)
    top.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    focus()
  }
  const pickReference = async () => {
    if (busy) return
    try {
      const video = (await window.agentshot.project.pick()).find(f => kindByName(f) === 'video')
      if (video) { setReference(video); setError(null); focus() } else setError('A reference has to be a video.')
    } catch (e) { setError(message(e)) }
  }
  const go = async () => {
    if (!canGo) return
    setBusy(true)
    setError(null)
    try {
      if (walkthrough) {
        const p = await window.agentshot.project.createMotion({ title: titleOf(prompt, null), aspect: '16:9', walkthrough: true, files, model })
        onOpen(p, prompt.trim(), Object.keys(p.files || {}).filter(f => f !== p.walkthrough?.canvas))
        return
      }
      if (motion) {
        const p = await window.agentshot.project.createMotion({ title: titleOf(prompt, example), aspect, example: example?.id, reference: reference ?? undefined, files, model })
        const ask = prompt.trim() || (example ? `Make a video like “${example.title}”.` : 'Make a motion video in the style of the reference.')
        onOpen(p, ask, Object.keys(p.files || {}).filter(f => f !== p.motion?.canvas))
        return
      }
      const p = await window.agentshot.project.create(files, model)
      onOpen(p, prompt.trim() || undefined, Object.keys(p.files || {}))
    } catch (e) {
      setError(message(e))
      setBusy(false)
    }
  }
  const pickFiles = async () => {
    if (busy) return
    try { choose(await window.agentshot.project.pick()) } catch (e) { setError(message(e)) }
  }

  const placeholder = footage || files.length ? 'Tell AgentShot what to do with it…'
    : example ? 'What’s your video about?'
      : reference ? 'What should it be about? AgentShot takes the look, not the content…'
        : 'Describe a motion video or a product walkthrough, or drop footage to edit…'

  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { e.preventDefault(); if (!busy) setOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); choose(Array.from(e.dataTransfer.files).map(f => window.agentshot.pathForFile(f)).filter(Boolean)) }}
    >
      <div className={cn('drag flex h-[52px] shrink-0 items-center gap-1 pr-3', lead && MAC ? 'pl-[88px]' : 'pl-3')}>
        {lead}
        <span className="flex-1" />
        <JobsTray />
      </div>

      <div className="flex-1 overflow-auto">
        <div ref={top} className="mx-auto flex w-full max-w-[680px] flex-col items-center px-6 pt-[5vh]">
          <ManulMascot state={busy ? 'working' : prompt ? 'thinking' : 'idle'} size={120} className="shrink-0" />
          <h1 className="mb-7 mt-1 font-serif text-[34px] font-normal tracking-[-0.01em] text-fg">What are we making?</h1>

          <div className={cn('w-full rounded-2xl border bg-surface p-2.5 shadow-[0_1px_2px_var(--color-shade),0_6px_24px_-12px_var(--color-shade)] transition-colors',
            over ? 'border-amber bg-amber-soft' : 'border-line')}>
            {files.length > 0 ? (
              <div data-tour="import" className="mb-1 rounded-xl bg-raised px-3 py-2">
                <div className="mb-1 flex items-center justify-between gap-2 text-xs text-dim">
                  <span>{files.length} {files.length === 1 ? 'item selected' : 'items selected'}</span>
                  <button disabled={busy} onClick={pickFiles} className="text-amber hover:underline disabled:opacity-50">Add more files</button>
                </div>
                <div className="max-h-48 overflow-auto">
                  {files.map(f => (
                    <div key={f} data-selected-file className="flex items-center gap-2 py-1" title={f}>
                      <FileIcon kind={extOf(f) ? kindByName(f) ?? 'other' : 'folder'} className="size-4 shrink-0 text-amber" />
                      <span className="flex-1 truncate">{f.split('/').pop()}</span>
                      <button disabled={busy} className="rounded p-0.5 text-faint hover:text-fg disabled:opacity-50" onClick={() => setFiles(x => x.filter(y => y !== f))} aria-label={`Remove ${f.split('/').pop()}`}><X className="size-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {(example || reference) && (
              <div className="mb-1 flex flex-col gap-1.5">
                {example && (
                  <div data-picked-example className="flex items-center gap-3 rounded-xl bg-raised p-1.5 pr-2.5">
                    <img src={example.poster} alt="" className="h-11 w-[72px] shrink-0 rounded-lg object-cover" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-fg">{example.title}</div>
                      <div className="truncate text-[11.5px] text-faint">Made like @{example.creator.handle}’s example · prompt included</div>
                    </div>
                    <button disabled={busy} onClick={() => setExample(null)} aria-label={`Remove the example ${example.title}`} className="rounded p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-3.5" /></button>
                  </div>
                )}
                {reference && (
                  <div className="flex items-center gap-3 rounded-xl bg-raised px-3 py-2">
                    <Clapperboard className="size-4 shrink-0 text-amber" />
                    <div className="min-w-0 flex-1 truncate text-[13px] text-fg" title={reference}>Look of {reference.split('/').pop()}</div>
                    <button disabled={busy} onClick={() => setReference(null)} aria-label="Remove the reference" className="rounded p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-3.5" /></button>
                  </div>
                )}
              </div>
            )}

            <textarea
              data-tour="start-prompt"
              ref={input}
              rows={2}
              value={prompt}
              disabled={busy}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
              placeholder={placeholder}
              className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-faint"
            />
            <div className="flex items-center gap-1">
              <Tip label="Choose files"><button data-tour={files.length ? undefined : 'import'} disabled={busy} onClick={pickFiles} aria-label="Choose files" className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg disabled:opacity-50"><Paperclip className="size-4" /></button></Tip>
              {!footage && !reference && (
                <Tip label="Match the look of a video">
                  <button disabled={busy} onClick={pickReference} aria-label="Match the look of a video" className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg disabled:opacity-50"><Clapperboard className="size-4" /></button>
                </Tip>
              )}
              {motion && (
                <div role="radiogroup" aria-label="Format" className="ml-1 flex rounded-lg border border-line p-0.5">
                  {(Object.keys(ASPECTS) as Aspect[]).map(a => (
                    <button key={a} role="radio" aria-checked={aspect === a} disabled={busy} onClick={() => setAspect(a)}
                      className={cn('rounded-md px-2 py-0.5 text-[11.5px] tabular-nums', aspect === a ? 'bg-raised text-fg' : 'text-dim hover:text-fg')}>{a}</button>
                  ))}
                </div>
              )}
              {busy && <span role="status" className="ml-1 text-xs text-dim">{motion || walkthrough ? 'Setting up…' : `Importing ${files.length} ${files.length === 1 ? 'item' : 'items'}…`}</span>}
              <span className="flex-1" />
              <ModelPicker picked={model} onPick={setModel} disabled={busy} />
              <Button data-tour="start" size="icon" variant="primary" className="rounded-lg" disabled={!canGo} onClick={go} aria-label="Start">
                {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
              </Button>
            </div>
          </div>

          {walkthrough && <p data-walkthrough className="mt-2.5 w-full px-1 text-[12px] text-faint">AgentShot will try the product in its browser, show you the plan, then film it and narrate it.</p>}
          {asks && !footage && <p className="mt-2.5 w-full px-1 text-[12px] text-faint">AgentShot will ask you for {asks.charAt(0).toLowerCase() + asks.slice(1)}.</p>}
          {error && <p className="mt-3 text-bad">{error}</p>}
          {!ready && (
            <button onClick={onKeys} className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber hover:underline">
              <KeyRound className="size-3.5" />Add an API key so AgentShot can edit (Gemini, Anthropic or OpenAI)
            </button>
          )}

          {!example && !reference && (
            <div data-tour="ideas" className="mt-5 flex flex-wrap justify-center gap-2">
              {IDEAS.map(i => (
                <button key={i} onClick={() => { setPrompt(i); input.current?.focus() }} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] text-dim hover:border-line-strong hover:bg-surface hover:text-fg">{i}</button>
              ))}
            </div>
          )}
        </div>

        {!footage && (
          <div className="mx-auto w-full max-w-[1180px] px-8 pb-16 pt-14">
            <Gallery list={gallery} onUse={useExample} />
          </div>
        )}
      </div>
    </div>
  )
}
