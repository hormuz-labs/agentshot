import * as D from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function Dialog({ open, onOpenChange, title, description, children, className }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description?: string; children: ReactNode; className?: string
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[560px] max-w-[calc(100vw-32px)] max-h-[85vh] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-card border border-line bg-panel p-5 shadow-2xl shadow-shade focus:outline-none', className)}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <D.Title className="text-[15px] font-semibold">{title}</D.Title>
              {description && <D.Description className="mt-1 text-dim">{description}</D.Description>}
            </div>
            <D.Close className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></D.Close>
          </div>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}
