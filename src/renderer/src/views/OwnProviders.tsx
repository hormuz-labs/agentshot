import { useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowLeft, Check, ChevronRight, Search, Server, X } from 'lucide-react'
import { ProviderLogo } from '@/components/ProviderLogo'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { KeyInfo } from '../../../shared/types'
import type { ChatGPTStatus } from '../../../shared/chatgpt'
import type { ClaudeCodeStatus } from '../../../shared/claude-code'
import { ChatGPTSection } from './ChatGPTSection'
import { ClaudeCodeSection } from './ClaudeCodeSection'
import { ProvidersSection } from './ProvidersSection'

type Provider = { id: string; name: string; description: string; connected: boolean; status?: string; key?: KeyInfo }
const capabilities: Record<string, string> = { text: 'Editing agent', images: 'Images', voice: 'Voice', music: 'Music' }
const message = (e: unknown) => (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

/** One quiet provider list; billing choices and credentials belong in the connection dialog. */
export function OwnProviders({ keys, onKeys }: { keys: KeyInfo[]; onKeys(keys: KeyInfo[]): void }) {
  const [chatgpt, setChatgpt] = useState<ChatGPTStatus>()
  const [claude, setClaude] = useState<ClaudeCodeStatus>()
  const [custom, setCustom] = useState<Awaited<ReturnType<typeof window.agentshot.providers.list>>>()
  const [selected, setSelected] = useState<string | null>(null)
  const [method, setMethod] = useState<'key' | 'subscription' | null>(null)
  const [search, setSearch] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const refresh = () => {
    void window.agentshot.chatgpt.status().then(setChatgpt).catch(() => {})
    void window.agentshot.claudeCode.status().then(setClaude).catch(() => {})
    void window.agentshot.providers.list().then(setCustom).catch(() => {})
  }
  useEffect(refresh, [])
  const chatConnected = !!chatgpt?.active && chatgpt.accounts.some(a => a.id === chatgpt.active && a.connected)
  const claudeConnected = !!claude?.connected && claude.enabled
  const providers: Provider[] = keys.filter(k => k.env !== 'MANUL_KEY').map(k => ({
    id: k.env, key: k, name: k.env === 'ANTHROPIC_API_KEY' ? 'Anthropic' : k.label,
    description: k.env === 'OPENAI_API_KEY' ? 'ChatGPT subscription or API key'
      : k.env === 'ANTHROPIC_API_KEY' ? 'Claude Code or API key' : k.unlocks.map(c => capabilities[c] || c).join(', '),
    connected: k.set || (k.env === 'OPENAI_API_KEY' && chatConnected) || (k.env === 'ANTHROPIC_API_KEY' && claudeConnected),
    status: [k.env === 'OPENAI_API_KEY' && chatConnected ? 'ChatGPT plan' : '', k.env === 'ANTHROPIC_API_KEY' && claudeConnected ? claude?.subscription ? 'Claude subscription' : 'Claude Code' : '', k.set ? 'API key' : ''].filter(Boolean).join(' + '),
  }))
  // Subscription-capable providers lead; the rest retain the familiar key ordering.
  const rank = (id: string) => id === 'OPENAI_API_KEY' ? 0 : id === 'ANTHROPIC_API_KEY' ? 1 : 2
  providers.sort((a, b) => rank(a.id) - rank(b.id))
  const current = providers.find(p => p.id === selected)
  const rows = providers.filter(p => `${p.name} ${p.description}`.toLowerCase().includes(search.toLowerCase()))
  const have = new Set([...keys.filter(k => k.set).flatMap(k => k.unlocks), ...(chatConnected || claudeConnected || custom?.providers.some(p => p.keySet) ? ['text'] : [])])
  const open = (id: string) => { setSelected(id); setMethod(null); setValue(''); setError('') }
  const close = () => {
    if (busy) return
    void window.agentshot.chatgpt.cancel().catch(() => {})
    void window.agentshot.claudeCode.cancel().catch(() => {})
    setSelected(null); setValue(''); setError(''); refresh()
  }
  const save = async (remove = false) => {
    if (!current?.key) return
    setBusy(true); setError('')
    try { onKeys(await window.agentshot.keys.set(current.key.env, remove ? '' : value.trim())); setValue(''); setMethod(null) }
    catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  const choice = (title: string, detail: string, action: () => void) => <button type="button" onClick={action} className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-hover focus-visible:outline focus-visible:outline-amber">
    <div className="min-w-0 flex-1"><div className="text-sm font-medium">{title}</div><div className="mt-0.5 text-xs text-faint">{detail}</div></div><ChevronRight className="size-4 text-faint" />
  </button>

  return <div className="pt-1">
    <div className="mb-3 flex items-center gap-2 border-b border-line px-1 pb-2">
      <Search className="size-3.5 text-faint" /><input aria-label="Find a provider" placeholder="Find a provider" value={search} onChange={e => setSearch(e.target.value)} className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
    </div>
    {(['Connected', 'Available'] as const).map(group => {
      const list = rows.filter(p => p.connected === (group === 'Connected'))
      if (!list.length) return null
      return <section key={group} aria-label={`${group} providers`} className="mb-3">
        <div className="px-2 py-1 text-xs text-faint">{group}</div>
        {list.map(p => <div key={p.id} className="flex min-h-14 items-center gap-3 rounded-lg px-2 py-2 hover:bg-hover/50">
          <ProviderLogo provider={p.id} />
          <div className="min-w-0 flex-1"><div className="text-sm font-medium">{p.name}</div><div className="mt-0.5 truncate text-xs text-faint">{p.connected ? p.status : p.description}</div></div>
          {p.connected && <Check className="size-3.5 text-ok" aria-label="Connected" />}
          <Button size="sm" variant="ghost" aria-label={`${p.connected ? 'Manage' : 'Connect'} ${p.name}`} onClick={() => open(p.id)}>{p.connected ? 'Manage' : 'Connect'}</Button>
        </div>)}
      </section>
    })}
    {!rows.length && <p className="px-2 py-4 text-sm text-faint">No providers match your search.</p>}
    {(!search || /custom|other|server|azure/i.test(search)) && <button type="button" onClick={() => open('custom')} className="flex w-full items-center gap-3 rounded-lg border-t border-line px-2 py-3 text-left hover:bg-hover">
      <Server className="size-4 text-dim" /><div className="flex-1"><div className="text-sm">Other providers</div><div className="mt-0.5 text-xs text-faint">{custom?.providers.length ? `${custom.providers.length} configured · ` : ''}Azure, gateways and local models</div></div><ChevronRight className="size-4 text-faint" />
    </button>}
    <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 border-t border-line px-2 pt-3">
      {Object.entries(capabilities).map(([cap, label]) => <span key={cap} className={cn('inline-flex items-center gap-1 text-xs', have.has(cap) ? 'text-dim' : 'text-faint line-through')}>{have.has(cap) && <Check className="size-3 text-ok" />}{label}</span>)}
    </div>
    <Dialog.Root open={selected !== null} onOpenChange={v => { if (!v) close() }}>
      <Dialog.Portal><Dialog.Overlay className="fixed inset-0 z-[70] bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[71] max-h-[85vh] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-5 shadow-2xl" onEscapeKeyDown={e => { if (busy) e.preventDefault() }} onPointerDownOutside={e => { if (busy) e.preventDefault() }}>
          <div className="mb-1 flex items-center gap-2">
            {method && <button type="button" aria-label="Back to connection methods" disabled={busy} onClick={() => { setMethod(null); setValue(''); setError('') }} className="rounded-md p-1 text-dim hover:bg-hover"><ArrowLeft className="size-4" /></button>}
            {current && <ProviderLogo provider={current.id} />}
            <Dialog.Title className="flex-1 text-base font-semibold">{selected === 'custom' ? 'Other providers' : current?.name}</Dialog.Title>
            <Dialog.Close aria-label="Close provider connection" disabled={busy} className="rounded-md p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></Dialog.Close>
          </div>
          <Dialog.Description className="mb-5 text-xs text-dim">{selected === 'custom' ? 'Connect your endpoint and choose its models.' : method === 'key' ? 'Your key stays encrypted on this computer.' : 'Choose how you want to connect.'}</Dialog.Description>
          {selected === 'custom' ? <ProvidersSection /> : method === 'subscription' ? current?.id === 'OPENAI_API_KEY'
            ? <ChatGPTSection compact onConnected={() => refresh()} /> : <ClaudeCodeSection compact onConnected={() => refresh()} />
            : method === 'key' ? <form onSubmit={e => { e.preventDefault(); if (value.trim()) void save() }} className="space-y-3">
              <label className="block text-xs font-medium" htmlFor="provider-api-key">API key</label>
              <input autoFocus id="provider-api-key" type="password" autoComplete="off" value={value} onChange={e => setValue(e.target.value)} placeholder={current?.key?.hint} className="h-10 w-full rounded-lg border border-line bg-bg px-3 font-mono text-xs outline-none focus:border-amber/60" />
              <p className="text-xs text-faint">Usage is billed to your API account, not your subscription.</p>
              <div className="flex gap-2"><Button size="md" variant="primary" type="submit" disabled={busy || !value.trim()}>{busy ? 'Saving…' : 'Save key'}</Button>{current?.key?.set && <Button size="md" variant="ghost" disabled={busy} type="button" onClick={() => save(true)}>Remove key</Button>}</div>
            </form> : <div className="-mx-2">
              {current?.id === 'OPENAI_API_KEY' && choice('ChatGPT subscription', chatConnected ? 'Connected · manage accounts and usage' : 'Sign in with your ChatGPT plan', () => setMethod('subscription'))}
              {current?.id === 'ANTHROPIC_API_KEY' && choice('Claude Code', claudeConnected ? 'Connected · manage your connection' : 'Sign in with your Claude plan', () => setMethod('subscription'))}
              {choice(current?.key?.set ? 'Manage API key' : 'API key', 'Pay through your own API account', () => setMethod('key'))}
            </div>}
          {error && <p role="alert" className="mt-3 text-xs text-bad">{error}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>
}
