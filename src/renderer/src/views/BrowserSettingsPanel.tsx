// Settings → Browser: which browser the agent's bsk drives. Manul's own (private, default) or the user's own Chrome
// through the bsk they installed there (their logins), on purpose and reversible.
import { useEffect, useState } from 'react'
import { AppWindow, MonitorSmartphone } from 'lucide-react'
import { PanelHeader } from '@/components/ui/panel-header'
import { cn } from '@/lib/utils'
import type { BrowserMode, ChromeBsk } from '../../../shared/types'

export function BrowserSettingsPanel() {
  const [mode, setMode] = useState<BrowserMode | null>(null)
  const [chrome, setChrome] = useState<ChromeBsk | null>(null)
  useEffect(() => { window.manul.browser.mode().then(setMode); window.manul.browser.chrome().then(setChrome) }, [])
  const pick = async (m: BrowserMode) => setMode(await window.manul.browser.setMode(m))

  const option = (m: BrowserMode, icon: React.ReactNode, title: string, body: React.ReactNode) => (
    <button
      role="radio"
      aria-checked={mode === m}
      data-testid={`browser-mode-${m}`}
      onClick={() => pick(m)}
      className={cn('flex w-full gap-3 rounded-lg border p-3 text-left', mode === m ? 'border-amber/60 bg-amber-soft' : 'border-line bg-raised/60 hover:bg-hover')}
    >
      <span className={cn('mt-0.5 [&_svg]:size-5', mode === m ? 'text-amber' : 'text-dim')}>{icon}</span>
      <span className="flex-1">
        <span className="block font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-dim">{body}</span>
      </span>
      <span className={cn('mt-1 size-3.5 shrink-0 rounded-full border', mode === m ? 'border-amber bg-amber' : 'border-line-strong')} />
    </button>
  )

  return (
    <div>
      <PanelHeader title="Browser" description="Where the agent goes when it needs the web: research, references, footage or music, uploads." />
      <div className="space-y-2" role="radiogroup">
        {option('manul', <AppWindow />, "AgentShot's own browser (recommended)",
          <>The Browser panel inside AgentShot. Separate from your personal browsers: sign in there only to sites you want the agent to use. Your Chrome, and any bsk you installed in it, are never touched.</>)}
        {option('chrome', <MonitorSmartphone />, 'Your Chrome',
          <>The agent uses your own Chrome through the bsk extension you installed there, with everything you are already signed in to. It acts in your real accounts, so it asks before posting, buying or uploading.</>)}
      </div>
      {mode === 'chrome' && chrome && (
        <div className="mt-3 rounded-lg border border-line bg-bg/40 p-3 text-xs" data-testid="chrome-bsk-status">
          {!chrome.daemon && !chrome.cli && <p className="text-dim">bsk is not installed for your Chrome yet. Install the BrowserSkill extension in Chrome and its bsk CLI (github.com/Tencent/BrowserSkill); until then the agent cannot use Chrome.</p>}
          {!chrome.daemon && chrome.cli && <p className="text-dim">Your bsk ({chrome.cli}) is installed but not running. It starts when the agent first uses it; keep Chrome open with the BrowserSkill extension on.</p>}
          {chrome.daemon && !chrome.browsers.length && <p className="text-dim">Your bsk is running, but no Chrome is connected. Open Chrome and check the BrowserSkill extension shows “connected”.</p>}
          {chrome.daemon && chrome.browsers.length > 0 && (
            <p className="text-dim"><span className="mr-1.5 inline-block size-1.5 rounded-full bg-ok align-middle" />Connected: {chrome.browsers.map(b => b.label).join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}
