// Everything the person brought into the project, as pictures: each video with a frame from it, each photo as it is,
// with how long it runs and what AgentShot found in it. From here a file goes to the agent (attached to the next
// message, so it knows to use it) or into the film (at the playhead, or dragged onto the timeline). Beside the film,
// opened from the top bar. A file's picture or name opens it large to look at (or play) before choosing.
import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Paperclip, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn, mediaUrl, timecode } from '@/lib/utils'
import { attachFiles, detachFiles, pickFiles, useAttached } from '@/lib/attach'
import { DRAG_FILE, FileIcon, kindOf } from './FilesPanel'
import type { FileKind, Project } from '../../../shared/types'

const FILTERS: { id: 'all' | FileKind; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'video', label: 'Videos' }, { id: 'image', label: 'Photos' }, { id: 'audio', label: 'Sound' }, { id: 'other', label: 'Other' },
]

/** One file's picture: a frame from a video (made on the computer, cached), a photo itself, else its kind's icon. */
function Thumb({ project, rel, kind }: { project: Project; rel: string; kind: FileKind }) {
  const [frame, setFrame] = useState<string | null>(null)
  const info = project.media[rel]
  useEffect(() => {
    if (kind !== 'video' || !info?.width) return
    let live = true
    window.agentshot.thumbnails(project.dir, rel, 1).then(f => { if (live) setFrame(f[0] ?? null) }).catch(() => {})
    return () => { live = false }
  }, [project.dir, rel, kind, info?.width])
  const src = kind === 'image' ? mediaUrl(`${project.dir}/${rel}`) : frame ? mediaUrl(frame) : null
  return (
    <div className="relative aspect-video overflow-hidden rounded-md bg-[#1d1a17]">
      {src
        ? <img src={src} alt="" draggable={false} className="size-full object-cover" />
        : <div className="grid size-full place-items-center text-faint"><FileIcon kind={kind} className="size-6" /></div>}
      {(kind === 'video' || kind === 'audio') && info?.duration > 0 && (
        <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 py-px text-[10.5px] tabular text-white">{timecode(info.duration, false)}</span>
      )}
    </div>
  )
}

/** A file opened large over the window: a photo as it is, a video or sound playing (its lighter preview copy when
 *  there is one), with Attach and Film beside it; arrows (or ← →) to the next, Esc or a click outside to close. */
function Lightbox({ project, rels, at, attached, onAt, onInsert, onClose }: {
  project: Project; rels: string[]; at: number; attached: string[]; onAt(i: number): void; onInsert(rel: string): void; onClose(): void
}) {
  const rel = rels[at], kind = kindOf(project, rel), on = attached.includes(rel)
  // what plays, its lighter preview copy when there is one; a photo as it is
  const src = mediaUrl(`${project.dir}/${kind === 'image' ? rel : project.proxies?.[rel] ?? rel}`)
  const footage = kind === 'video' && !!project.media[rel]?.width
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight' && at < rels.length - 1) onAt(at + 1)
      else if (e.key === 'ArrowLeft' && at > 0) onAt(at - 1)
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [at, rels.length, onAt, onClose])
  const arrow = 'no-drag absolute top-1/2 -translate-y-1/2 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-0'
  return (
    <div data-lightbox className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-8 backdrop-blur-sm" onClick={onClose}>
      <div className="flex w-full max-w-5xl items-center gap-3 text-white" onClick={e => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-medium" data-lightbox-name>{rel.split('/').pop()}</div>
          {project.files?.[rel]?.summary && <div className="truncate text-[12px] text-white/60">{project.files[rel].summary}</div>}
        </div>
        <span className="text-[12px] tabular text-white/50">{at + 1} / {rels.length}</span>
        <button className="no-drag grid size-8 place-items-center rounded-full text-white/80 hover:bg-white/10" aria-label="Close" onClick={onClose}><X className="size-4" /></button>
      </div>
      <div className="relative flex min-h-0 w-full max-w-5xl flex-1 items-center justify-center" onClick={e => e.stopPropagation()}>
        {kind === 'image' && <img key={rel} src={src} alt={rel.split('/').pop()} className="max-h-full max-w-full rounded-lg object-contain" />}
        {kind === 'video' && <video key={rel} src={src} controls autoPlay className="max-h-full max-w-full rounded-lg bg-black" data-lightbox-video />}
        {kind === 'audio' && <audio key={rel} src={src} controls autoPlay className="w-full max-w-md" />}
        {!['image', 'video', 'audio'].includes(kind) && <div className="grid place-items-center gap-2 text-white/70"><FileIcon kind={kind} className="size-10" /><span className="text-[13px]">No preview for this kind of file</span></div>}
        <button className={cn(arrow, 'left-0')} aria-label="Previous" disabled={at === 0} onClick={() => onAt(at - 1)}><ChevronLeft /></button>
        <button className={cn(arrow, 'right-0')} aria-label="Next" disabled={at === rels.length - 1} onClick={() => onAt(at + 1)}><ChevronRight /></button>
      </div>
      <div className="flex gap-2" onClick={e => e.stopPropagation()}>
        <Button size="sm" variant={on ? 'secondary' : 'primary'} aria-pressed={on} onClick={() => (on ? detachFiles : attachFiles)(project.dir, [rel])}>
          {on ? <Check /> : <Paperclip />}{on ? 'Attached' : 'Attach to message'}
        </Button>
        {footage && <Button size="sm" variant="secondary" onClick={() => { onClose(); onInsert(rel) }}><Plus />Put in the film</Button>}
      </div>
    </div>
  )
}

export function FootagePanel({ project, onInsert, onClose }: { project: Project; onInsert(rel: string): void; onClose(): void }) {
  const [filter, setFilter] = useState<'all' | FileKind>('all')
  const [viewing, setViewing] = useState<number | null>(null)
  const attached = useAttached(project.dir)
  const rels = useMemo(() => Object.keys(project.files || {})
    .filter(r => !r.startsWith('clips/'))
    .sort((a, b) => (project.files![b].addedAt ?? 0) - (project.files![a].addedAt ?? 0)), [project.files])
  const shown = rels.filter(r => {
    const k = kindOf(project, r)
    return filter === 'all' || k === filter || (filter === 'other' && !['video', 'image', 'audio'].includes(k))
  })
  return (
    <div data-footage-panel className="absolute inset-0 z-20 flex flex-col gap-3 bg-canvas p-3">
      <div className="flex items-center gap-2">
        <h2 className="font-medium">Footage</h2>
        <span className="text-[12px] text-faint">{rels.length} {rels.length === 1 ? 'file' : 'files'}</span>
        <span className="flex-1" />
        <Button size="sm" variant="secondary" onClick={() => pickFiles(project.dir)}><Plus />Add files</Button>
        <Button size="iconSm" variant="ghost" aria-label="Close footage" onClick={onClose}><X /></Button>
      </div>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Show">
        {FILTERS.map(f => (
          <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={cn('rounded-full border px-2.5 py-0.5 text-[12px]', filter === f.id ? 'border-amber/40 bg-amber-soft text-fg' : 'border-line text-dim hover:text-fg')}>{f.label}</button>
        ))}
      </div>
      {!shown.length
        ? <p className="px-1 text-[13px] text-faint">{rels.length ? 'Nothing of this kind yet.' : 'Drop footage, photos, music or logos anywhere in the window, or Add files.'}</p>
        : (
          <ul className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 overflow-y-auto pr-1">
            {shown.map(rel => {
              const f = project.files![rel], kind = kindOf(project, rel), on = attached.includes(rel)
              const footage = kind === 'video' && !!project.media[rel]?.width
              return (
                <li key={rel} data-footage={rel}
                  draggable={footage}
                  onDragStart={e => { e.dataTransfer.setData(DRAG_FILE, rel); e.dataTransfer.setData(`agentshot/kind-${kind}`, '1'); e.dataTransfer.effectAllowed = 'copy' }}
                  className={cn('group flex flex-col gap-1.5 rounded-lg border p-1.5', on ? 'border-amber/50 bg-amber-soft' : 'border-line bg-panel')}>
                  <button type="button" className="rounded-md text-left focus-visible:ring-2 focus-visible:ring-amber/50" aria-label={`Open ${rel.split('/').pop()}`} data-footage-open onClick={() => setViewing(shown.indexOf(rel))}>
                    <Thumb project={project} rel={rel} kind={kind} />
                  </button>
                  <div className="min-w-0 px-0.5">
                    <button type="button" className="block w-full truncate text-left text-[12.5px] hover:underline" title={rel} onClick={() => setViewing(shown.indexOf(rel))}>{rel.split('/').pop()}</button>
                    {f.summary && <p className="line-clamp-2 text-[11.5px] leading-snug text-faint" title={f.summary}>{f.summary}</p>}
                  </div>
                  <div className="mt-auto flex gap-1">
                    <Button size="sm" variant={on ? 'secondary' : 'ghost'} className="flex-1" aria-pressed={on}
                      title={on ? 'Attached to your next message: click to take it off' : 'Attach to your next message, so the agent uses it'}
                      onClick={() => (on ? detachFiles : attachFiles)(project.dir, [rel])}>
                      {on ? <Check /> : <Paperclip />}{on ? 'Attached' : 'Attach'}
                    </Button>
                    {footage && (
                      <Button size="sm" variant="ghost" title="Put it in the film at the playhead (or drag it onto the timeline)" onClick={() => onInsert(rel)}><Plus />Film</Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      {viewing != null && shown[viewing] && (
        <Lightbox project={project} rels={shown} at={viewing} attached={attached} onAt={setViewing} onInsert={onInsert} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}
