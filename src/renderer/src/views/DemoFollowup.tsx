import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/** A post-output question in the conversation. Choosing Adjust opens live tools, never another modal. */
export function DemoFollowup({ editing, busy, proposal, onAdjust, onDone, onRender, children }: {
  editing: boolean; busy: boolean; proposal: boolean; onAdjust(): Promise<void>; onDone(): void; onRender(): Promise<void>; children: ReactNode
}) {
  const [dismissed, setDismissed] = useState(false), [error, setError] = useState('')
  if (dismissed && !editing) return <Button size="sm" variant="ghost" onClick={() => setDismissed(false)}>Adjust face layout</Button>
  return <section data-demo-followup className="space-y-3 rounded-xl border border-amber/30 bg-amber-soft p-4">
    <div className="font-medium">{editing ? 'Adjust your face layout' : 'Would you like to adjust your face placement, shape or size?'}</div>
    {editing ? <>
      <p className="text-xs text-dim">Changes preview instantly beside this chat. Move the shape or reframe your video inside it.</p>
      {children}
      <div className="flex gap-2"><Button size="sm" variant="primary" disabled={busy} onClick={async () => { try { await onRender(); onDone() } catch (e) { setError(String((e as Error).message || e)) } }}>Render adjusted video in chat</Button><Button size="sm" variant="ghost" onClick={onDone}>Done adjusting</Button></div>
    </> : <>
      {proposal && <p className="text-xs text-dim">Adjusting uses this proposed version as your editable starting point.</p>}
      <div className="flex gap-2"><Button size="sm" variant="primary" disabled={busy} onClick={async () => { try { await onAdjust(); setError('') } catch (e) { setError(String((e as Error).message || e)) } }}>Yes, adjust layout</Button><Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>Looks good</Button></div>
    </>}
    {error && <p role="alert" className="text-xs text-bad">{error}</p>}
  </section>
}
