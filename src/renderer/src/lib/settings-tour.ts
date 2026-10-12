import type { DriveStep } from 'driver.js'
import { tourTarget } from './product-tour'

export const SETTINGS_TOUR_STEPS: { section: 'keys' | 'browser'; keyTab?: 'own' | 'manul'; step: DriveStep }[] = [
  { section: 'keys', keyTab: 'own', step: {
    element: () => tourTarget('own-key-tab')!,
    popover: { title: 'Your own key = bring your own key', side: 'bottom', align: 'center',
      description: 'An API key lets Manul talk to an AI service. A “normal key” means a key from a provider such as Gemini, Anthropic or OpenAI.<p><strong>Bring your own key (BYOK)</strong> means you create a key in that provider’s account, click Add beside the provider here, paste the key and Save. API usage is billed by that provider to your account.</p><p>Keys are stored encrypted in your system keychain. You only need one editing provider to get started.</p>' },
  } },
  { section: 'keys', keyTab: 'manul', step: {
    element: () => tourTarget('manul-key-tab')!,
    popover: { title: 'Manul key: one connection for your AI', side: 'bottom', align: 'center',
      description: 'A <strong>Manul key</strong> connects you through Manul’s service, which picks the model for the job. You do not need to set up a separate account and API key with each AI provider.<p>Sign in to Manul here, or paste a Manul key you already have. Usage comes from your Manul credit; you can check your balance and add credit in this tab.</p><p>Your own provider keys, when configured, are used first. Signing in is available in builds that support it.</p>' },
  } },
  { section: 'browser', step: {
    element: () => tourTarget('settings-browser-tab')!,
    popover: { title: 'Browser: where Manul uses the web', side: 'right', align: 'center', doneBtnText: 'Got it',
      description: 'This tab chooses the browser the editing assistant uses to research references, find footage or music, and work with websites.<p><strong>Manul’s own browser</strong> is the default. It runs in the Browser panel inside Manul, separate from your personal Chrome. In a project, the globe button opens that panel.</p><p><strong>Your Chrome</strong> uses your existing Chrome logins through the BrowserSkill extension and bsk CLI. Choose it only when you want the assistant to use those accounts. You can switch back here anytime.</p>' },
  } },
]
