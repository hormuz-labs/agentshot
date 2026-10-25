// Preload of the hidden page that runs BrowserSkill's background script: installs `chrome` before the script runs and
// reports whether the extension's socket to AgentShot's private bsk daemon is open (the dot in the Browser panel).
import { ipcRenderer } from 'electron'
import { makeChrome, type ExtInfo } from './chrome-shim'

const info = ipcRenderer.sendSync('ext:info') as ExtInfo
const { chrome } = makeChrome({ ipcRenderer, role: 'host', info })
;(globalThis as unknown as { chrome: unknown }).chrome = chrome

// watch the daemon socket: ws://127.0.0.1:<port>
const NativeWS = window.WebSocket
const open = new Set<WebSocket>()
const report = (status: string) => ipcRenderer.send('ext:bsk-status', { connected: open.size > 0, status })
window.WebSocket = class extends NativeWS {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols)
    if (/^wss?:\/\/(127\.0\.0\.1|localhost)/.test(String(url))) {
      this.addEventListener('open', () => { open.add(this); report('connected') })
      this.addEventListener('close', () => { open.delete(this); report('daemon not reachable') })
    }
  }
} as typeof WebSocket
report('connecting')

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { chrome.runtime.onInstalled.emit({ reason: 'update' }); chrome.runtime.onStartup.emit() }, 0)
})
