// The native menu. Items send a command id to the window; the renderer runs the same command the ⌘K palette runs.
import { app, Menu, shell, webContents, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

export function buildMenu(win: () => BrowserWindow | null) {
  const cmd = (id: string, label: string, accelerator?: string): MenuItemConstructorOptions =>
    ({ label, accelerator, click: () => win()?.webContents.send('menu', id) })
  const mac = process.platform === 'darwin'
  const undo = (what: 'undo' | 'redo') => {
    const focused = webContents.getFocusedWebContents()
    if (focused && focused !== win()?.webContents) focused[what]() // AgentShot's browser
    else win()?.webContents.send('menu', what)
  }
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'AgentShot', submenu: [
      cmd('about', 'About AgentShot'), cmd('update.check', 'Check for Updates…'), { type: 'separator' },
      cmd('settings', 'Settings…', 'CmdOrCtrl+,'), cmd('settings.tools', 'Tools…'), { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      cmd('home', 'New Project', 'CmdOrCtrl+N'),
      cmd('media', 'Add Files…', 'CmdOrCtrl+I'),
      cmd('export', 'Export…', 'CmdOrCtrl+E'),
      { type: 'separator' },
      cmd('reveal', 'Show Project in Finder'),
      cmd('tab.close', 'Close Project', 'CmdOrCtrl+W'),
      ...(mac ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, cmd('settings', 'Settings…', 'CmdOrCtrl+,'), { role: 'quit' } as MenuItemConstructorOptions]),
    ] },
    // Undo and Redo: a text field's own (or the browser's), else the timeline's edits (the window decides which)
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => undo('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: () => undo('redo') },
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      { type: 'separator' },
      cmd('timeline.render', 'Save Edit as Version'),
    ] },
    { label: 'View', submenu: [
      cmd('palette', 'Command Palette…', 'CmdOrCtrl+K'),
      { type: 'separator' },
      cmd('sidebar', 'Sidebar', 'CmdOrCtrl+\\'),
      { type: 'separator' },
      cmd('history', 'History', 'CmdOrCtrl+Shift+H'),
      cmd('browser', 'Browser', 'CmdOrCtrl+Shift+B'),
      { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
      ...(app.isPackaged ? [] : [{ type: 'separator' } as MenuItemConstructorOptions, { role: 'reload' } as MenuItemConstructorOptions, { role: 'toggleDevTools' } as MenuItemConstructorOptions]),
    ] },
    { label: 'Agent', submenu: [
      cmd('agent.new', 'New Conversation', 'CmdOrCtrl+Shift+N'),
      cmd('agent.focus', 'Ask AgentShot', 'CmdOrCtrl+L'),
      cmd('agent.stop', 'Stop', 'CmdOrCtrl+.'),
      { type: 'separator' },
      cmd('settings.skills', 'Skills…'), cmd('settings.memory', 'Memory…'), cmd('settings.keys', 'Keys…'), cmd('settings.browser', 'Browser…'),
    ] },
    { label: 'Window', submenu: [
      cmd('tab.next', 'Next Project', 'Ctrl+Tab'), cmd('tab.prev', 'Previous Project', 'Ctrl+Shift+Tab'),
      { label: 'Go to Project', submenu: Array.from({ length: 9 }, (_, i) => cmd(`tab.${i + 1}`, `Project ${i + 1}`, `CmdOrCtrl+${i + 1}`)) },
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
