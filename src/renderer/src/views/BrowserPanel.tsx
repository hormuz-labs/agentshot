// AgentShot's own browser, over the film: the agent's bsk drives it (its tabs have an amber edge) and the user can browse and
// sign in here too. The page itself is a native view the main process lays over the page area below; this component
// only draws the chrome around it and reports where the page area is (or that it is hidden or covered by a dialog).
import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Bot, Globe, Loader2, Plus, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BrowserMode, BrowserState } from '../../../shared/types'

const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, '') } catch { return '' } }

/** Something drawn over the page (a dialog, palette, popover): the native page view must step aside for it. */
const covered = () => !!document.querySelector('[role="dialog"], [data-radix-popper-content-wrapper]')

export function useBrowserState() {
  const [s, setS] = useState<BrowserState>({ tabs: [], active: null, bsk: { connected: false, status: 'starting' } })
  useEffect(() => { window.agentshot.browser.state().then(setS); return window.agentshot.browser.onState(setS) }, [])
  return s
}

export function BrowserPanel({ visible, onClose }: { visible: boolean; onClose(): void }) {
  const s = useBrowserState()
  const area = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<BrowserMode>('manul')
  const tab = s.tabs.find(t => t.id === s.active)
  const [url, setUrl] = useState('')
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setUrl(tab?.url && tab.url !== 'about:blank' ? tab.url : '') }, [tab?.url, editing])
  useEffect(() => { window.agentshot.browser.mode().then(setMode) }, [visible])

  // tell the main process where the page goes, and hide it while this panel is hidden or something covers it
  useEffect(() => {
    const report = () => {
      const el = area.current
      if (!visible || !el || covered()) return window.agentshot.browser.setBounds(null)
      const r = el.getBoundingClientRect()
      window.agentshot.browser.setBounds(r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null)
    }
    report()
    if (!visible) return
    const ro = new ResizeObserver(report)
    if (area.current) ro.observe(area.current)
    const mo = new MutationObserver(report)
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'data-state'] })
    window.addEventListener('resize', report)
    return () => { ro.disconnect(); mo.disconnect(); window.removeEventListener('resize', report); window.agentshot.browser.setBounds(null) }
  }, [visible])

  const agentHere = !!tab?.agent
  const status = mode === 'chrome'
    ? { dot: 'bg-faint', label: 'The agent uses your own Chrome (Settings → Browser). This browser is yours.' }
    : s.bsk.connected ? { dot: agentHere ? 'bg-amber' : 'bg-ok', label: agentHere ? 'The agent is using this tab.' : 'The agent browses here, never in your Chrome.' }
      : { dot: 'bg-faint animate-pulse', label: 'Connecting the agent…' }

  return (
    <div className={cn('absolute inset-0 z-20 flex flex-col bg-canvas', !visible && 'hidden')} data-testid="browser-panel">
      {/* one toolbar, level with the transcript and agent headers: navigation, address, tabs */}
      <div className="flex h-11 shrink-0 items-center gap-1 px-2" data-panel-header>
        <Button size="iconSm" variant="ghost" disabled={!tab?.canBack} onClick={() => window.agentshot.browser.back()} title="Back"><ArrowLeft /></Button>
        <Button size="iconSm" variant="ghost" disabled={!tab?.canForward} onClick={() => window.agentshot.browser.forward()} title="Forward"><ArrowRight /></Button>
        <Button size="iconSm" variant="ghost" onClick={() => window.agentshot.browser.reload()} title="Reload">{tab?.loading ? <Loader2 className="animate-spin" /> : <RotateCw />}</Button>
        {/* the address bar is the current tab: its title at rest, its address when you click to type */}
        <form
          className="group/addr mx-1 flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md bg-raised px-2.5 ring-1 ring-transparent focus-within:ring-amber/50"
          onSubmit={e => { e.preventDefault(); if (url.trim()) window.agentshot.browser.navigate(url.trim()); setEditing(false); (document.activeElement as HTMLElement)?.blur() }}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', status.dot)} title={status.label} data-testid="browser-status" />
          {editing || !tab || !tab.title ? (
            <input
              autoFocus={editing}
              value={url}
              onChange={e => setUrl(e.target.value)}
              onFocus={e => { setEditing(true); e.target.select() }}
              onBlur={() => setEditing(false)}
              placeholder="Search or enter address"
              className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-faint"
            />
          ) : (
            <button type="button" className="flex min-w-0 flex-1 items-baseline gap-2 text-left text-xs" onClick={() => setEditing(true)} title={tab.url} data-testid="browser-address">
              <span className="truncate text-fg">{tab.title}</span>
              <span className="shrink-0 truncate text-faint">{host(tab.url)}</span>
            </button>
          )}
          {tab?.recording
            ? <span data-recording className="flex shrink-0 items-center gap-1.5 text-[10.5px] text-bad" title="AgentShot is filming this tab for a walkthrough. The time it spends thinking is cut later."><span className="size-1.5 animate-pulse rounded-full bg-bad" />Recording</span>
            : agentHere && <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-amber"><Bot className="size-3" />Agent</span>}
          {tab && s.tabs.length > 1 && !editing && (
            <button type="button" className="shrink-0 rounded text-faint opacity-0 hover:text-fg group-hover/addr:opacity-100" onClick={() => window.agentshot.browser.close(tab.id)} title="Close this tab"><X className="size-3" /></button>
          )}
        </form>
        {/* the other tabs (the current one is the address bar) */}
        {s.tabs.filter(t => t.id !== s.active).map(t => (
          <div
            key={t.id}
            onClick={() => window.agentshot.browser.select(t.id)}
            onAuxClick={e => { if (e.button === 1) window.agentshot.browser.close(t.id) }}
            data-agent={t.agent || undefined}
            data-testid="browser-tab"
            className="group flex h-7 w-[120px] shrink cursor-default items-center gap-1.5 rounded-md px-2 text-xs text-dim hover:bg-hover hover:text-fg"
            title={t.agent ? `The agent is using this tab · ${t.url}` : t.url}
          >
            {t.recording ? <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-bad" /> : t.loading ? <Loader2 className="size-3 shrink-0 animate-spin" /> : t.agent ? <Bot className="size-3 shrink-0 text-amber" /> : <Globe className="size-3 shrink-0" />}
            <span className="truncate">{t.title || host(t.url) || 'New tab'}</span>
            <button className="ml-auto shrink-0 rounded text-faint opacity-0 hover:text-fg group-hover:opacity-100" onClick={e => { e.stopPropagation(); window.agentshot.browser.close(t.id) }}><X className="size-3" /></button>
          </div>
        ))}
        <Button size="iconSm" variant="ghost" onClick={() => window.agentshot.browser.newTab()} title="New tab"><Plus /></Button>
        <Button size="iconSm" variant="ghost" onClick={onClose} title="Back to the film (⌘⇧B)"><X /></Button>
      </div>
      {/* the page: a native view is laid exactly over this box, as a rounded card */}
      <div className="min-h-0 flex-1 px-2 pb-2">
        <div ref={area} className={cn('relative h-full rounded-lg bg-raised/40', agentHere && 'ring-1 ring-amber/50')} data-agent-tab={agentHere || undefined}>
          {!s.tabs.length && <div className="absolute inset-0 flex items-center justify-center text-dim">Opening…</div>}
        </div>
      </div>
    </div>
  )
}
