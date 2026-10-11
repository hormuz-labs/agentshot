import { useEffect, useRef, useState } from 'react'
import type { AgentState } from '@/lib/agui'
import { mascotActivity, type MascotState } from '@/lib/mascot'
import { ManulMascot } from './ManulMascot'

/** One companion per conversation, not one WebGL context per message. */
export function ManulCompanion({ agent, needsConsent, active = true, hero = false }: {
  agent: AgentState; needsConsent: boolean; active?: boolean; hero?: boolean
}) {
  const activity = mascotActivity(agent, needsConsent)
  const previousBusy = useRef(agent.busy)
  const [celebrating, setCelebrating] = useState(false), [sleeping, setSleeping] = useState(false)
  useEffect(() => {
    const finished = previousBusy.current && !agent.busy && !agent.error
    previousBusy.current = agent.busy
    if (agent.busy || agent.error) { setCelebrating(false); return }
    // Only celebrate a reply from this run, not an empty stop or a restored conversation.
    const lastUser = agent.messages.findLastIndex(m => m.role === 'user')
    if (!finished || !agent.messages.slice(lastUser + 1).some(m => m.role === 'assistant' && m.content)) return
    setCelebrating(true)
    const timer = window.setTimeout(() => setCelebrating(false), 2600)
    return () => window.clearTimeout(timer)
  }, [agent.busy, agent.error])
  useEffect(() => {
    setSleeping(false)
    if (activity.state !== 'idle' || !active || celebrating) return
    let timer: number
    const wake = () => { setSleeping(false); window.clearTimeout(timer); timer = window.setTimeout(() => setSleeping(true), 30_000) }
    wake()
    window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake)
    return () => { window.clearTimeout(timer); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake) }
  }, [activity.state, active, celebrating])
  const state: MascotState = activity.state === 'idle' ? celebrating ? 'success' : sleeping ? 'sleeping' : 'idle' : activity.state
  return <div className={hero ? 'manul-companion-hero' : 'manul-companion'} data-companion-state={state}>
    <ManulMascot state={state} size={hero ? 156 : 76} active={active} />
    {!hero && <div className="min-w-0">
      <div className="flex items-center gap-1.5"><span className="font-medium text-fg">Manul</span><span className="manul-companion-tag">your editing companion</span></div>
      <p className="mt-0.5 truncate text-xs text-dim" role="status" aria-live="polite">{celebrating ? 'All done. Your turn to take a look.' : sleeping ? 'A little catnap. Still here for you.' : activity.label}</p>
    </div>}
    {!hero && agent.busy && <span className="manul-companion-pulse" aria-hidden="true" />}
  </div>
}
