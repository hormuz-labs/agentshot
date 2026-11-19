import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatGPTStatus } from '../../../shared/chatgpt'

/** Same settings typography and spacing as BYOK; a distinct subscription/billing path. */
export function ChatGPTSection({ onConnected, compact = false }: { onConnected(connected: boolean): void; compact?: boolean }) {
  const [status, setStatus] = useState<ChatGPTStatus>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [welcome, setWelcome] = useState(false)
  const update = (s: ChatGPTStatus) => { setStatus(s); onConnected(!!s.active && s.accounts.some(a => a.id === s.active && a.connected)) }
  useEffect(() => { window.agentshot.chatgpt.status().then(update).catch(() => setError('Could not read your ChatGPT connection. Check that your system keychain is unlocked.')) }, [])
  const run = async (action: () => Promise<ChatGPTStatus & { firstSignIn?: boolean }>) => {
    setBusy(true); setError('')
    try { const s = await action(); update(s); if (s.firstSignIn) setWelcome(true) }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { setBusy(false) }
  }
  const dismissWelcome = async () => {
    try { await window.agentshot.chatgpt.welcome(); setWelcome(false) }
    catch { setError('Could not save the confirmation. Please try again.') }
  }
  return (
    <section className={compact ? '' : 'rounded-lg border border-line bg-raised/60 p-3'} aria-label="ChatGPT subscription">
      <div className="font-medium">ChatGPT subscription</div>
      <p className="mt-1 text-xs text-dim">Sign in in your browser. Editing uses your ChatGPT plan and its shared limits.</p>
      <details className="mt-2 text-xs text-faint"><summary className="cursor-pointer hover:text-fg">Usage and privacy</summary><p className="mt-2">Choose a ChatGPT plan model in the model picker. Requests go directly to OpenAI. Image, voice and music generation still need API keys or AgentShot credits. Subscription tokens stay encrypted on this desktop.</p></details>
      {status?.accounts.map(a => (
        <div key={a.id} className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
          <span className="min-w-0 flex-1 truncate text-xs">{a.label}{status.active === a.id ? ' (active)' : ''}</span>
          {a.connected ? <>
            {status.active !== a.id && <Button size="sm" disabled={busy} onClick={() => run(() => window.agentshot.chatgpt.select(a.id))}>Use account</Button>}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => window.agentshot.chatgpt.signOut(a.id))}>Sign out</Button>
          </> : <Button size="sm" disabled={busy} onClick={() => run(() => window.agentshot.chatgpt.signIn(a.id))}>Continue with ChatGPT</Button>}
        </div>
      ))}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {busy ? <><Loader2 className="size-3.5 animate-spin" /><span className="text-xs text-dim">Connecting… Finish sign-in in your browser if prompted.</span><Button size="sm" variant="ghost" onClick={() => window.agentshot.chatgpt.cancel()}>Cancel sign-in</Button></> :
          <Button size="sm" disabled={!status?.available} onClick={() => run(() => window.agentshot.chatgpt.signIn())}>Continue with ChatGPT</Button>}
        <Button size="sm" variant="ghost" disabled={!status?.available} onClick={() => window.agentshot.chatgpt.usage().catch(() => setError('Could not open ChatGPT usage settings.'))}>Manage usage</Button>
      </div>
      {status && !status.available && <p className="mt-2 text-xs text-faint">Available only on the local desktop with secure keychain storage.</p>}
      {status?.warning && <p role="status" className="mt-2 text-xs text-dim">{status.warning}</p>}
      {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
      <Dialog.Root open={welcome} onOpenChange={v => { if (!v) void dismissWelcome() }}>
        <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[80] bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[81] w-[min(400px,90vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-5 shadow-2xl">
            <Dialog.Title className="text-base font-semibold">You’re using your ChatGPT plan</Dialog.Title>
            <Dialog.Description className="mt-2 text-sm text-dim">Eligible requests with ChatGPT plan models use your ChatGPT subscription and its shared limits. Manage app access and usage in ChatGPT settings. AgentShot credits and API keys are separate.</Dialog.Description>
            <Button className="mt-4" variant="primary" onClick={dismissWelcome}>Got it</Button>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  )
}
