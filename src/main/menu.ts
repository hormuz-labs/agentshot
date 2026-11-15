// The native menu. Items send a command id to the window; the renderer runs the same command the ⌘K palette runs.
// Shortcuts come from SHORTCUTS by command id, the same list the palette shows, so the two always agree.
import { app, Menu, shell, webContents, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { SHORTCUTS } from '../shared/shortcuts'

export function buildMenu(win: () => BrowserWindow | null) {
  const cmd = (id: string, label: string): MenuItemConstructorOptions =>
    ({ label, accelerator: SHORTCUTS[id], click: () => win()?.webContents.send('menu', id) })
  const mac = process.platform === 'darwin'
  const undo = (what: 'undo' | 'redo') => {
    const focused = webContents.getFocusedWebContents()
    if (focused && focused !== win()?.webContents) focused[what]() // AgentShot's browser
    else win()?.webContents.send('menu', what)
  }
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'AgentShot', submenu: [
      cmd('about', 'About AgentShot'), cmd('update.check', 'Check for Updates…'), { type: 'separator' },
      cmd('settings', 'Settings…'), cmd('settings.tools', 'Tools…'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      cmd('home', 'New Project'),
      cmd('media', 'Add Files…'),
      cmd('export', 'Export…'),
      { type: 'separator' },
      cmd('reveal', mac ? 'Show Project in Finder' : 'Show Project Folder'),
      cmd('tab.close', 'Close Project'),
      ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, cmd('settings', 'Settings…'), { role: 'quit' } as MenuItemConstructorOptions]),
    ] },
    // Undo and Redo: a text field's own (or the browser's), else the timeline's edits (the window decides which)
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: SHORTCUTS['timeline.undo'], click: () => undo('undo') },
      { label: 'Redo', accelerator: SHORTCUTS['timeline.redo'], click: () => undo('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      cmd('timeline.render', 'Save as Version'),
    ] },
    { label: 'View', submenu: [
      cmd('palette', 'Command Palette…'),
      { type: 'separator' },
      cmd('sidebar', 'Sidebar'),
      { type: 'separator' },
      cmd('history', 'History'),
      cmd('browser', 'Browser'),
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions]),
    ] },
    { label: 'Agent', submenu: [
      cmd('agent.new', 'New Chat'),
      cmd('agent.focus', 'Ask AgentShot'),
      cmd('agent.stop', 'Stop'),
      { type: 'separator' },
      // these open Settings; the View menu's Browser opens the browser itself
      cmd('settings.skills', 'Skills…'), cmd('settings.memory', 'Memory…'), cmd('settings.keys', 'Keys…'), cmd('settings.browser', 'Browser Settings…'),
    ] },
    { label: 'Window', submenu: [
      cmd('tab.next', 'Next Project'), cmd('tab.prev', 'Previous Project'),
      { label: 'Go to Project', submenu: Array.from({ length: 9 }, (_, i) => cmd(`tab.${i + 1}`, `Project ${i + 1}`)) },
      { type: 'separator' }, { role: 'minimize' }, { role: 'zoom' }, ...(mac ? [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'front' } as MenuItemConstructorOptions] : []),
    ] },
    { role: 'help', submenu: [
      cmd('tour', 'Product Tour'),
      { label: 'Roadmap', click: () => shell.openExternal('https://github.com/hormuz-labs/agentshot/blob/main/ROADMAP.md') },
      { label: 'Report a Problem', click: () => shell.openExternal('https://github.com/hormuz-labs/agentshot/issues/new') },
    ] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
