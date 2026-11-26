import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { OutsideAgent, OutsideStatus } from '../../../shared/outside'

const AGENTS: { id: OutsideAgent; name: string; next: string }[] = [
  { id: 'claudeCode', name: 'Claude Code', next: 'Start a new Claude Code session, then ask it to edit your film. ' },
  { id: 'claudeApp', name: 'the Claude app', next: 'Quit and reopen the Claude app, then ask it to edit your film. ' },
  { id: 'codex', name: 'Codex', next: 'Start a new Codex session, then ask it to edit your film. ' },
]
const said = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Letting Claude Code, Codex or another agent on this computer edit the open project (src/main/mcp.ts). */
export function OutsideSection() {
  const [status, setStatus] = useState<OutsideStatus>()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<OutsideAgent | 'copy' | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { window.agentshot.outside.status().then(setStatus).catch(() => {}) }, [])
  const run = async (what: OutsideAgent | 'copy' | null, action: () => Promise<OutsideStatus | void>) => {
    setBusy(true); setError(''); setDone(null)
    try { const s = await action(); if (s) setStatus(s); setDone(what) } catch (e) { setError(said(e)) } finally { setBusy(false) }
  }
  if (!status) return null
  const on = status.enabled
  return <section className="mt-5 rounded-lg border border-line bg-raised/60 p-3" aria-label="Edit from another agent">
    <div className="flex items-start gap-3">
      <div className="flex-1">
        <div className="font-medium">Edit from Claude Code or Codex</div>
        <p className="mt-1 text-xs text-dim">Let an agent you already use on this computer edit the project you have open, with AgentShot’s own tools. Its cuts arrive here to keep or send back.</p>
      </div>
      <button role="switch" aria-checked={on} aria-label="Edit from Claude Code or Codex" title={on ? 'On' : 'Off'} disabled={busy} onClick={() => run(null, () => window.agentshot.outside.set(!on))}
        className={cn('mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors', on ? 'bg-amber' : 'bg-line-strong')}>
        <span className={cn('block size-3 rounded-full bg-bg transition-transform', on && 'translate-x-3')} />
      </button>
    </div>
    {on && status.running && <div className="mt-3 flex flex-wrap items-center gap-2">
      {AGENTS.filter(a => status.agents?.[a.id]).map(a => <Button key={a.id} size="sm" disabled={busy} onClick={() => run(a.id, () => window.agentshot.outside.add(a.id))}>{done === a.id && <Check className="size-3.5 text-ok" />}{done === a.id ? `Added to ${a.name}` : `Add to ${a.name}`}</Button>)}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => run('copy', () => window.agentshot.outside.copy())}>{done === 'copy' && <Check className="size-3.5 text-ok" />}{done === 'copy' ? 'Copied' : 'Copy setup for other agents'}</Button>
    </div>}
    {on && status.running && <p className="mt-2 text-xs text-faint">{AGENTS.find(a => a.id === done)?.next ?? ''}Only this computer can reach it. The setup holds a password: paste it only into an agent’s settings. Switching this off shuts every agent out.</p>}
    {status.problem && <p role="status" className="mt-2 text-xs text-dim">{status.problem}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
  </section>
}
