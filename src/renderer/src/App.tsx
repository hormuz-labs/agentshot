import { useCallback, useEffect, useRef, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useAgent } from '@/lib/agui'
import { ConsentStack } from '@/components/ConsentStack'
import { TelemetryConsent } from '@/components/TelemetryConsent'
import { ProductTour } from '@/components/ProductTour'
import { CommandPalette } from '@/components/CommandPalette'
import { Sidebar, SidebarToggle } from '@/components/Sidebar'
import { Resizer, useWidth } from '@/components/ui/resizer'
import { runCommand, useCommands } from '@/lib/commands'
import { closeTab, cycleTab, openTab, type Tabs } from '@/lib/tabs'
import { cn, typing } from '@/lib/utils'

const stored = (k: string) => { try { return localStorage.getItem(k) } catch { return null } }
const store = (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } }
import { SettingsDialog, type Section } from './views/SettingsDialog'
import { ProjectView } from './views/ProjectView'
import { Start } from './views/Start'
import type { Project } from '../../shared/types'

export function App() {
  const [tabs, setTabs] = useState<Tabs>({ open: [], active: null })
  const [projects, setProjects] = useState<Record<string, { p: Project; prompt?: string; files?: string[] }>>({})
  const restored = useRef(false)
  const [tabsRestored, setTabsRestored] = useState(false)
  const [consentSettled, setConsentSettled] = useState(false)
  const [settings, setSettings] = useState<Section | null>(null)
  const [ready, setReady] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  useAgent(null) // subscribe to agent events from the start, before any project view mounts

  // the sidebar shown, or folded away to its rail
  const [collapsed, setCollapsed] = useState(() => stored('manul.sidebar') === '0')
  useEffect(() => store('manul.sidebar', collapsed ? '0' : '1'), [collapsed])
  const sidebar = useWidth('manul.width.sidebar', 264, 200, 440)

  const [palette, setPalette] = useState(false)
  const [ready2update, setReady2update] = useState<string | null>(null)
  useEffect(() => window.manul.updates.onChange(st => setReady2update(st.status === 'ready' ? st.version || 'A new version' : null)), [])
  const check = () => window.manul.agent.ready().then(setReady)
  useEffect(() => window.manul.onMenu(id => {
    if (id === 'palette') setPalette(true)
    // Edit → Undo / Redo: the field being typed in undoes its text; elsewhere the timeline undoes an edit
    else if (id === 'undo' || id === 'redo') { if (typing()) document.execCommand(id); else runCommand(`timeline.${id}`) }
    else runCommand(id)
  }), [])
  useEffect(() => { check(); const a = window.manul.agent.onReady(check); const b = window.manul.onNotice(setNotice); return () => { a(); b() } }, [])

  // open tabs come back after a relaunch
  useEffect(() => {
    window.manul.tabs.get().then(async saved => {
      const ok: Record<string, { p: Project }> = {}
      for (const d of saved.open) { try { ok[d] = { p: await window.manul.project.open(d) } } catch { /* moved or deleted */ } }
      setProjects(ok)
      const open = saved.open.filter(d => ok[d])
      setTabs({ open, active: saved.active && ok[saved.active] ? saved.active : open[0] ?? null })
      restored.current = true
      setTabsRestored(true)
    })
  }, [])
  useEffect(() => { if (restored.current) window.manul.tabs.set(tabs) }, [tabs])
  // the shown project's agent conversation is the one events and sends go to
  useEffect(() => { if (tabs.active) window.manul.agent.attach(tabs.active) }, [tabs.active])

  const openProject = useCallback((p: Project, prompt?: string, files?: string[]) => {
    setProjects(x => ({ ...x, [p.dir]: { p, prompt, files } }))
    setTabs(t => openTab(t, p.dir))
  }, [])
  const close = useCallback((dir: string) => {
    setTabs(t => closeTab(t, dir))
    setProjects(x => { const { [dir]: _, ...rest } = x; return rest })
    window.manul.project.close(dir)
  }, [])

  const mod = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+'
  useCommands([
    { id: 'palette', title: 'Command palette', shortcut: `${mod}K`, run: () => setPalette(true) },
    { id: 'home', title: 'New project', keywords: 'start home open recent tab', shortcut: `${mod}N`, run: () => setTabs(t => ({ ...t, active: null })) },
    { id: 'tab.next', title: 'Next project', shortcut: 'Ctrl+Tab', run: () => setTabs(t => cycleTab(t, 1)) },
    { id: 'tab.prev', title: 'Previous project', shortcut: 'Ctrl+Shift+Tab', run: () => setTabs(t => cycleTab(t, -1)) },
    { id: 'tab.close', title: 'Close project', shortcut: `${mod}W`, run: () => setTabs(t => { if (t.active) setTimeout(() => close(t.active!), 0); return t }) },
    ...Array.from({ length: 9 }, (_, i) => ({ id: `tab.${i + 1}`, title: `Go to project ${i + 1}`, run: () => setTabs(t => (t.open[i] ? { ...t, active: t.open[i] } : t)) })),
    { id: 'sidebar', title: 'Show or hide the sidebar', keywords: 'projects', shortcut: `${mod}\\`, run: () => setCollapsed(c => !c) },
    { id: 'settings', title: 'Settings', shortcut: `${mod},`, run: () => setSettings('appearance') },
    { id: 'settings.appearance', title: 'Settings: Appearance', keywords: 'theme light dark mode colours', run: () => setSettings('appearance') },
    { id: 'settings.keys', title: 'Settings: Keys', keywords: 'api gemini anthropic openai elevenlabs', run: () => setSettings('keys') },
    { id: 'settings.skills', title: 'Settings: Skills', keywords: 'profiles', run: () => setSettings('skills') },
    { id: 'settings.memory', title: 'Settings: Memory', keywords: 'remember', run: () => setSettings('memory') },
    { id: 'settings.browser', title: 'Settings: Browser', keywords: 'chrome bsk web sign in agent browser', run: () => setSettings('browser') },
    { id: 'update.check', title: 'Check for updates', run: () => { setSettings('about'); window.manul.updates.check() } },
    { id: 'about', title: 'About Manul and updates', keywords: 'version update', run: () => setSettings('about') },
    { id: 'settings.tools', title: 'Settings: Tools', keywords: 'whisper ffmpeg download', run: () => setSettings('tools') },
  ], [close])

  const selectDir = async (dir: string) => {
    if (projects[dir]) return setTabs(t => ({ ...t, active: dir }))
    try { openProject(await window.manul.project.open(dir)) } catch (e) { setNotice((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
  // the sidebar folded away entirely, as in Claude's app: its toggle sits by the traffic lights, at the start of the title bar
  const lead = collapsed ? <SidebarToggle onClick={() => setCollapsed(false)} /> : undefined
  const loaded = Object.fromEntries(Object.entries(projects).map(([d, x]) => [d, x.p]))
  const prepareTour = useCallback(() => {
    setCollapsed(false)
    window.dispatchEvent(new Event('manul:tour-prepare'))
  }, [])
  const tourKeys = useCallback(() => setSettings('keys'), [])
  return (
    <TooltipProvider>
      <div className="flex h-full">
        {!collapsed && (
          <div className="relative h-full shrink-0" style={{ width: sidebar.width }}>
            <Sidebar open={tabs.open} active={tabs.active} loaded={loaded}
              onNew={() => setTabs(t => ({ ...t, active: null }))} onSelect={selectDir} onClose={close}
              onSettings={setSettings} onCollapse={() => setCollapsed(true)} />
            <Resizer pane={sidebar} edge="right" label="Resize the sidebar" snap={{ self: setCollapsed }} />
          </div>
        )}
        <div className="relative min-w-0 flex-1 bg-panel">
          {tabs.open.map(d => projects[d] && (
            <div key={d} data-project-view={d} className="absolute inset-0" style={{ display: d === tabs.active ? 'block' : 'none' }}>
              <ProjectView initial={projects[d].p} firstPrompt={projects[d].prompt} firstFiles={projects[d].files} ready={ready} active={d === tabs.active} lead={lead}
                onKeys={() => setSettings('keys')} />
            </div>
          ))}
          {tabs.active === null && (
            <div data-new-project className="absolute inset-0">
              <Start ready={ready} lead={lead} onKeys={() => setSettings('keys')} onTools={() => setSettings('tools')} onOpen={openProject} />
            </div>
          )}
        </div>
      </div>
      <ConsentStack except={tabs.active ?? undefined} />
      <TelemetryConsent onSettled={setConsentSettled} />
      <CommandPalette open={palette} onOpenChange={setPalette}
        onAsk={tabs.active ? q => window.manul.agent.send(tabs.active!, { text: q }).catch(e => setNotice(String(e.message))) : undefined} />
      <SettingsDialog section={settings} onSection={setSettings} onClose={() => { setSettings(null); check() }} />
      <ProductTour project={tabs.active} restored={tabsRestored} ready={ready}
        blocked={!consentSettled || !!settings || palette} onPrepare={prepareTour} onKeys={tourKeys} />
      {ready2update && (
        <div className="fixed bottom-4 left-4 z-40 flex items-center gap-3 rounded-xl border border-amber/30 bg-surface px-3 py-2 shadow-xl shadow-shade">
          <img src="./manul.png" className="size-7 object-contain" alt="" />
          <span className="text-xs">Manul {ready2update} is ready.</span>
          <button className="rounded-md bg-amber px-2 py-1 text-xs font-medium text-on-amber" onClick={() => window.manul.updates.install()}>Restart</button>
          <button className="text-xs text-faint hover:text-fg" onClick={() => setReady2update(null)}>Later</button>
        </div>
      )}
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-bad/30 bg-surface px-4 py-2 text-bad shadow-xl shadow-shade" onClick={() => setNotice(null)}>{notice}</div>
      )}
    </TooltipProvider>
  )
}
