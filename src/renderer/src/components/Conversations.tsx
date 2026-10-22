// The conversation switcher in the title bar, as in Claude's app: this conversation's title with a menu of every
// thread in the project, a new one, rename.
import { useState } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, MessageSquarePlus, Pencil } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Project } from '../../../shared/types'

export function Conversations({ project }: { project: Project }) {
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const list = [...(project.conversations || [])].reverse()
  const cur = list.find(c => c.id === project.conversation)
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="no-drag inline-flex h-7 min-w-0 max-w-[360px] items-center gap-1 rounded-md px-1.5 text-[14px] font-medium hover:bg-hover" title="Conversations">
        <span className="truncate">{cur?.title || 'New conversation'}</span>
        <ChevronDown className="size-3.5 shrink-0 text-faint" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-50 w-72 rounded-card border border-line bg-panel p-1 shadow-2xl shadow-shade">
          <button onClick={async () => { await window.manul.agent.newConversation(project.dir); setOpen(false) }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-amber hover:bg-hover">
            <MessageSquarePlus className="size-3.5" />New conversation
          </button>
          <div className="my-1 h-px bg-line" />
          <div className="max-h-72 overflow-y-auto">
            {list.map(c => (
              <div key={c.id} className={cn('group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-hover', c.id === project.conversation && 'bg-raised')}>
                {renaming?.id === c.id ? (
                  <form className="flex-1" onSubmit={async e => { e.preventDefault(); await window.manul.agent.renameConversation(project.dir, c.id, renaming.title); setRenaming(null) }}>
                    <input autoFocus value={renaming.title} onChange={e => setRenaming({ ...renaming, title: e.target.value })} onBlur={() => setRenaming(null)}
                      className="h-6 w-full rounded border border-line bg-bg px-1.5 text-xs outline-none" />
                  </form>
                ) : (
                  <button className="min-w-0 flex-1 text-left" onClick={async () => { await window.manul.agent.switchConversation(project.dir, c.id); setOpen(false) }}>
                    <div className="truncate text-xs text-fg">{c.title}</div>
                    <div className="text-[10.5px] text-faint">{new Date(c.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                  </button>
                )}
                {c.id === project.conversation && !renaming && <Check className="size-3.5 text-amber" />}
                {!renaming && <button onClick={() => setRenaming({ id: c.id, title: c.title })} className="text-faint opacity-0 hover:text-fg group-hover:opacity-100" title="Rename"><Pencil className="size-3" /></button>}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
