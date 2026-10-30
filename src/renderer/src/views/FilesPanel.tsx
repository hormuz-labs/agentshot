// The files the user added to the project (footage, music, subtitles, fonts, LUTs…), what AgentShot made of each, and
// deleting them: the Files in the sidebar's project tree. Clicking one attaches it to the next message, so the agent
// knows to use it. Also the icons and chips for files the message box and the start screen use.
import { Captions, ChevronRight, Download, File, Film, Folder, FolderOpen, Image as ImageIcon, Music, Palette, Paperclip, ScrollText, Sparkles, Trash2, Type } from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn, timecode } from '@/lib/utils'
import { attachFiles, detachFiles, useAttached } from '@/lib/attach'
import { kindByName } from '../../../shared/file-kinds'
import type { FileKind, Project } from '../../../shared/types'
import { ConversationVoiceovers } from './VoiceoverPanel'

const ICON: Record<FileKind | 'folder' | 'clip', typeof File> = {
  folder: Folder, clip: Sparkles, video: Film, audio: Music, image: ImageIcon, subtitles: Captions, text: ScrollText, font: Type, lut: Palette, other: File,
}

export function FileIcon({ kind, className }: { kind: FileKind | 'folder' | 'clip'; className?: string }) {
  const I = ICON[kind]
  return <I className={cn('size-3.5 shrink-0', className)} />
}

/** A file's kind: what AgentShot found, else what its name says. */
export const kindOf = (p: Project, rel: string) => p.files?.[rel]?.kind ?? kindByName(rel) ?? 'other'

/** Chips for attached files: a folder's files (media/<folder>/…) collapse into one chip when there are several. */
export function chipGroups(rels: string[]): { label: string; rels: string[] }[] {
  const out: { label: string; rels: string[] }[] = []
  const folders = new Map<string, string[]>()
  for (const r of rels) {
    const parts = r.split('/')
    if (parts.length > 2) folders.set(parts[1], [...(folders.get(parts[1]) || []), r])
    else out.push({ label: parts.at(-1)!, rels: [r] })
  }
  for (const [name, list] of folders) {
    if (list.length > 3) out.push({ label: `${name}/ · ${list.length} files`, rels: list })
    else out.push(...list.map(r => ({ label: r.split('/').slice(1).join('/'), rels: [r] })))
  }
  return out
}

type Row = { kind: 'file'; rel: string; depth: number } | { kind: 'folder'; name: string; rels: string[]; depth: number }

/** Explorer order: folders first, then files, with every directory level independently collapsible. */
export function fileRows(rels: string[], collapsed: ReadonlySet<string> = new Set()): Row[] {
  const rows: Row[] = []
  const visit = (paths: string[], prefix: string, depth: number) => {
    const folders = new Map<string, string[]>()
    const files: string[] = []
    for (const rel of paths) {
      const rest = rel.slice(prefix.length)
      if (!rest.includes('/')) files.push(rel)
      else {
        const name = `${prefix}${rest.split('/')[0]}`
        folders.set(name, [...(folders.get(name) || []), rel])
      }
    }
    for (const [name, inside] of [...folders].sort(([a], [b]) => a.localeCompare(b))) {
      rows.push({ kind: 'folder', name, rels: inside, depth })
      if (!collapsed.has(name)) visit(inside, `${name}/`, depth + 1)
    }
    rows.push(...files.map(rel => ({ kind: 'file' as const, rel, depth })))
  }
  visit([...new Set(rels)].sort((a, b) => a.localeCompare(b)), '', 0)
  return rows
}

/** A trash button that asks once ("Delete") before acting. */
function Remove({ label, onConfirm }: { label: string; onConfirm(): void }) {
  const [sure, setSure] = useState(false)
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t) }, [sure])
  return sure ? (
    <button onClick={() => { setSure(false); onConfirm() }} className="shrink-0 self-center rounded bg-bad/15 px-1.5 py-0.5 text-[11px] font-medium text-bad hover:bg-bad/25" title="Moves to the Trash">Delete</button>
  ) : (
    <button onClick={() => setSure(true)} aria-label={`Delete ${label}`} title="Delete (moves to the Trash)"
      className="shrink-0 self-center rounded p-1 text-faint opacity-0 hover:bg-bad/15 hover:text-bad focus:opacity-100 group-hover:opacity-100"><Trash2 className="size-3" /></button>
  )
}

/** What a drag from the Files carries: the file, and its kind (readable while dragging, when the data isn't). */
export const DRAG_FILE = 'agentshot/file'
export const dragKind = (types: readonly string[]) => (types.find(t => t.startsWith('agentshot/kind-'))?.slice('agentshot/kind-'.length) as FileKind | undefined)

/** Fold folders to navigate; their paperclip attaches all descendants. File clicks still attach to the next message. */
export function FilesTree({ project }: { project: Project }) {
  const files = project.files || {}
  const storageKey = `manul.tree.folders.${project.dir}`
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
      return new Set(Array.isArray(stored) ? stored.filter((p): p is string => typeof p === 'string') : [])
    } catch { return new Set() }
  })
  const toggleFolder = (name: string, expanded?: boolean) => setCollapsed(old => {
    const next = new Set(old)
    if (expanded ?? old.has(name)) next.delete(name)
    else next.add(name)
    try { localStorage.setItem(storageKey, JSON.stringify([...next])) } catch { /* private mode */ }
    return next
  })
  const rows = fileRows(Object.keys(files), collapsed)
  const attached = useAttached(project.dir)
  const [kept, setKept] = useState<Record<string, string>>({})
  const remove = async (rels: string[]) => {
    try {
      const r = await window.agentshot.project.removeFiles(project.dir, rels)
      detachFiles(project.dir, r.removed)
      setKept(Object.fromEntries(r.blocked.map(b => [b.file, b.why])))
    } catch (e) { alert((e as Error).message) }
  }
  if (!rows.length) return <p className="px-2 py-1 text-[11.5px] leading-snug text-faint">Drop footage, music, logos or subtitles anywhere in the window.</p>
  return (
    <>
    <ConversationVoiceovers project={project} onAttach={src => attachFiles(project.dir, [src])} />
    <ul data-files-tree>
      {rows.map(row => {
        if (row.kind === 'folder') {
          const expanded = !collapsed.has(row.name)
          return (
            <li key={`dir:${row.name}`} data-file-folder={row.name} className="group flex items-center" style={{ paddingLeft: row.depth * 12 }}>
              <button type="button" onClick={() => toggleFolder(row.name)} aria-expanded={expanded} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.name}`} title={row.name}
                onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); toggleFolder(row.name, e.key === 'ArrowRight') } }}
                className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left text-[12.5px] text-dim hover:bg-hover/60 hover:text-fg">
                <ChevronRight className={cn('size-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
                {expanded ? <FolderOpen className="size-3.5 shrink-0" /> : <FileIcon kind="folder" />}
                <span className="truncate">{row.name.split('/').pop()}</span><span className="ml-auto shrink-0 text-[11px] text-faint">{row.rels.length}</span>
              </button>
              <button type="button" onClick={() => attachFiles(project.dir, row.rels)} aria-label={`Attach all files in ${row.name}`} title={`Attach all ${row.rels.length} files`} className="shrink-0 rounded p-1 text-faint opacity-0 hover:bg-hover hover:text-fg focus:opacity-100 group-hover:opacity-100"><Paperclip className="size-3" /></button>
              {row.name.startsWith('media/') && <Remove label={`the folder ${row.name.split('/').pop()}`} onConfirm={() => remove(row.rels)} />}
            </li>
          )
        }
        const f = files[row.rel]
        const on = attached.includes(row.rel)
        const m = project.media[row.rel]
        const long = (f.kind === 'video' || f.kind === 'audio') && m?.duration ? timecode(m.duration, false) : ''
        return (
          <li key={row.rel} data-project-file={row.rel} className="group flex items-center" style={{ paddingLeft: row.depth * 12 + 18 }}>
            <button
              draggable={f.kind === 'video'}
              onDragStart={e => { e.dataTransfer.setData(DRAG_FILE, row.rel); e.dataTransfer.setData(`agentshot/kind-${f.kind}`, '1'); e.dataTransfer.effectAllowed = 'copy' }}
              onClick={() => (on ? detachFiles : attachFiles)(project.dir, [row.rel])}
              aria-pressed={on}
              title={`${row.rel}\n${f.summary}${kept[row.rel] ? `\nCan't delete: ${kept[row.rel]}.` : ''}\n${on ? 'Attached to your next message (click to take it off)' : 'Click to attach to your next message'}${f.kind === 'video' ? ', or drag onto the timeline' : ''}`}
              className={cn('flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-[12.5px] hover:bg-hover/60', on ? 'bg-amber-soft text-fg' : 'text-dim hover:text-fg')}
            >
              <FileIcon kind={f.kind} className={on ? 'text-amber' : undefined} />
              <span className="truncate">{row.rel.split('/').pop()}</span>
              {long && <span className="ml-auto shrink-0 text-[10.5px] tabular text-faint">{long}</span>}
            </button>
            <button type="button" aria-label={`Download ${row.rel.split('/').pop()}`} title="Download file" className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={() => window.agentshot.project.downloadFile(project.dir, row.rel).catch(e => alert((e as Error).message))}><Download className="size-3" /></button>
            <button type="button" aria-label={`Show ${row.rel.split('/').pop()} in folder`} title="Show in folder" className="shrink-0 rounded p-1 text-faint hover:bg-hover hover:text-fg" onClick={() => window.agentshot.project.revealFile(project.dir, row.rel).catch(e => alert((e as Error).message))}><FolderOpen className="size-3" /></button>
            {row.rel.startsWith('media/') && <Remove label={row.rel.split('/').pop()!} onConfirm={() => remove([row.rel])} />}
          </li>
        )
      })}
    </ul>
    </>
  )
}
