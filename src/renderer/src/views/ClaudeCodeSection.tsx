import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ClaudeCodeStatus } from '../../../shared/claude-code'

export function ClaudeCodeSection({ onConnected, compact = false }: { onConnected(connected: boolean): void; compact?: boolean }) {
  const [status, setStatus] = useState<ClaudeCodeStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const update = (s: ClaudeCodeStatus) => { setStatus(s); onConnected(s.enabled && s.connected) }
  const run = async (action: () => Promise<ClaudeCodeStatus>) => {
    setBusy(true); setError('')
    try { update(await action()) } catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { setBusy(false) }
  }
  useEffect(() => { void run(() => window.agentshot.claudeCode.status()) }, [])
  return <section className={compact ? '' : 'rounded-lg border border-line bg-raised/60 p-3'} aria-label="Claude Code connection">
    <div className="font-medium">Claude Code</div>
    <p className="mt-1 text-xs text-dim">Use your Claude subscription through Claude Code’s own sign-in.</p>
    <details className="mt-2 text-xs text-faint"><summary className="cursor-pointer hover:text-fg">Usage and privacy</summary><p className="mt-2">AgentShot runs Anthropic’s published Claude Code. AgentShot never receives your subscription tokens. Choose a Claude Code model for editing; usage shares your Claude limits. If Claude Code uses API or cloud credentials, that provider bills you instead. Image, voice and music generation are separate.</p></details>
    {status?.connected && <p className="mt-2 text-xs">{status.email || 'Claude Code account'} · {status.subscription ? 'Claude subscription' : `Own billing (${status.authMethod || 'Claude Code'})`}{status.enabled ? ' · connected' : ' · not connected to AgentShot'}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {busy ? <><Loader2 className="size-3.5 animate-spin" /><span className="text-xs text-dim">Checking or connecting… Finish sign-in in Claude Code’s browser.</span><Button size="sm" variant="ghost" onClick={() => window.agentshot.claudeCode.cancel()}>Cancel</Button></> : <>
        <Button size="sm" disabled={!status?.available} onClick={() => run(() => window.agentshot.claudeCode.signIn())}>Sign in through Claude Code</Button>
        {status?.connected && !status.enabled && <Button size="sm" onClick={() => run(() => window.agentshot.claudeCode.connect())}>Use existing sign-in</Button>}
        {status?.enabled && <Button size="sm" variant="ghost" onClick={() => run(() => window.agentshot.claudeCode.disconnect())}>Disconnect</Button>}
        <Button size="sm" variant="ghost" onClick={() => run(() => status?.enabled ? window.agentshot.claudeCode.connect() : window.agentshot.claudeCode.status())}>Refresh connection</Button>
      </>}
      <Button size="sm" variant="ghost" onClick={() => window.agentshot.claudeCode.usage()}>Manage usage</Button>
      <Button size="sm" variant="ghost" onClick={() => window.agentshot.claudeCode.help()}>Sign-in help</Button>
    </div>
    {status && !status.available && <p className="mt-2 text-xs text-faint">Claude Code is unavailable in this installation. Reinstall the desktop app with its optional dependencies.</p>}
    {status?.enabled && <p className="mt-2 text-xs text-faint">Disconnect affects only AgentShot, not your other Claude Code sessions.</p>}
    {status?.warning && <p role="status" className="mt-2 text-xs text-dim">{status.warning}</p>}
    {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
  </section>
}
