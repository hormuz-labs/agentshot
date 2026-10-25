import type { DriveStep } from 'driver.js'
import { tourTarget } from './product-tour'

export const SETTINGS_TOUR_STEPS: { section: 'keys' | 'browser'; keyTab?: 'own' | 'agentshot'; step: DriveStep }[] = [
  { section: 'keys', keyTab: 'own', step: {
    element: () => tourTarget('own-key-tab')!,
    popover: { title: 'Your own key = bring your own key', side: 'bottom', align: 'center',
      description: 'An API key lets AgentShot talk to an AI service. A “normal key” means a key from a provider such as Gemini, Anthropic or OpenAI.<p><strong>Bring your own key (BYOK)</strong> means you create a key in that provider’s account, click Add beside the provider here, paste the key and Save. API usage is billed by that provider to your account.</p><p>Keys are stored encrypted in your system keychain. You only need one editing provider to get started.</p>' },
  } },
  { section: 'keys', keyTab: 'agentshot', step: {
    element: () => tourTarget('agentshot-key-tab')!,
    popover: { title: 'AgentShot key: one connection for your AI', side: 'bottom', align: 'center',
      description: 'An <strong>AgentShot key</strong> connects you through AgentShot’s service, which picks the model for the job. You do not need to set up a separate account and API key with each AI provider.<p>Sign in to AgentShot here, or paste an AgentShot key you already have. Usage comes from your AgentShot credit; you can check your balance and add credit in this tab.</p><p>Your own provider keys, when configured, are used first. Signing in is available in builds that support it.</p>' },
  } },
  { section: 'browser', step: {
    element: () => tourTarget('settings-browser-tab')!,
    popover: { title: 'Browser: where AgentShot uses the web', side: 'right', align: 'end', doneBtnText: 'Got it',
      description: 'This tab chooses the browser the editing assistant uses to research references, find footage or music, and work with websites.<p><strong>AgentShot’s own browser</strong> is the default. It runs in the Browser panel inside the app, separate from your personal Chrome. In a project, the globe button opens that panel.</p><p><strong>Your Chrome</strong> uses your existing Chrome logins through BrowserSkill. Choose it only when you want the assistant to use those accounts.</p>' },
  } },
]
