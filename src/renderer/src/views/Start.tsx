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

/** The home screen: a greeting and one message box. All selected files come with the first message. */
export function Start({ onOpen, onKeys, ready, lead }: { onOpen: (p: Project, prompt?: string, files?: string[]) => void; onKeys: () => void; onTools?: () => void; ready: boolean; lead?: ReactNode }) {
  const [files, setFiles] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)

  const choose = (paths: string[]) => {
    if (busy || !paths.length) return
    setFiles(x => [...new Set([...x, ...paths.filter(Boolean)])])
    setError(null)
    setTimeout(() => input.current?.focus(), 0)
  }
  const go = async () => {
    if (!files.length || busy) return
    setBusy(true)
    setError(null)
    try {
      const p = await window.manul.project.create(files)
      onOpen(p, prompt.trim() || undefined, Object.keys(p.files || {}))
    } catch (e) {
      setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
      setBusy(false)
    }
  }

  const pickFiles = async () => {
    if (busy) return
    try { choose(await window.manul.project.pick()) } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  return (
    <div
      className="flex h-full flex-col"
      onDragOver={e => { e.preventDefault(); if (!busy) setOver(true) }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); choose(Array.from(e.dataTransfer.files).map(f => window.manul.pathForFile(f)).filter(Boolean)) }}
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
          ) : (
            <button
              data-tour="import"
              onClick={pickFiles}
              className="mb-1 flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-line-strong py-7 text-dim transition-colors hover:border-amber/60 hover:bg-amber-soft hover:text-fg"
            >
              <Film className="mb-1 size-6" />
              <span className="font-medium text-fg">Drop files here</span>
              <span className="text-xs">or click to choose multiple files</span>
              <span className="text-xs text-faint">include a video · photos, audio, folders and other files can come with it</span>
            </button>
          )}
          <textarea
            data-tour="start-prompt"
            ref={input}
            rows={2}
            value={prompt}
            disabled={busy}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go() } }}
            placeholder="Tell Manul what to do with it…"
            className="block max-h-40 min-h-[56px] w-full resize-none bg-transparent px-2 py-2 text-[15px] outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-1">
            <button disabled={busy} onClick={pickFiles} title="Choose files" aria-label="Choose files" className="flex size-8 items-center justify-center rounded-lg text-dim hover:bg-hover hover:text-fg disabled:opacity-50"><Paperclip className="size-4" /></button>
            {busy && <span role="status" className="text-xs text-dim">Importing {files.length} {files.length === 1 ? 'item' : 'items'}…</span>}
            <span className="flex-1" />
            <Button data-tour="start" size="icon" variant="primary" className="rounded-lg" disabled={!files.length || busy} onClick={go} aria-label="Start">
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

        <div data-tour="ideas" className="mt-5 flex max-w-[680px] flex-wrap justify-center gap-2">
          {IDEAS.map(i => (
            <button key={i} onClick={() => { setPrompt(i); input.current?.focus() }} className="rounded-lg border border-line bg-panel px-3 py-1.5 text-[12.5px] text-dim hover:border-line-strong hover:bg-surface hover:text-fg">{i}</button>
          ))}
        </div>
      </div>
    </div>
  )
}
