// Keyboard shortcuts, by command id: one list for the native menu (which binds them) and the ⌘K palette (which shows
// them), so the two can never disagree. Written as Electron accelerators. Single keys the project view handles itself
// (Space, N, B) are not here: they work only while no field has focus, which a menu accelerator can't know.

export const SHORTCUTS: Record<string, string> = {
  palette: 'CmdOrCtrl+K',
  home: 'CmdOrCtrl+N',
  media: 'CmdOrCtrl+I',
  export: 'CmdOrCtrl+E',
  'tab.close': 'CmdOrCtrl+W',
  'tab.next': 'Ctrl+Tab',
  'tab.prev': 'Ctrl+Shift+Tab',
  ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`tab.${i + 1}`, `CmdOrCtrl+${i + 1}`])),
  settings: 'CmdOrCtrl+,',
  sidebar: 'CmdOrCtrl+\\',
  history: 'CmdOrCtrl+Shift+H',
  browser: 'CmdOrCtrl+Shift+B',
  'agent.new': 'CmdOrCtrl+Shift+N',
  'agent.focus': 'CmdOrCtrl+L',
  'agent.stop': 'CmdOrCtrl+.',
  'timeline.undo': 'CmdOrCtrl+Z',
  'timeline.redo': 'CmdOrCtrl+Shift+Z',
}

const MAC_MODIFIERS: Record<string, string> = { Ctrl: '⌃', Control: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', CmdOrCtrl: '⌘', Cmd: '⌘', Command: '⌘' }
// how macOS orders modifier symbols
const MAC_ORDER = ['⌃', '⌥', '⇧', '⌘']

/** An accelerator as a person reads it: ⇧⌘H on a Mac, Ctrl+Shift+H elsewhere. */
export function shown(accelerator: string, mac: boolean): string {
  const parts = accelerator.split('+')
  const key = parts.pop()!
  if (mac) {
    const mods = parts.map(p => MAC_MODIFIERS[p] ?? p).sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b))
    return mods.join('') + key
  }
  const mods = parts.map(p => (p === 'CmdOrCtrl' || p === 'Cmd' || p === 'Command' || p === 'Control' ? 'Ctrl' : p === 'Option' ? 'Alt' : p))
  // Ctrl first, then Alt, then Shift, as Windows and Linux menus write them
  const order = ['Ctrl', 'Alt', 'Shift']
  return [...new Set(mods)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).concat(key).join('+')
}

/** The shortcut for a command, as shown on this platform, if it has one. */
export const shortcutFor = (id: string, mac: boolean): string | undefined => (SHORTCUTS[id] ? shown(SHORTCUTS[id], mac) : undefined)
