import { useRef, useState, type ReactNode } from 'react'
import { ArrowUp, Film, KeyRound, Loader2, Paperclip, X } from 'lucide-react'
import { extOf, kindByName } from '../../../shared/file-kinds'
import { FileIcon } from './FilesPanel'
import { JobsTray } from '@/components/JobsTray'
import { Button } from '@/components/ui/button'
import { ManulMascot } from '@/components/mascot/ManulMascot'
import { cn } from '@/lib/utils'
import type { Project } from '../../../shared/types'

const IDEAS = ['Cut the ums and long pauses', 'Make a 60-second vertical for Shorts', 'Add a fade in and fade out', 'Trim to the best 30 seconds']

/** The home screen, as in Claude's app: a greeting and one message box. The video comes with the first message. */
export function Start({ onOpen, onKeys, ready, lead }: { onOpen: (p: Project, prompt?: string, files?: string[]) => void; onKeys: () => void; onTools?: () => void; ready: boolean; lead?: ReactNode }) {
  const [file, setFile] = useState<string | null>(null)
  // other files dropped with the video (subtitles, music, logos…): added to the project, attached to the request
  const [extras, setExtras] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const choose = (path: string) => { setFile(path); setError(null); setTimeout(() => input.current?.focus(), 0) }
  /** Dropped files: the first video starts the project (unless one is chosen already); the rest come along. */
  const dropped = (paths: string[]) => {
    const video = file ? null : paths.find(f => kindByName(f) === 'video')
    if (!file && !video) { setError('Start with a video. Subtitles, music, logos and other files can come with it.'); return }
    if (video) choose(video)
    setExtras(x => [...new Set([...x, ...paths.filter(f => f !== video && f !== file)])])
  }
  const go = async () => {
    if (!file || busy) return
    setBusy(true)
    setError(null)
    try {
      const p = await window.manul.project.create(file)
      const files: string[] = []
      for (const f of extras) files.push(...(await window.manul.project.import(p.dir, f)))
      onOpen(p, prompt.trim() || undefined, files)
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  const pickVideo = async () => { const f = await window.manul.project.pick(); if (f) choose(f) }
  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); dropped(Array.from(e.dataTransfer.files).map(f => window.manul.pathForFile(f)).filter(Boolean)) }}
    >
      <div className={cn('drag flex h-[52px] shrink-0 items-center gap-1 pr-3', lead ? 'pl-[88px]' : 'pl-3')}>
        {lead}
        <span className="flex-1" />
        <JobsTray />
      </div>

      <div className="flex flex-1 flex-col items-center overflow-auto px-6 pb-16 pt-[7vh]">
        <ManulMascot state={busy ? 'working' : prompt ? 'thinking' : 'idle'} size={156} className="mb-1 shrink-0" />
        <div className="mb-8 flex items-center gap-3">
          <h1 className="font-serif text-[34px] font-normal tracking-[-0.01em] text-fg">What are we making?</h1>
        </div>

        <div className={cn('w-full max-w-[680px] rounded-2xl border bg-surface p-2.5 shadow-[0_1px_2px_var(--color-shade),0_6px_24px_-12px_var(--color-shade)] transition-colors',
          over ? 'border-amber bg-amber-soft' : 'border-line')}>
          {file ? (
            <div className="mb-1 flex items-center gap-2 rounded-xl bg-raised px-3 py-2">
              <Film className="size-4 text-amber" />
              <span className="flex-1 truncate" title={file}>{file.split('/').pop()}</span>
              <button className="rounded p-0.5 text-faint hover:text-fg" onClick={() => setFile(null)}><X className="size-3.5" /></button>
            </div>
          ) : (
            <button
              onClick={pickVideo}
              className="mb-1 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong py-7 text-dim transition-colors hover:border-amber/60 hover:bg-amber-soft hover:text-fg"
            >
              <Film className="mb-1 size-6" />
              <span className="font-medium text-fg">Drop a video here</span>
              <span className="text-xs">or click to choose · mp4, mov, webm, mkv</span>
              <span className="text-xs text-faint">subtitles, music or a logo can come with it</span>
            </button>
          )}
          {extras.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1 px-1">
              {extras.map(f => (
                <span key={f} className="inline-flex max-w-full items-center gap-1 rounded bg-hover px-1.5 py-0.5 text-[11px] text-dim" title={f}>
                  <FileIcon kind={extOf(f) ? kindByName(f) ?? 'other' : 'folder'} className="size-3" />
                  <span className="truncate">{f.split('/').pop()}</span>
                  <button className="text-faint hover:text-fg" onClick={() => setExtras(x => x.filter(y => y !== f))} aria-label={`Remove ${f.split('/').pop()}`}><X className="size-3" /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            rows={2}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
            placeholder="Tell Manul what to do with it…"
            className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-1">
            <button onClick={pickVideo} title="Choose a video" className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg"><Paperclip className="size-4" /></button>
            <span className="flex-1" />
            <Button size="icon" variant="primary" className="rounded-lg" disabled={!file || busy} onClick={go} aria-label="Start">
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-bad">{error}</p>}
        {!ready && (
          <button onClick={onKeys} className="mt-3 inline-flex items-center gap-1.5 text-xs text-amber hover:underline">
            <KeyRound className="size-3.5" />Add an API key so Manul can edit (Gemini, Anthropic or OpenAI)
          </button>
        )}

        <div className="mt-5 flex max-w-[680px] flex-wrap justify-center gap-2">
          {IDEAS.map(i => (
            <button key={i} onClick={() => { setPrompt(i); input.current?.focus() }} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] text-dim hover:border-line-strong hover:bg-surface hover:text-fg">{i}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
