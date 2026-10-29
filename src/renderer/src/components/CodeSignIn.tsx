import { useEffect, useState } from 'react'
import { Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { AccountStatus } from '../../../shared/types'

const message = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** Signing in with a code from the person's phone, for when this computer's browser is signed in to someone else: a
 *  code to type on the phone (signed in there), and this computer has the same account. */
export function CodeSignIn({ onSignedIn }: { onSignedIn: (s: AccountStatus) => void }) {
  const [waiting, setWaiting] = useState(false)
  const [code, setCode] = useState<string | null>(null)
  const [error, setError] = useState('')
  useEffect(() => window.agentshot.account.onCode(c => setCode(c)), [])

  const start = async () => {
    setWaiting(true); setError(''); setCode(null)
    try { onSignedIn(await window.agentshot.account.signInWithCode()) } catch (e) {
      const m = message(e)
      if (!/cancelled/i.test(m)) setError(m)
    } finally { setWaiting(false); setCode(null) }
  }

  if (!waiting) {
    return (
      <div className="flex flex-col items-center gap-1">
        <button data-testid="code-sign-in" className="flex items-center gap-1 text-xs text-faint underline-offset-2 hover:text-fg hover:underline" onClick={start}>
          <Smartphone className="size-3" />Sign in with a code from your phone
        </button>
        {error && <p className="max-w-sm text-center text-xs text-bad">{error}</p>}
      </div>
    )
  }
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-1.5 rounded-lg border border-line bg-bg px-4 py-3 text-center">
      <div data-testid="sign-in-code" className="font-mono text-2xl font-semibold tracking-[0.2em]">{code ?? '····-····'}</div>
      <p className="text-xs text-dim">On your phone, in AgentShot: <b>Settings → Sign in a computer</b>, then type this code.</p>
      <Button size="sm" variant="ghost" onClick={() => window.agentshot.account.cancel()}>Cancel</Button>
    </div>
  )
}
