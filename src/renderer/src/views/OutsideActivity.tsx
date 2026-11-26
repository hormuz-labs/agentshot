import { useEffect, useState } from 'react'
import { activityLine, QUIET_AFTER_MS } from '../../../shared/outside'

/** One line above the message box while an agent outside AgentShot (Claude Code, Codex…) is working on this film. */
export function OutsideActivity({ dir }: { dir: string }) {
  const [last, setLast] = useState<{ who: string; tool: string; at: number } | null>(null)
  useEffect(() => { setLast(null); return window.agentshot.outside.onActivity(a => { if (a.dir === dir) setLast(a) }) }, [dir])
  // it goes quiet a little after the agent's last step
  useEffect(() => {
    if (!last) return
    const t = setTimeout(() => setLast(null), Math.max(0, last.at + QUIET_AFTER_MS - Date.now()))
    return () => clearTimeout(t)
  }, [last])
  if (!last) return null
  return (
    <div role="status" className="mb-2 flex items-center gap-2 px-1 text-xs text-dim">
      <span className="size-1.5 animate-pulse rounded-full bg-amber" />
      <span className="truncate">{activityLine(last)}</span>
    </div>
  )
}
