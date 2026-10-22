// The sidebar, as in Claude's app: search, a new project, every project, the one on screen opened up as a tree of its
// chats and its files, and settings at the foot. Open projects keep working in the background.
import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, CircleHelp, Loader2, PanelLeft, Plus, Search, Settings, Sparkles, Brain, Trash2, X } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { useAgent } from '@/lib/agui'
import { cn } from '@/lib/utils'
import { runCommand } from '@/lib/commands'
import type { Section } from '@/views/SettingsDialog'
import { FilesTree } from '@/views/FilesPanel'
import { pickFiles } from '@/lib/attach'
import type { Project, RecentProject } from '../../../shared/types'
import { newestProjects } from '../../../shared/project-order'

export function SidebarToggle({ onClick, side = 'bottom' }: { onClick(): void; side?: 'bottom' | 'right' }) {
  return (
    <Tip label="Show or hide the sidebar" side={side}>
      <button onClick={onClick} className="no-drag flex size-7 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg" aria-label="Toggle sidebar">
        <PanelLeft className="size-4" strokeWidth={1.75} />
      </button>
    </Tip>
  )
}

const Nav = ({ icon: Icon, label, onClick, active }: { icon: typeof Plus; label: string; onClick(): void; active?: boolean }) => (
  <button onClick={onClick} className={cn('flex h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[13px]', active ? 'bg-hover text-fg' : 'text-fg/85 hover:bg-hover')}>
    <Icon className="size-4 text-dim" />{label}
  </button>
)

/** A heading in the project tree (Chats, Files), with its count, a + and a fold. */
function Branch({ label, count, add, addLabel, children }: { label: string; count?: number; add(): void; addLabel: string; children: React.ReactNode }) {
  const key = `manul.tree.${label}`
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0' } catch { return true } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* private mode */ } return !o })
  return (
    <div>
      <div className="group flex h-7 items-center gap-1 rounded-md pl-1 pr-1 text-[11.5px] font-medium text-faint hover:text-dim">
        <button onClick={toggle} aria-expanded={open} className="flex flex-1 items-center gap-1 text-left">
          <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />{label}
          {count ? <span className="tabular font-normal">{count}</span> : null}
        </button>
        <Tip label={addLabel} side="right">
          <button onClick={add} aria-label={addLabel} className="rounded p-0.5 opacity-0 hover:bg-hover hover:text-fg focus:opacity-100 group-hover:opacity-100"><Plus className="size-3.5" /></button>
        </Tip>
      </div>
      {open && <div className="pl-2">{children}</div>}
    </div>
  )
}

function ProjectRow({ dir, title, active, open, project, onSelect, onClose, onDelete }: { dir: string; title: string; active: boolean; open: boolean; project?: Project; onSelect(): void; onClose(): void; onDelete(): Promise<void> }) {
  const busy = useAgent(dir).busy
  const [sure, setSure] = useState(false)
  const [deleting, setDeleting] = useState(false)
  useEffect(() => { if (!sure) return; const t = setTimeout(() => setSure(false), 4000); return () => clearTimeout(t) }, [sure])
  const remove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleting(true)
    try { await onDelete() } catch { /* the parent shows the error */ } finally { setDeleting(false); setSure(false) }
  }
  const convs = [...(project?.conversations || [])].reverse()
  return (
    <div>
      <div onClick={onSelect} title={dir} data-project-row={dir} aria-current={active || undefined}
        className={cn('group flex h-8 cursor-default items-center gap-2 rounded-lg px-2.5 text-[13px]', active ? 'bg-hover text-fg' : 'text-fg/85 hover:bg-hover/70')}>
        {busy ? <Loader2 className="size-3 shrink-0 animate-spin text-amber" /> : <span className={cn('size-1.5 shrink-0 rounded-full', open ? 'bg-amber' : 'bg-transparent')} />}
        <span className="flex-1 truncate">{title}</span>
        {open && (
          <button onClick={e => { e.stopPropagation(); onClose() }} title="Close project"
            className="rounded p-0.5 text-faint opacity-0 hover:text-fg group-hover:opacity-100"><X className="size-3.5" /></button>
        )}
        {sure ? (
          <button disabled={deleting} onClick={remove} title="Moves the project to the Trash"
            className="rounded bg-bad/15 px-1.5 py-0.5 text-[11px] font-medium text-bad hover:bg-bad/25 disabled:opacity-60">{deleting ? <Loader2 className="size-3 animate-spin" /> : 'Delete'}</button>
        ) : (
          <button onClick={e => { e.stopPropagation(); setSure(true) }} aria-label={`Delete ${title}`} title="Delete project (moves to the Trash)"
            className="rounded p-0.5 text-faint opacity-0 hover:bg-bad/15 hover:text-bad focus:opacity-100 group-hover:opacity-100"><Trash2 className="size-3.5" /></button>
        )}
      </div>
      {/* the project on screen, opened up: its chats and its files */}
      {active && project && (
        <div className="mb-1 ml-[15px] mt-0.5 space-y-0.5 border-l border-line pl-1.5" data-project-tree>
          <Branch label="Chats" add={() => window.manul.agent.newConversation(dir)} addLabel="New chat">
            {convs.map(c => (
              <button key={c.id} onClick={() => window.manul.agent.switchConversation(dir, c.id)} title={c.title} aria-current={c.id === project.conversation || undefined}
                className={cn('block h-7 w-full truncate rounded-md px-2 text-left text-[12.5px]', c.id === project.conversation ? 'bg-hover/80 text-fg' : 'text-dim hover:bg-hover/60 hover:text-fg')}>
                {c.title}
              </button>
            ))}
          </Branch>
          <Branch label="Files" count={Object.keys(project.files || {}).length} add={() => pickFiles(dir)} addLabel="Add files">
            <FilesTree key={dir} project={project} />
          </Branch>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ open, active, loaded, onNew, onSelect, onClose, onDelete, onSettings, onCollapse }: {
  open: string[]; active: string | null; loaded: Record<string, Project>
  onNew(): void; onSelect(dir: string): void; onClose(dir: string): void; onDelete(dir: string): Promise<void>; onSettings(s: Section): void; onCollapse(): void
}) {
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [q, setQ] = useState('')
  // the projects as they change (titles, conversations): the ones open, kept fresh
  const [live, setLive] = useState<Record<string, Project>>({})
  useEffect(() => window.manul.project.onChange(np => setLive(x => ({ ...x, [np.dir]: np }))), [])
  useEffect(() => { window.manul.project.recent().then(setRecent).catch(() => {}) }, [open.join('\n'), active])
  const info = (d: string) => live[d] ?? loaded[d]

  // Open and recent projects share one stable creation order; switching the active project never promotes it.
  const rows = useMemo(() => {
    const seen = new Set(recent.map(r => r.dir))
    const all = newestProjects([
      ...open.filter(d => !seen.has(d)).map(d => ({ dir: d, title: info(d)?.title || d.split('/').pop()!, createdAt: info(d)?.createdAt })),
      ...recent.map(r => ({ ...r, createdAt: info(r.dir)?.createdAt ?? r.createdAt })),
    ])
    const needle = q.trim().toLowerCase()
    return needle ? all.filter(r => r.title.toLowerCase().includes(needle)) : all
  }, [recent, open, q, live, loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <aside className="flex h-full w-full flex-col border-r border-line bg-bg" aria-label="Sidebar">
      <div className="drag flex h-[52px] shrink-0 items-center gap-1 pl-[82px] pr-2.5">
        <SidebarToggle onClick={onCollapse} />
      </div>

      <div className="space-y-0.5 px-2.5 pb-3">
        <div className="mb-2 flex h-8 items-center gap-2 rounded-lg border border-line bg-panel px-2.5">
          <Search className="size-3.5 text-faint" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search projects" aria-label="Search projects"
            className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
        </div>
        <Nav icon={Plus} label="New project" onClick={onNew} active={active === null} />
        <Nav icon={Sparkles} label="Skills" onClick={() => onSettings('skills')} />
        <Nav icon={Brain} label="Memory" onClick={() => onSettings('memory')} />
      </div>

      <div data-tour="projects" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        <div className="px-2.5 pb-1 pt-1 text-xs font-medium text-faint">Projects</div>
        {rows.length === 0 && <p className="px-2.5 py-1 text-xs text-faint">{q ? 'No project matches.' : 'Your projects will show here.'}</p>}
        <div className="space-y-px">
          {rows.map(r => (
            <ProjectRow key={r.dir} dir={r.dir} title={info(r.dir)?.title || r.title} active={r.dir === active} open={open.includes(r.dir)}
              project={info(r.dir)} onSelect={() => onSelect(r.dir)} onClose={() => onClose(r.dir)} onDelete={async () => { await onDelete(r.dir); setRecent(x => x.filter(p => p.dir !== r.dir)) }} />
          ))}
        </div>
      </div>

      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-3">
        <img src="./manul.png" alt="" className="size-7 object-contain" draggable={false} />
        <span className="flex-1 text-[13px] font-medium">Manul</span>
        <Tip label="Product tour" side="top">
          <button onClick={() => runCommand('tour')} className="flex size-7 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg" aria-label="Product tour">
            <CircleHelp className="size-4" />
          </button>
        </Tip>
        <Tip label="Settings" side="top">
          <button data-tour="settings" onClick={() => onSettings('appearance')} className="flex size-7 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg" aria-label="Settings">
            <Settings className="size-4" />
          </button>
        </Tip>
      </div>
    </aside>
  )
}
