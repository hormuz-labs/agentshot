import { useEffect, useState } from 'react'
import { Check, KeyRound, Loader2, Sparkles } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { AccountStatus, Balance, KeyInfo } from '../../../shared/types'
import { ProvidersSection } from './ProvidersSection'
import { CodeSignIn, CopySignInLink } from '@/components/CodeSignIn'

const AGENTSHOT_KEY = 'MANUL_KEY'

const CAPS: { cap: string; label: string }[] = [
  { cap: 'text', label: 'Editing agent' },
  { cap: 'images', label: 'Image generation' },
  { cap: 'voice', label: 'AI voice' },
]

export function KeysPanel({ tourTab }: { tourTab?: 'own' | 'agentshot' } = {}) {
  const [keys, setKeys] = useState<KeyInfo[]>([])
  const [tab, setTab] = useState('own')
  const [editing, setEditing] = useState<string | null>(null)
  const [value, setValue] = useState('')
  const [customKeyed, setCustomKeyed] = useState(false)
  useEffect(() => { window.agentshot.keys.list().then(keys => { setKeys(keys); setTab(keys.some(k => k.env === AGENTSHOT_KEY && k.set) ? 'agentshot' : 'own') }) }, [])

  const save = async (env: string, v: string) => {
    setKeys(await window.agentshot.keys.set(env, v.trim()))
    setEditing(null)
    setValue('')
  }
  const have = new Set([...keys.filter(k => k.set).flatMap(k => k.unlocks), ...(customKeyed ? ['text'] : [])])
  const own = keys.filter(k => k.env !== AGENTSHOT_KEY)
  const agentshotKey = keys.find(k => k.env === AGENTSHOT_KEY)

  return (
    <div>
      <PanelHeader title="Keys" description="AgentShot talks to AI models with your keys. They are stored encrypted in your system keychain." />
      <Tabs value={tourTab ?? tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger data-tour="own-key-tab" value="own"><KeyRound className="size-3.5" />Your own keys</TabsTrigger>
          <TabsTrigger data-tour="agentshot-key-tab" value="agentshot"><Sparkles className="size-3.5" />AgentShot key{agentshotKey?.set && <span className="size-1.5 rounded-full bg-ok" />}</TabsTrigger>
        </TabsList>

        <TabsContent value="own" className="space-y-2">
          {own.map(k => (
            <div key={k.env} className="rounded-lg border border-line bg-raised/60 p-3">
              <div className="flex items-center gap-3">
                <span className={cn('size-2 rounded-full', k.set ? 'bg-ok' : 'bg-line-strong')} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.label}</div>
                  <div className="text-xs text-faint">{k.unlocks.join(' · ')}</div>
                </div>
                {editing !== k.env && (
                  <div className="flex gap-1">
                    {k.set && <Button size="sm" variant="ghost" onClick={() => save(k.env, '')}>Remove</Button>}
                    <Button size="sm" onClick={() => { setEditing(k.env); setValue('') }}>{k.set ? 'Replace' : 'Add'}</Button>
                  </div>
                )}
              </div>
              {editing === k.env && (
                <form className="mt-3 flex gap-2" onSubmit={e => { e.preventDefault(); if (value.trim()) save(k.env, value) }}>
                  <input autoFocus type="password" value={value} onChange={e => setValue(e.target.value)} placeholder={k.hint}
                    className="h-8 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-faint focus:border-amber/60" />
                  <Button size="md" variant="primary" type="submit">Save</Button>
                  <Button size="md" variant="ghost" type="button" onClick={() => setEditing(null)}>Cancel</Button>
                </form>
              )}
            </div>
          ))}
          <ProvidersSection onKeyed={setCustomKeyed} />
          <div className="mt-4 rounded-lg border border-dashed border-line p-3">
            <div className="mb-2 text-xs font-medium text-dim">What works with your keys</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {CAPS.map(c => (
                <span key={c.cap} className={cn('inline-flex items-center gap-1 text-xs', have.has(c.cap) ? 'text-fg' : 'text-faint line-through')}>
                  {have.has(c.cap) && <Check className="size-3 text-ok" />}{c.label}
                </span>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="agentshot">
          <AgentShotKey agentshotKey={agentshotKey} onKeys={setKeys} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

const message = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** AgentShot key: sign in (the browser, then back here with the person's key), or paste a key. */
function AgentShotKey({ agentshotKey, onKeys }: { agentshotKey?: KeyInfo; onKeys(k: KeyInfo[]): void }) {
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pasting, setPasting] = useState(false)
  const [value, setValue] = useState('')
  useEffect(() => { window.agentshot.account.status().then(setAccount) }, [])
  const refresh = async (a?: AccountStatus) => { if (a) setAccount(a); onKeys(await window.agentshot.keys.list()) }

  const signIn = async () => {
    setBusy(true); setError('')
    try { await refresh(await window.agentshot.account.signIn()) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const signOut = async () => refresh(await window.agentshot.account.signOut())
  const paste = async () => { onKeys(await window.agentshot.keys.set(AGENTSHOT_KEY, value.trim())); setValue(''); setPasting(false) }
  const remove = async () => onKeys(await window.agentshot.keys.set(AGENTSHOT_KEY, ''))

  if (!agentshotKey || !account) return null
  const row = 'mx-auto mt-4 flex max-w-md items-center gap-3 rounded-lg border border-line bg-bg px-3 py-2'
  return (
    <div className="rounded-lg border border-line bg-raised/60 p-5">
      <div className="text-center">
        <div className="orb mx-auto mb-3 size-10 rounded-full" />
        <div className="text-[15px] font-semibold">One key for everything</div>
        <p className="mx-auto mt-1 max-w-sm text-dim">AgentShot picks the best model for the job and keeps it current. New accounts start with 1,000 credits; Pro and Max plans add more every month and unlock the Max and Ultra models. Your own keys, when set, are used first. On Pitch? Sign in with the same email: your plan and credits are here.</p>
      </div>
      {account.email && agentshotKey.set ? (
        <>
          <div className={row}>
            <span className="size-2 rounded-full bg-ok" />
            <span className="min-w-0 flex-1 truncate text-[13px]">Signed in as <span className="font-medium">{account.email}</span></span>
            <Button size="sm" variant="ghost" onClick={signOut}>Sign out</Button>
          </div>
          <Credit />
        </>
      ) : agentshotKey.set && !pasting ? (
        <div className={row}>
          <span className="size-2 rounded-full bg-ok" />
          <span className="flex-1 text-[13px]">AgentShot key added</span>
          <Button size="sm" variant="ghost" onClick={remove}>Remove</Button>
          <Button size="sm" onClick={() => setPasting(true)}>Replace</Button>
        </div>
      ) : pasting ? (
        <form className="mx-auto mt-4 flex max-w-md gap-2" onSubmit={e => { e.preventDefault(); if (value.trim()) paste() }}>
          <input autoFocus type="password" value={value} onChange={e => setValue(e.target.value)} placeholder="Paste your AgentShot key" aria-label="AgentShot key"
            className="h-8 flex-1 rounded-lg border border-line bg-bg px-2.5 font-mono text-xs outline-none placeholder:font-sans placeholder:text-faint focus:border-amber/60" />
          <Button size="md" variant="primary" type="submit">Save</Button>
          <Button size="md" variant="ghost" type="button" onClick={() => setPasting(false)}>Cancel</Button>
        </form>
      ) : (
        <div className="mt-4 flex flex-col items-center gap-2">
          {busy ? (
            <>
              <div className="flex items-center gap-2 text-[13px] text-dim">
                <Loader2 className="size-3.5 animate-spin" />Finish signing in in your browser…
                <Button size="sm" variant="ghost" onClick={() => window.agentshot.account.cancel()}>Cancel</Button>
              </div>
              <CopySignInLink />
            </>
          ) : (
            <Button size="md" variant="primary" disabled={!account.available} onClick={signIn}>Sign in to AgentShot</Button>
          )}
          {error && <p className="max-w-sm text-center text-xs text-bad">{error}</p>}
          {!account.available && <p className="text-xs text-faint">Signing in isn’t available in this build.</p>}
          {!busy && <CodeSignIn onSignedIn={refresh} />}
          <button className="text-xs text-faint underline-offset-2 hover:text-fg hover:underline" onClick={() => setPasting(true)}>Have a key? Paste it</button>
        </div>
      )}
    </div>
  )
}

/** Credits and plan (one wallet with Pitch): a plan or a top-up is a Dodo Payments checkout in the browser. */
function Credit() {
  const [b, setB] = useState<Balance | null>(null)
  const [error, setError] = useState('')
  const [opening, setOpening] = useState('')
  const [yearly, setYearly] = useState(false)
  const load = () => window.agentshot.account.balance().then(x => { setB(x); setError('') }, e => setError(message(e)))
  useEffect(() => {
    load()
    window.addEventListener('focus', load) // back from paying in the browser
    return () => window.removeEventListener('focus', load)
  }, [])
  const open = async (what: string, run: () => Promise<void>) => {
    setOpening(what); setError('')
    try { await run() } catch (e) { setError(message(e)) } finally { setOpening('') }
  }
  const n = (x: number) => x.toLocaleString('en-US')
  const until = b?.plan && new Date(b.plan.until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  const plans = (b?.plans || []).filter(p => (p.every === 'year') === yearly)
  const flex = b?.topups.find(t => t.key === 'flex')
  return (
    <div className="mx-auto mt-2 max-w-md rounded-lg border border-line bg-bg px-3 py-2.5" data-credit>
      <div className="flex items-center gap-3">
        <span className="flex-1 text-[13px]">
          {b ? <><span className="font-medium tabular">{n(b.credits)}</span> <span className="text-dim">credits</span></> : <span className="text-faint">Credits…</span>}
        </span>
        {b?.plan && <span className="rounded-full bg-amber/15 px-2 py-0.5 text-[11px] font-medium text-amber">{b.plan.name}</span>}
      </div>
      {b?.discount && <p className="mt-1 text-[11px] font-medium text-ok">Launch offer: {b.discount.on} at {b.discount.percent}% off</p>}
      {b?.plan ? (
        <>
          <p className="mt-1 text-xs text-dim">
            {n(b.plan.credits)} credits a {b.plan.every}{b.plan.renews ? `, renews ${until}` : `, ends ${until}`}. Every model tier is yours.
          </p>
          <div className="mt-2 flex gap-2">
            {flex?.buyable && (
              <Button size="sm" variant="primary" disabled={!!opening} onClick={() => open('flex', () => window.agentshot.account.checkout({ topup: 'flex' }))}>
                {opening === 'flex' ? 'Opening…' : `${n(flex.credits)} more credits · $${flex.price}`}
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={!!opening} onClick={() => open('billing', () => window.agentshot.account.billing())}>
              {opening === 'billing' ? 'Opening…' : 'Manage billing'}
            </Button>
          </div>
        </>
      ) : b && (
        <>
          <div className="mt-2 flex items-center gap-2 text-xs text-dim">
            <span className="flex-1">Plans add credits every month and unlock AgentShot Max and Ultra.</span>
            <button className="underline-offset-2 hover:text-fg hover:underline" onClick={() => setYearly(!yearly)}>{yearly ? 'Monthly' : 'Yearly'}</button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {plans.map(p => (
              <button key={p.key} disabled={!p.buyable || !!opening} onClick={() => open(p.key, () => window.agentshot.account.checkout({ plan: p.key }))}
                className="rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-amber/60 disabled:opacity-50">
                <div className="flex items-baseline gap-1">
                  <span className="text-[13px] font-semibold">{p.name}</span>
                  <span className="ml-auto text-[13px] tabular">${p.price}</span>
                  <span className="text-[11px] text-faint">/{p.every === 'year' ? 'yr' : 'mo'}</span>
                </div>
                <div className="text-[11px] text-dim">{opening === p.key ? 'Opening…' : `${n(p.credits)} credits a ${p.every}`}</div>
              </button>
            ))}
          </div>
        </>
      )}
      {error && <p className="mt-1.5 text-xs text-bad">{error}</p>}
    </div>
  )
}
