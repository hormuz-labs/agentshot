// Settings → Appearance: light, dark, or the system's.
import { Monitor, Moon, Sun } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { cn } from '@/lib/utils'
import { useTheme, type Theme } from '@/lib/theme'

const CHOICES: { id: Theme; label: string; icon: typeof Sun; swatch: string }[] = [
  { id: 'light', label: 'Light', icon: Sun, swatch: 'bg-[linear-gradient(135deg,#fcfcfb_50%,#efefed_50%)]' },
  { id: 'dark', label: 'Dark', icon: Moon, swatch: 'bg-[linear-gradient(135deg,#161412_50%,#0e0d0c_50%)]' },
  { id: 'system', label: 'Match system', icon: Monitor, swatch: 'bg-[linear-gradient(135deg,#fcfcfb_50%,#0e0d0c_50%)]' },
]

export function AppearancePanel() {
  const [theme, setTheme] = useTheme()
  return (
    <div>
      <PanelHeader title="Appearance" description="How Manul looks. The film always plays on black." />
      <div className="grid grid-cols-3 gap-3">
        {CHOICES.map(({ id, label, icon: Icon, swatch }) => (
          <button key={id} onClick={() => setTheme(id)} aria-pressed={theme === id}
            className={cn('overflow-hidden rounded-card border text-left transition-colors', theme === id ? 'border-amber ring-2 ring-amber/30' : 'border-line hover:border-line-strong')}>
            <div className={cn('h-20 border-b border-line', swatch)} />
            <div className="flex items-center gap-2 px-3 py-2 text-[13px]"><Icon className="size-4 text-dim" />{label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
