import { useEffect, useRef, useState } from 'react'
import type { AccountStatus } from '../../../shared/types'

export function useVoiceoverAccess() {
  const [state, setState] = useState<'checking' | 'locked' | 'ready' | 'unavailable' | 'error'>('checking')
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [busy, setBusy] = useState<'signin' | 'checkout' | null>(null)
  const [error, setError] = useState('')
  const [awaitingCheckout, setAwaitingCheckout] = useState(false)
  const mounted = useRef(false), checking = useRef(false), action = useRef(false)
  const check = async () => {
    if (checking.current) return
    if (!window.agentshot?.voiceover?.access) {
      setState('unavailable')
      return
    }
    checking.current = true
    try {
      const [who, allowed] = await Promise.all([window.agentshot.account.status(), window.agentshot.voiceover.access()])
      if (!mounted.current) return
      setAccount(who); setError(''); setState(allowed ? 'ready' : 'locked')
      if (allowed) setAwaitingCheckout(false)
    } catch {
      if (mounted.current) { setError('We couldn’t connect to your account. Please try again.'); setState('error') }
    } finally { checking.current = false }
  }
  useEffect(() => {
    mounted.current = true
    void check()
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    if (state !== 'locked' && state !== 'error') return
    const refresh = () => { if (!action.current && document.visibilityState !== 'hidden') void check() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    // Checkout activation may arrive just after returning from the browser. Poll only during that handoff.
    const timer = awaitingCheckout ? window.setInterval(refresh, 3000) : undefined
    const timeout = awaitingCheckout ? window.setTimeout(() => setAwaitingCheckout(false), 5 * 60_000) : undefined
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); clearInterval(timer); clearTimeout(timeout) }
  }, [state, awaitingCheckout])
  const signIn = async () => {
    if (action.current) return
    action.current = true; setBusy('signin'); setError('')
    try {
      await window.agentshot.account.signIn()
      if (mounted.current) await check()
    } catch {
      if (mounted.current) setError('Sign-in didn’t finish. Please try again.')
    } finally { action.current = false; if (mounted.current) setBusy(null) }
  }
  const upgrade = async () => {
    if (action.current) return
    action.current = true; setBusy('checkout'); setError('')
    try {
      // Check actual sign-in state rather than relying on the last rendered button.
      const who = await window.agentshot.account.status()
      if (!who.email) { setBusy('signin'); await window.agentshot.account.signIn() }
      if (!mounted.current) return
      if (await window.agentshot.voiceover.access()) { await check(); return }
      setBusy('checkout')
      await window.agentshot.account.checkout({ plan: 'pro' })
      if (mounted.current) { setAwaitingCheckout(true); await check() }
    } catch {
      if (mounted.current) setError('We couldn’t open checkout. Please try again.')
    } finally { action.current = false; if (mounted.current) setBusy(null) }
  }
  return { state, account, busy, error, awaitingCheckout, check, signIn, upgrade }
}
