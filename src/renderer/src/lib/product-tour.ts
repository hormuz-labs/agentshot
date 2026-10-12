import type { DriveStep, Popover } from 'driver.js'

export const TOUR_STORAGE_KEY = 'manul.tour.v1'
export type TourPhase = 'home' | 'editor'
type Status = 'completed' | 'skipped'
export type TourProgress = { home?: Status; editor?: Status }

export function readTourProgress(): TourProgress {
  try {
    const value = JSON.parse(localStorage.getItem(TOUR_STORAGE_KEY) || '{}')
    const valid = (s: unknown) => s === 'completed' || s === 'skipped' ? s : undefined
    return { home: valid(value?.home), editor: valid(value?.editor) }
  } catch { return {} }
}

export function saveTourProgress(progress: TourProgress) {
  try { localStorage.setItem(TOUR_STORAGE_KEY, JSON.stringify(progress)) } catch { /* private mode */ }
}

/** Stable, visible targets: background project tabs must never receive the spotlight. */
export function tourTarget(name: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`))
    .find(el => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
}

const example = (text: string) => `<div class="manul-tour-example">“${text}”</div>`
const key = (text: string) => `<kbd>${text}</kbd>`
const step = (title: string, description: string, target?: string | (() => Element), side: 'top' | 'right' | 'bottom' | 'left' = 'bottom', options: Partial<Popover> = {}): DriveStep => ({
  // Resolve at highlight time: proposals and composer readiness can change during a tour.
  ...(target ? { element: typeof target === 'string' ? () => tourTarget(target)! : target } : {}),
  popover: { title, description, side, align: 'center', ...options },
})

export function productTourSteps(phase: TourPhase, platform: string, ready: boolean): DriveStep[] {
  const mac = platform.startsWith('Mac')
  const mod = mac ? '⌘' : 'Ctrl+'
  if (phase === 'home') return [
    step('Direct your video. Manul edits it.', `Welcome to Manul on ${mac ? 'macOS' : 'Linux'}. Bring your footage, describe what you want, and review each edit before keeping it.<p>This quick walkthrough shows you where to start. Once you open a video, we’ll walk through the editor.</p>`, undefined, 'bottom', { nextBtnText: 'Show me around', showButtons: ['next', 'close'] }),
    step('Connect your editing assistant', ready
      ? 'Your editing assistant is connected. Settings → Keys is where you manage your keys. Appearance, Tools, Skills and Memory live here too.'
      : 'Open Settings → Keys. Add your Gemini, Anthropic or OpenAI key, or use the Manul key tab to sign in or paste a key. Save it, then close Settings to continue the walkthrough.<p>Keys are stored encrypted in your system keychain.</p>', 'settings', 'top'),
    step('Start with your footage', 'Drop a video into this box, or click to choose one from your computer. MP4, MOV, WebM and MKV are supported.<p>Subtitles, music and a logo can come along with the video. Editing and transcription run on your computer.</p>', 'import', 'right'),
    step('Say what you want to make', `Type your direction in plain language. Be specific about the length, mood, or parts to change.${example('Cut the ums and long pauses, then add a gentle fade in.')}You can also leave this blank and start with the footage alone.`, 'start-prompt', 'top'),
    step('Need a starting point?', 'These suggestions fill the message box for you. Pick one, then change the wording to suit your film.', 'ideas', 'top'),
    step('Open your first film', `Once you’ve chosen a video, click the amber arrow or press ${key('Enter')}. Manul creates a project and sends any direction you typed.<p>Finish this introduction, then add your footage. The editor walkthrough will be ready when the project opens.</p>`, 'start', 'top', { doneBtnText: 'Let’s make a film' }),
  ]
  return [
    step('Your film, with an editor beside it', 'The conversation is on the left, your film is on the right, and the project’s chats and files are in the sidebar.<p>Let’s follow an edit from your first direction to a finished MP4.</p>', undefined, 'bottom', { nextBtnText: 'Show me the editor', showButtons: ['next', 'close'] }),
    step('Keep the conversation going', ready
      ? `Ask for an edit here, then press ${key('Enter')} to send. ${key('Shift+Enter')} adds a new line. You can steer the edit with another message while Manul works.${example('Trim this to the best 30 seconds and add my name at the start.')}`
      : 'Connect a key with this button before asking for edits. Settings → Keys accepts your own provider keys or a Manul key. Close Settings to return to the tour.', 'composer', 'top'),
    step('Watch your film', `Click Play or press ${key('Space')} to play and pause. Click the timeline to move to another moment.<p>When a preview copy is needed, Manul prepares it automatically. Exports use the original footage.</p>`, 'picture', 'left'),
    step('Point at a moment or a range', `Press ${key('N')} or click Note at the moment you want changed. Drag across the timeline to select a range.<p>A message box opens at your selection. Type your direction and press ${key('Enter')}.</p>${example('Remove this pause.')}`, 'timeline', 'top'),
    step('Point at something in the picture', `Click Box or press ${key('B')}, then draw around the area to change. Describe the edit in the message box that opens beside it.${example('Blur this number plate.')}Your note includes the exact moment and area you selected.`, 'box', 'top'),
    step('Bring in music, logos and more', `Your project opens into Chats and Files here. Use ${key('+')} beside Files to add assets; click a file to attach it to your next message.<p>Type ${key('@')} in the conversation to pick a file, version or title by name. Drag footage from Files onto the timeline to add it to the film.</p>`, 'projects', 'right'),
    step('Compare, then decide', 'After an edit, a Proposed bar appears above the film. Switch Before / After and play or scrub both versions.<p>Accept keeps the proposal. Reject discards it; tell Manul what to try next in the conversation. Your original remains a separate version.</p>', () => (tourTarget('proposal') ?? tourTarget('picture'))!, 'left'),
    step('Every version is within reach', `Use the version picker to revisit a version you kept. History records proposals, decisions and manual edits so you can restore an earlier point.<p>If you move a piece on the timeline yourself, ${key(`${mod}Z`)} undoes the edit.</p>`, 'versions', 'bottom'),
    step('Export a finished MP4', `Click Export or press ${key(`${mod}E`)}. Choose the original size, landscape, vertical or square. For a new shape, choose blurred fill or crop to fill.<p>Captions can go in the picture or into a separate .srt file when a transcript is available.</p>`, 'export', 'bottom'),
    step('You’re ready to direct', `${example('Make a 60-second vertical cut with captions.')}Start with one clear request, watch the proposal, and keep refining.<p>Replay this walkthrough from the sidebar’s tour button, Help → Product Tour, or search “tour” in ${key(`${mod}K`)}.</p>`, undefined, 'bottom', { doneBtnText: 'Start directing' }),
  ]
}
