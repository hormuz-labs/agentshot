// Permission cards: something wants to download or spend; nothing happens until the user answers.
import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ConsentRequest } from '../../../shared/types'

export function useConsents() {
  const [list, setList] = useState<ConsentRequest[]>([])
  useEffect(() => { window.manul.consent.list().then(setList); return window.manul.consent.onChange(setList) }, [])
  return list
}

export function ConsentCard({ c }: { c: ConsentRequest }) {
  return (
    <div className="beam rounded-xl border border-amber/30 bg-panel p-3 shadow-xl shadow-shade">
      <div className="mb-1 flex items-center gap-2 font-medium"><Download className="size-4 text-amber" />{c.title}</div>
      <p className="mb-3 text-xs leading-relaxed text-dim">{c.body}</p>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => window.manul.consent.answer(c.id, false)}>Not now</Button>
        <Button size="sm" variant="primary" onClick={() => window.manul.consent.answer(c.id, true)}>{c.confirm}</Button>
      </div>
    </div>
  )
}

/** Cards that don't belong to the project on screen float bottom-right. */
export function ConsentStack({ except }: { except?: string }) {
  const list = useConsents().filter(c => !except || c.project !== except)
  if (!list.length) return null
  return <div className="fixed bottom-4 right-4 z-40 w-[340px] space-y-2">{list.map(c => <ConsentCard key={c.id} c={c} />)}</div>
}
