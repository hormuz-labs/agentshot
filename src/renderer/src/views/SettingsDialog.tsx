// Settings: one place for the look, keys, models, skills, memory, the agent's browser and tools.
import * as D from '@radix-ui/react-dialog'
import { Brain, Globe, Info, KeyRound, Package, Palette, Sparkles, X } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { KeysPanel } from './KeysPanel'
import { MemoryPanel } from './MemoryPanel'
import { AboutPanel } from './AboutPanel'
import { SkillsPanel } from './SkillsPanel'
import { ToolsPanel } from './ToolsPanel'
import { BrowserSettingsPanel } from './BrowserSettingsPanel'
import { AppearancePanel } from './AppearancePanel'
import { SettingsTour } from '@/components/SettingsTour'
import { SETTINGS_TOUR_STEPS } from '@/lib/settings-tour'

export type Section = 'appearance' | 'keys' | 'skills' | 'memory' | 'browser' | 'tools' | 'about'
const SECTIONS: { id: Section; label: string; icon: ReactNode; panel: () => ReactNode }[] = [
  { id: 'appearance', label: 'Appearance', icon: <Palette />, panel: () => <AppearancePanel /> },
  { id: 'keys', label: 'Keys', icon: <KeyRound />, panel: () => <KeysPanel /> },
  { id: 'skills', label: 'Skills', icon: <Sparkles />, panel: () => <SkillsPanel /> },
  { id: 'memory', label: 'Memory', icon: <Brain />, panel: () => <MemoryPanel /> },
  { id: 'browser', label: 'Browser', icon: <Globe />, panel: () => <BrowserSettingsPanel /> },
  { id: 'tools', label: 'Tools', icon: <Package />, panel: () => <ToolsPanel /> },
  { id: 'about', label: 'About', icon: <Info />, panel: () => <AboutPanel /> },
]

export function SettingsDialog({ section, onSection, onClose }: { section: Section | null; onSection(s: Section): void; onClose(): void }) {
  const [tourIndex, setTourIndex] = useState<number | null>(null)
  const open = !!section
  useEffect(() => {
    if (!open) { setTourIndex(null); return }
    let cancelled = false
    window.manul.onboarding.settingsOpened().then(({ state }) => {
      if (!cancelled && state.tourStatus === 'pending') { onSection('keys'); setTourIndex(0) }
    }).catch(e => console.error('Could not record Settings onboarding:', e))
    return () => { cancelled = true }
  }, [open, onSection])
  const finishTour = useCallback((status: 'completed' | 'skipped') => {
    setTourIndex(null)
    void window.manul.onboarding.finishSettings(status).catch(e => console.error('Could not save Settings tour outcome:', e))
  }, [])
  const changeStep = useCallback((index: number) => {
    onSection(SETTINGS_TOUR_STEPS[index].section)
    setTourIndex(index)
  }, [onSection])
  const current = SECTIONS.find(s => s.id === section)
  const touring = tourIndex !== null
  const close = () => { if (touring) finishTour('skipped'); onClose() }
  return (
    <D.Root modal={!touring} open={open} onOpenChange={o => { if (!o) close() }}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" />
        {touring && <div className="fixed inset-0 z-40 bg-scrim backdrop-blur-[2px]" />}
        <D.Content onInteractOutside={e => { if (touring) e.preventDefault() }}
          aria-describedby={undefined} className="fixed left-1/2 top-1/2 z-50 flex h-[640px] max-h-[calc(100vh-48px)] w-[820px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-card border border-line bg-panel shadow-2xl shadow-shade focus:outline-none">
          <D.Title className="sr-only">Settings</D.Title>
          <nav className="w-44 shrink-0 space-y-0.5 bg-bg/50 p-2">
            <div className="px-2 pb-2 pt-1 text-xs font-medium uppercase tracking-wider text-faint">Settings</div>
            {SECTIONS.map(s => (
              <button key={s.id} data-tour={`settings-${s.id}-tab`} onClick={() => onSection(s.id)}
                className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left [&_svg]:size-4', section === s.id ? 'bg-raised text-fg' : 'text-dim hover:bg-hover hover:text-fg')}>
                {s.icon}{s.label}
              </button>
            ))}
          </nav>
          <div className="relative flex-1 overflow-y-auto p-5">
            <D.Close className="absolute right-3 top-3 rounded-md p-1 text-faint hover:bg-hover hover:text-fg"><X className="size-4" /></D.Close>
            {section === 'keys' ? <KeysPanel tourTab={tourIndex === null ? undefined : SETTINGS_TOUR_STEPS[tourIndex].keyTab} /> : current?.panel()}
          </div>
        </D.Content>
      </D.Portal>
      {open && tourIndex !== null && <SettingsTour index={tourIndex} onIndex={changeStep} onFinish={finishTour} />}
    </D.Root>
  )
}
