// Manul's own browser: real Chromium tabs (WebContentsViews on one persistent session, separate from any browser the
// user has) shown in the Browser panel, plus a hidden extension host that runs the bundled BrowserSkill extension's
// background script against these tabs. Electron implements only part of Chrome's extension API, so the host page gets
// a complete `chrome` object (src/preload/chrome-shim.ts) whose calls land here: tabs, windows, debugger (CDP through
// webContents.debugger), scripting, webNavigation, storage, downloads, notifications. Content scripts run in every
// tab's isolated world (src/preload/ext-tab.ts). The extension is preset to Manul's private bsk daemon (src/main/bsk.ts).
import { app, BrowserWindow, ipcMain, Notification, session as electronSession, WebContentsView, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents, type WebFrameMain } from 'electron'
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { isWithinDir } from './paths'
import { queryTabs, Store } from '../shared/ext-match'
import { BINDING, matchExpression, type Cdp } from './cdp'
import type { BrowserState } from '../shared/types'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any

/** BrowserSkill's extension id (fixed by its manifest key): the daemon only accepts sockets from this origin. */
export const BSK_ID = 'hhcmgoofomhgciiibhipgmgkgnoenaoi'
/** Logins made in Manul's browser persist here, apart from the user's own browsers. */
export const WEB_PARTITION = 'persist:manul-web'
const HOST_PARTITION = 'persist:manul-bsk-host'
const HOME_URL = 'https://www.google.com/'

type Tab = { id: number; windowId: number; view: WebContentsView; agent: boolean; opener?: number; lastAccessed: number }
type Win = { id: number; type: string; activeTab: number | null; agent: boolean }
type Rect = { x: number; y: number; width: number; height: number }

/** CDP events only a walkthrough take wants: not passed on to the extension (a screencast frame is a whole JPEG). */
const FILM_EVENTS = new Set(['Page.screencastFrame', 'Page.screencastVisibilityChanged'])
type Filming = { listeners: Set<(method: string, params: Any) => void>; closers: ((why: string) => void)[] }

const MIME: Record<string, string> = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.wasm': 'application/wasm' }

export class Browser {
  ses = electronSession.fromPartition(WEB_PARTITION)
  tabs = new Map<number, Tab>()
  windows = new Map<number, Win>([[1, { id: 1, type: 'normal', activeTab: null, agent: false }]])
  private nextTab = 1
  private nextWin = 2
  shown: number | null = null
  private bounds: Rect | null = null
  private focusedWindow = 1
  bsk = { connected: false, status: 'starting' }
  private local: Store
  private session = new Store({}, c => this.event('storage.onChanged', c, 'session'))
  private pending = new Map<number, (v: Any) => void>()
  private nextReq = 1
  private ports = new Map<string, { frame: WebFrameMain | null }>()
  private downloads = new Map<number, Any>()
  private nextDl = 1
  private wantDl: { id: number; filename?: string }[] = []
  private manifest: Any
  /** tabs a walkthrough take is filming: their debugger stays attached and they keep painting while out of sight */
  private filming = new Map<number, Filming>()
  /** tabs the extension has attached chrome.debugger to */
  private extAttached = new Set<number>()
  host: BrowserWindow | null = null
  private saveT: NodeJS.Timeout | undefined

  constructor(private o: { win: () => BrowserWindow | null; dataDir: string; extDir: string; preloadDir: string; storagePreset: Record<string, unknown>; send: (ch: string, ...a: unknown[]) => void }) {
    mkdirSync(o.dataDir, { recursive: true })
    let saved: Record<string, unknown> = {}
    try { saved = JSON.parse(readFileSync(this.storeFile, 'utf8')) } catch { /* first run */ }
    // the daemon port and label are Manul's, every start (never whatever was stored before)
    this.local = new Store({ ...saved, ...o.storagePreset }, c => { this.saveStore(); this.event('storage.onChanged', c, 'local') })
    this.manifest = JSON.parse(readFileSync(join(o.extDir, 'manifest.json'), 'utf8'))
    this.ses.setUserAgent(this.ses.getUserAgent().replace(/\s?(Electron|manul)\/\S+/gi, '')) // sites refuse "Electron/…"
    this.ipc()
    this.downloadsSetup()
  }

  // ---------------------------------------------------------------- tabs and windows
  tabObj(t: Tab) {
    const wc = t.view.webContents, w = this.windows.get(t.windowId)
    const siblings = [...this.tabs.values()].filter(x => x.windowId === t.windowId)
    const r = this.bounds || { width: 1200, height: 800 }
    return {
      id: t.id, index: siblings.indexOf(t), windowId: t.windowId, openerTabId: t.opener, highlighted: w?.activeTab === t.id,
      active: w?.activeTab === t.id, pinned: false, audible: wc.isCurrentlyAudible(), discarded: false, autoDiscardable: false,
      mutedInfo: { muted: wc.isAudioMuted() }, url: wc.getURL(), title: wc.getTitle(), status: wc.isLoading() ? 'loading' : 'complete',
      incognito: false, width: Math.round(r.width), height: Math.round(r.height), groupId: -1, lastAccessed: t.lastAccessed, selected: w?.activeTab === t.id,
    }
  }
  winObj(w: Win, populate?: boolean) {
    const r = this.bounds || { width: 1200, height: 800 }
    return { id: w.id, focused: this.focusedWindow === w.id, top: 0, left: 0, width: Math.round(r.width), height: Math.round(r.height), incognito: false,
      type: w.type, state: 'normal', alwaysOnTop: false, ...(populate ? { tabs: [...this.tabs.values()].filter(t => t.windowId === w.id).map(t => this.tabObj(t)) } : {}) }
  }

  createTab({ url = 'about:blank', windowId = 1, active = true, opener, agent = false }: { url?: string; windowId?: number; active?: boolean; opener?: number; agent?: boolean } = {}) {
    if (!this.windows.has(windowId)) windowId = 1
    const id = this.nextTab++
    const view = new WebContentsView({ webPreferences: {
      partition: WEB_PARTITION, sandbox: true, contextIsolation: true, nodeIntegrationInSubFrames: true, backgroundThrottling: false,
      preload: join(this.o.preloadDir, 'ext-tab.cjs'),
    } })
    view.setVisible(false)
    view.setBorderRadius?.(8)
    this.o.win()?.contentView.addChildView(view)
    const t: Tab = { id, windowId, view, agent: agent || this.windows.get(windowId)!.agent, opener, lastAccessed: Date.now() }
    this.tabs.set(id, t)
    this.wire(t)
    this.event('tabs.onCreated', this.tabObj(t))
    if (active || !this.windows.get(windowId)!.activeTab) this.activate(id, false)
    view.webContents.loadURL(url).catch(() => {})
    this.push()
    return t
  }

  activate(id: number, fromUser = true) {
    const t = this.tabs.get(id); if (!t) return
    const w = this.windows.get(t.windowId)!, prevWin = this.focusedWindow, prev = w.activeTab
    w.activeTab = id; t.lastAccessed = Date.now()
    this.focusedWindow = t.windowId
    this.show(id)
    if (prev !== id) this.event('tabs.onActivated', { tabId: id, windowId: t.windowId })
    if (prevWin !== t.windowId) this.event('windows.onFocusChanged', t.windowId)
    if (fromUser) this.push()
  }

  private show(id: number) {
    const prev = this.shown && this.shown !== id ? this.tabs.get(this.shown) : undefined
    if (prev) this.hide(prev)
    this.shown = id
    const t = this.tabs.get(id); if (!t) return
    if (this.bounds) { t.view.setBounds(this.bounds); t.view.setVisible(true) } else this.hide(t)
  }

  /** Out of sight. A tab being filmed stays visible at one pixel: Chromium paints nothing for a hidden view. */
  private hide(t: Tab) {
    if (this.filming.has(t.id)) { t.view.setBounds({ x: 0, y: 0, width: 1, height: 1 }); t.view.setVisible(true) }
    else t.view.setVisible(false)
  }

  closeTab(id: number) {
    const t = this.tabs.get(id); if (!t) return
    const w = this.windows.get(t.windowId)!
    this.tabs.delete(id)
    this.endFilming(id, 'The tab was closed.')
    try { if (t.view.webContents.debugger.isAttached()) t.view.webContents.debugger.detach() } catch { /* gone */ }
    this.o.win()?.contentView.removeChildView(t.view)
    t.view.webContents.close()
    const left = [...this.tabs.values()].filter(x => x.windowId === t.windowId)
    this.event('tabs.onRemoved', id, { windowId: t.windowId, isWindowClosing: !left.length })
    if (w.activeTab === id) w.activeTab = null
    if (!left.length && t.windowId !== 1) { this.windows.delete(t.windowId); this.event('windows.onRemoved', t.windowId) }
    if (this.shown === id) {
      this.shown = null
      const next = (left.length ? left : [...this.tabs.values()]).sort((a, b) => b.lastAccessed - a.lastAccessed)[0]
      if (next) this.activate(next.id, false)
    }
    this.push()
  }

  /** Where the panel is in the window (CSS pixels), or null while it is hidden or covered (dialogs, other tabs). */
  setBounds(r: Rect | null) {
    this.bounds = r && { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(1, Math.round(r.width)), height: Math.max(1, Math.round(r.height)) }
    if (this.bounds && !this.tabs.size) this.createTab({ url: HOME_URL })
    for (const t of this.tabs.values()) {
      if (this.bounds && t.id === this.shown) { t.view.setBounds(this.bounds); t.view.setVisible(true) }
      else { if (this.bounds) t.view.setBounds(this.bounds); this.hide(t) }
    }
  }

  private wire(t: Tab) {
    const wc = t.view.webContents
    const upd = (change: Any) => { if (!this.tabs.has(t.id)) return; this.event('tabs.onUpdated', t.id, change, this.tabObj(t)); this.push() }
    wc.on('did-start-loading', () => upd({ status: 'loading' }))
    wc.on('did-stop-loading', () => upd({ status: 'complete' }))
    wc.on('page-title-updated', (_e, title) => upd({ title }))
    wc.on('did-navigate', (_e, url) => upd({ url }))
    wc.on('page-favicon-updated', (_e, f) => upd({ favIconUrl: f[0] }))
    wc.setWindowOpenHandler(({ url }) => { this.createTab({ url, windowId: t.windowId, opener: t.id }); return { action: 'deny' } })
    // webNavigation
    const base = (frameId: number, url: string, parent = -1) => ({ tabId: t.id, frameId, parentFrameId: parent, url, processId: wc.getOSProcessId(), timeStamp: Date.now() })
    const fid = (isMain: boolean, routingId: number) => (isMain ? 0 : routingId)
    wc.on('did-start-navigation', (d: Any) => { if (!d.isSameDocument) this.event('webNavigation.onBeforeNavigate', base(fid(d.isMainFrame, d.frame?.routingId), d.url, d.isMainFrame ? -1 : 0)) })
    wc.on('did-frame-navigate', (_e, url, _code, _status, isMain, _pid, rid) => this.event('webNavigation.onCommitted', { ...base(fid(isMain, rid), url, isMain ? -1 : 0), transitionType: 'link', transitionQualifiers: [] }))
    wc.on('dom-ready', () => this.event('webNavigation.onDOMContentLoaded', base(0, wc.getURL())))
    wc.on('did-frame-finish-load', (_e, isMain, _pid, rid) => this.event('webNavigation.onCompleted', base(fid(isMain, rid), isMain ? wc.getURL() : (wc.mainFrame.framesInSubtree.find(f => f.routingId === rid)?.url || ''))))
    wc.on('did-fail-load', (_e, code, desc, url, isMain, _pid, rid) => { if (code !== -3) this.event('webNavigation.onErrorOccurred', { ...base(fid(isMain, rid), url), error: desc }) })
    wc.on('did-navigate-in-page', (_e, url, isMain, _pid, rid) => this.event(url.includes('#') ? 'webNavigation.onReferenceFragmentUpdated' : 'webNavigation.onHistoryStateUpdated', { ...base(fid(isMain, rid), url), transitionType: 'link', transitionQualifiers: [] }))
    // CDP events from an attached debugger
    wc.debugger.on('message', (_e, method, params, sessionId) => {
      const f = this.filming.get(t.id)
      if (f && !sessionId) {
        for (const l of f.listeners) l(method, params)
        if (FILM_EVENTS.has(method) || (method === 'Runtime.bindingCalled' && params?.name === BINDING)) return
      }
      this.event('debugger.onEvent', sessionId ? { tabId: t.id, sessionId } : { tabId: t.id }, method, params)
    })
    wc.debugger.on('detach', (_e, reason) => {
      this.endFilming(t.id, 'The browser stopped the recording (its debugger was detached).')
      this.event('debugger.onDetach', { tabId: t.id }, reason === 'target closed' ? 'target_closed' : 'canceled_by_user')
    })
  }

  private frameById(t: Tab, frameId = 0) {
    const main = t.view.webContents.mainFrame
    return !frameId ? main : main.framesInSubtree.find(f => f.routingId === frameId) || null
  }
  private frameIdOf(frame: WebFrameMain) { return frame === frame.top ? 0 : frame.routingId }
  private tabOfWc(wc: WebContents) { for (const t of this.tabs.values()) if (t.view.webContents === wc) return t; return null }

  state(): BrowserState {
    return {
      tabs: [...this.tabs.values()].map(t => { const wc = t.view.webContents; return { id: t.id, title: wc.getTitle(), url: wc.getURL(), loading: wc.isLoading(), agent: t.agent, recording: this.filming.has(t.id), canBack: wc.navigationHistory.canGoBack(), canForward: wc.navigationHistory.canGoForward() } }),
      active: this.shown, bsk: this.bsk,
    }
  }
  private push() { this.o.send('browser:state', this.state()) }

  // ---------------------------------------------------------------- the extension host page
  async startHost() {
    const hostSes = electronSession.fromPartition(HOST_PARTITION)
    // the daemon only accepts BrowserSkill's own extension: the host page's socket carries the extension's origin
    hostSes.webRequest.onBeforeSendHeaders({ urls: ['ws://127.0.0.1/*', 'ws://localhost/*', 'ws://127.0.0.1:*/*', 'ws://localhost:*/*'] }, (d, cb) => {
      cb({ requestHeaders: { ...d.requestHeaders, Origin: `chrome-extension://${BSK_ID}` } })
    })
    // manul://bsk/host.html runs the background script; manul://bsk/ext/<file> serves the bundled extension
    hostSes.protocol.handle('manul', async req => {
      const u = new URL(req.url)
      if (u.host !== 'bsk') return new Response('not found', { status: 404 })
      if (u.pathname === '/host.html') return new Response('<!doctype html><meta charset="utf-8"><title>BrowserSkill host</title><script src="manul://bsk/ext/background.js"></script>', { headers: { 'content-type': 'text/html' } })
      const rel = normalize(decodeURIComponent(u.pathname.replace(/^\/ext\//, ''))).replace(/^(\.\.(\/|\\|$))+/, '')
      const file = join(this.o.extDir, rel)
      if (!file.startsWith(this.o.extDir) || !existsSync(file)) return new Response('not found', { status: 404 })
      return new Response(await readFile(file), { headers: { 'content-type': MIME[extname(file)] || 'application/octet-stream' } })
    })
    this.host = new BrowserWindow({ show: false, webPreferences: {
      preload: join(this.o.preloadDir, 'ext-host.cjs'), contextIsolation: false, sandbox: false, backgroundThrottling: false, partition: HOST_PARTITION,
    } })
    this.host.webContents.on('console-message', (e: Any) => { if (e.level === 'error') console.warn(`[bsk host] ${String(e.message).slice(0, 300)}`) })
    await this.host.loadURL('manul://bsk/host.html')
  }

  private event(name: string, ...args: unknown[]) {
    if (this.host && !this.host.isDestroyed()) this.host.webContents.send('ext:event', name, args)
    if (name === 'storage.onChanged') for (const t of this.tabs.values()) t.view.webContents.send('ext:event', name, args)
  }
  /** Send into the host page and wait for its reply. */
  private hostCall(channel: string, ...args: unknown[]) {
    return new Promise(ok => {
      const id = this.nextReq++
      const timer = setTimeout(() => { this.pending.delete(id); ok(undefined) }, 300_000)
      this.pending.set(id, v => { clearTimeout(timer); ok(v) })
      this.host?.webContents.send(channel, id, ...args)
    })
  }
  /** Send into a tab frame's content-script world and wait for its reply. */
  private frameCall(frame: WebFrameMain, channel: string, ...args: unknown[]) {
    const gone = () => new Error('Could not establish connection. Receiving end does not exist.')
    return new Promise((ok, no) => {
      const id = this.nextReq++
      const timer = setTimeout(() => { this.pending.delete(id); no(gone()) }, 300_000)
      this.pending.set(id, v => { clearTimeout(timer); v && v.__noReceiver ? no(gone()) : ok(v) })
      try { frame.send(channel, id, ...args) } catch (e) { clearTimeout(timer); this.pending.delete(id); no(e) }
    })
  }
  private senderOf(e: IpcMainEvent | IpcMainInvokeEvent) {
    const t = this.tabOfWc(e.sender), frame = e.senderFrame
    return { id: BSK_ID, url: frame?.url, origin: frame?.origin, frameId: frame ? this.frameIdOf(frame) : 0, tab: t ? this.tabObj(t) : undefined }
  }
  private isHost(e: IpcMainEvent | IpcMainInvokeEvent) { return !!this.host && e.sender === this.host.webContents }
  private isTab(e: IpcMainEvent | IpcMainInvokeEvent) { return !!this.tabOfWc(e.sender) }

  private ipc() {
    // only the host page gets the whole API; content scripts in tabs only get storage (as in Chrome); nobody else gets anything
    ipcMain.handle('ext:call', async (e, name: string, args: unknown[]) => {
      if (!this.isHost(e) && !(this.isTab(e) && name.startsWith('storage.'))) return { __error: `chrome.${name} is not available here` }
      try { return await this.api(name, args) } catch (err) { return { __error: String((err as Error)?.message || err) } }
    })
    ipcMain.on('ext:reply', (e, id: number, value: unknown) => {
      if (!this.isHost(e) && !this.isTab(e)) return
      const f = this.pending.get(id); if (f) { this.pending.delete(id); f(value) }
    })
    ipcMain.on('ext:info', e => {
      if (!this.isHost(e) && !this.isTab(e)) { e.returnValue = null; return }
      e.returnValue = {
        id: BSK_ID, base: 'manul://bsk/ext/', manifest: this.manifest,
        platform: { os: process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux', arch: process.arch === 'arm64' ? 'arm64' : 'x86-64' },
        scripts: (this.manifest.content_scripts || []).map((cs: Any) => ({ ...cs, code: cs.js.map((f: string) => readFileSync(join(this.o.extDir, f), 'utf8')) })),
      }
    })
    ipcMain.handle('ext:cs-message', async (e, msg) => (this.isTab(e) ? this.hostCall('ext:message', msg, this.senderOf(e)) : undefined))
    ipcMain.on('ext:port-open', (e, portId: string, name: string) => {
      if (!this.isTab(e)) return
      this.ports.set(portId, { frame: e.senderFrame })
      this.host?.webContents.send('ext:port-open', portId, name, this.senderOf(e))
    })
    ipcMain.on('ext:port-msg', (e, portId: string, msg: unknown) => {
      const p = this.ports.get(portId); if (!p) return
      if (this.isHost(e)) { try { p.frame?.send('ext:port-msg', portId, msg) } catch { /* frame gone */ } }
      else if (this.isTab(e)) this.host?.webContents.send('ext:port-msg', portId, msg)
    })
    ipcMain.on('ext:port-close', (e, portId: string) => {
      const p = this.ports.get(portId); if (!p) return
      this.ports.delete(portId)
      if (this.isHost(e)) { try { p.frame?.send('ext:port-close', portId) } catch { /* frame gone */ } }
      else if (this.isTab(e)) this.host?.webContents.send('ext:port-close', portId)
    })
    ipcMain.on('ext:bsk-status', (e, s: { connected: boolean; status: string }) => { if (this.isHost(e)) { this.bsk = s; this.push() } })
  }

  // every chrome.* call from the host page (and storage calls from content scripts)
  async api(name: string, args: Any[]): Promise<Any> {
    const [a, b, c] = args
    const tab = (id: number) => { const t = this.tabs.get(id); if (!t) throw new Error(`No tab with id: ${id}.`); return t }
    switch (name) {
      // tabs
      case 'tabs.get': return this.tabObj(tab(a))
      case 'tabs.query': return queryTabs([...this.tabs.values()].map(t => this.tabObj(t)), a || {}, this.focusedWindow)
      case 'tabs.create': return this.tabObj(this.createTab({ url: a?.url, windowId: a?.windowId ?? this.focusedWindow, active: a?.active !== false, opener: a?.openerTabId }))
      case 'tabs.update': {
        const t = typeof a === 'number' ? tab(a) : tab(this.shown!), p = typeof a === 'number' ? b : a
        if (p?.url) t.view.webContents.loadURL(p.url).catch(() => {})
        if (p?.active || p?.highlighted) this.activate(t.id)
        if (p?.muted != null) t.view.webContents.setAudioMuted(p.muted)
        return this.tabObj(t)
      }
      case 'tabs.remove': for (const id of ([] as number[]).concat(a)) this.closeTab(id); return undefined
      case 'tabs.reload': (typeof a === 'number' ? tab(a) : tab(this.shown!)).view.webContents.reload(); return undefined
      case 'tabs.goBack': tab(a ?? this.shown).view.webContents.navigationHistory.goBack(); return undefined
      case 'tabs.goForward': tab(a ?? this.shown).view.webContents.navigationHistory.goForward(); return undefined
      case 'tabs.move': {
        for (const id of ([] as number[]).concat(a)) {
          const t = tab(id)
          if (b?.windowId != null && b.windowId !== t.windowId && this.windows.has(b.windowId)) {
            const old = t.windowId; t.windowId = b.windowId
            this.event('tabs.onDetached', id, { oldWindowId: old, oldPosition: 0 })
            this.event('tabs.onAttached', id, { newWindowId: b.windowId, newPosition: 0 })
            t.agent = this.windows.get(b.windowId)!.agent
          }
        }
        this.push()
        return ([] as number[]).concat(a).map(id => this.tabObj(tab(id)))
      }
      case 'tabs.sendMessage': {
        const frame = this.frameById(tab(a), c?.frameId || 0)
        if (!frame) throw new Error('Could not establish connection. Receiving end does not exist.')
        return this.frameCall(frame, 'ext:message', b, { id: BSK_ID })
      }
      case 'tabs.captureVisibleTab': {
        const wid = typeof a === 'number' ? a : this.focusedWindow, opts = (typeof a === 'object' && a) || b || {}
        const w = this.windows.get(wid) || this.windows.get(1)!
        const t = tab((w.activeTab ?? this.shown)!)
        const img = await t.view.webContents.capturePage(undefined, { stayHidden: true })
        return opts.format === 'jpeg' ? `data:image/jpeg;base64,${img.toJPEG(opts.quality ?? 90).toString('base64')}` : img.toDataURL()
      }
      // windows
      case 'windows.get': { const w = this.windows.get(a); if (!w) throw new Error(`No window with id: ${a}.`); return this.winObj(w, b?.populate) }
      case 'windows.getAll': return [...this.windows.values()].map(w => this.winObj(w, a?.populate))
      case 'windows.getLastFocused': case 'windows.getCurrent': return this.winObj(this.windows.get(this.focusedWindow) || this.windows.get(1)!, a?.populate)
      case 'windows.create': {
        // bsk's Agent Window: its tabs are the agent's (amber in the panel)
        const w: Win = { id: this.nextWin++, type: a?.type === 'popup' ? 'popup' : 'normal', activeTab: null, agent: true }
        this.windows.set(w.id, w)
        this.event('windows.onCreated', this.winObj(w))
        for (const u of ([] as string[]).concat(a?.url || 'about:blank')) this.createTab({ url: u, windowId: w.id, active: true, agent: true })
        if (a?.tabId) await this.api('tabs.move', [a.tabId, { windowId: w.id, index: -1 }])
        if (a?.focused !== false) this.reveal(w.id)
        return this.winObj(w, true)
      }
      case 'windows.update': { const w = this.windows.get(a); if (!w) throw new Error(`No window with id: ${a}.`); if (b?.focused || b?.drawAttention) this.reveal(a); return this.winObj(w) }
      case 'windows.remove': {
        for (const t of [...this.tabs.values()].filter(t => t.windowId === a)) this.closeTab(t.id)
        if (a !== 1 && this.windows.delete(a)) this.event('windows.onRemoved', a)
        return undefined
      }
      // debugger: Chrome's CDP bridge, on Electron's webContents.debugger
      case 'debugger.attach': { const t = tab(a.tabId); this.extAttached.add(t.id); if (!t.view.webContents.debugger.isAttached()) t.view.webContents.debugger.attach(b || '1.3'); return undefined }
      // a take keeps filming through it: the extension sees a detach, the debugger stays on until the take ends
      case 'debugger.detach': { const t = tab(a.tabId); this.extAttached.delete(t.id); if (!this.filming.has(t.id) && t.view.webContents.debugger.isAttached()) t.view.webContents.debugger.detach(); return undefined }
      case 'debugger.sendCommand': return tab(a.tabId).view.webContents.debugger.sendCommand(b, c || {}, a.sessionId)
      case 'debugger.getTargets': return [...this.tabs.values()].map(t => ({ id: String(t.id), tabId: t.id, type: 'page', url: t.view.webContents.getURL(), title: t.view.webContents.getTitle(), attached: t.view.webContents.debugger.isAttached() }))
      // scripting
      case 'scripting.executeScript': {
        const t = tab(a.target.tabId)
        const frames = a.target.allFrames ? t.view.webContents.mainFrame.framesInSubtree : ((a.target.frameIds || [0]) as number[]).map(id => this.frameById(t, id)).filter((f): f is WebFrameMain => !!f)
        const code = a.func ? `(${a.func})(...${JSON.stringify(a.args || [])})` : ((a.files || []) as string[]).map(f => readFileSync(join(this.o.extDir, f), 'utf8')).join('\n;\n')
        const out = []
        for (const f of frames) {
          try { out.push({ frameId: this.frameIdOf(f), result: a.world === 'MAIN' ? await f.executeJavaScript(code, true) : await this.frameCall(f, 'ext:exec', code) }) }
          catch (err) { out.push({ frameId: this.frameIdOf(f), error: String((err as Error)?.message || err) }) }
        }
        return out
      }
      // webNavigation
      case 'webNavigation.getFrame': {
        const t = this.tabs.get(a.tabId); if (!t) return null
        const f = this.frameById(t, a.frameId); if (!f) return null
        return { url: f.url, parentFrameId: f.parent ? this.frameIdOf(f.parent) : -1, errorOccurred: false, frameId: this.frameIdOf(f) }
      }
      case 'webNavigation.getAllFrames': {
        const t = this.tabs.get(a.tabId); if (!t) return null
        return t.view.webContents.mainFrame.framesInSubtree.map(f => ({ url: f.url, frameId: this.frameIdOf(f), parentFrameId: f.parent ? this.frameIdOf(f.parent) : -1, processId: f.osProcessId, errorOccurred: false }))
      }
      // storage
      case 'storage.get': return this.area(a).get(b ?? null)
      case 'storage.set': this.area(a).set(b); return undefined
      case 'storage.remove': this.area(a).remove(b); return undefined
      case 'storage.clear': this.area(a).remove(Object.keys(this.area(a).data)); return undefined
      // downloads
      case 'downloads.download': return this.download(a)
      case 'downloads.search': return [...this.downloads.values()].filter(d => (a?.id == null || d.id === a.id) && (a?.state == null || d.state === a.state)).map(d => this.dlObj(d))
      case 'downloads.cancel': this.downloads.get(a)?.item?.cancel(); return undefined
      case 'downloads.removeFile': { const d = this.downloads.get(a); if (d?.path && existsSync(d.path)) unlinkSync(d.path); return undefined }
      case 'downloads.erase': for (const d of [...this.downloads.values()]) if (a?.id == null || d.id === a.id) this.downloads.delete(d.id); return []
      // notifications
      case 'notifications.create': {
        const id = typeof a === 'string' ? a : `n${Date.now()}`, o = typeof a === 'string' ? b : a
        if (Notification.isSupported()) { const n = new Notification({ title: o?.title || 'Manul browser', body: o?.message || '' }); n.on('click', () => this.event('notifications.onClicked', id)); n.show() }
        return id
      }
      case 'notifications.clear': return true
      default: throw new Error(`chrome.${name} is not available in Manul's browser`)
    }
  }

  private area(n: string) {
    if (n === 'session') return this.session
    return this.local // local, and sync (kept on this machine)
  }

  // ---------------------------------------------------------------- filming a tab (product walkthroughs)
  /** The tab whose page carries the take's mark (set by the agent's bsk session), as CDP for the take. Brings the
   *  Browser panel up so the user watches it record. */
  async film(nonce: string): Promise<{ tabId: number; cdp: Cdp }> {
    let t: Tab | undefined
    for (const x of this.tabs.values()) {
      const v = await x.view.webContents.executeJavaScript(matchExpression, true).catch(() => null)
      if (v === nonce) { t = x; break }
    }
    if (!t) throw new Error('Manul could not find the walkthrough\'s tab in its browser. Keep the bsk session\'s tab open and try again.')
    if (this.filming.has(t.id)) throw new Error('That tab is already being recorded.')
    const wc = t.view.webContents
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    const f: Filming = { listeners: new Set(), closers: [] }
    this.filming.set(t.id, f)
    if (t.id !== this.shown || !this.bounds) this.hide(t) // painting from the first frame, before the panel opens
    this.reveal(t.windowId)
    this.push()
    const id = t.id
    return {
      tabId: id,
      cdp: {
        send: (method, params) => wc.debugger.sendCommand(method, params || {}),
        on: fn => { f.listeners.add(fn); return () => { f.listeners.delete(fn) } },
        onClose: fn => { f.closers.push(fn) },
        close: async () => {
          if (this.filming.get(id) !== f) return
          this.filming.delete(id)
          this.push()
          const tab = this.tabs.get(id)
          if (!tab) return
          if (tab.id !== this.shown || !this.bounds) tab.view.setVisible(false)
          if (!this.extAttached.has(id) && wc.debugger.isAttached()) { try { wc.debugger.detach() } catch { /* gone */ } }
        },
      },
    }
  }

  private endFilming(id: number, why: string) {
    const f = this.filming.get(id)
    if (!f) return
    this.filming.delete(id)
    this.push()
    for (const c of f.closers) { try { c(why) } catch { /* */ } }
  }

  reveal(windowId: number) {
    const w = this.windows.get(windowId)
    const id = w?.activeTab ?? [...this.tabs.values()].find(t => t.windowId === windowId)?.id
    if (id) this.activate(id)
    this.o.send('browser:reveal', windowId)
  }

  // ---------------------------------------------------------------- the panel's own controls (the user browsing)
  navigate(url: string) {
    const u = /^[a-z]+:/i.test(url) ? url : /^[^\s]+\.[^\s]+$/.test(url) ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`
    const t = this.shown ? this.tabs.get(this.shown) : null
    if (t) t.view.webContents.loadURL(u).catch(() => {})
    else this.createTab({ url: u })
  }
  back() { const t = this.shown && this.tabs.get(this.shown); if (t) t.view.webContents.navigationHistory.goBack() }
  forward() { const t = this.shown && this.tabs.get(this.shown); if (t) t.view.webContents.navigationHistory.goForward() }
  reload() { const t = this.shown && this.tabs.get(this.shown); if (t) t.view.webContents.reload() }

  // ---------------------------------------------------------------- storage persistence
  private get storeFile() { return join(this.o.dataDir, 'extension-storage.json') }
  private saveStore() { clearTimeout(this.saveT); this.saveT = setTimeout(() => writeFileSync(this.storeFile, JSON.stringify(this.local.data)), 200) }

  // ---------------------------------------------------------------- downloads
  private downloadsSetup() {
    this.ses.on('will-download', (_e, item) => {
      const want = this.wantDl.shift()
      const id = want?.id ?? this.nextDl++
      const root = app.getPath('downloads')
      const path = resolve(root, want?.filename || item.getFilename())
      try {
        if (!isWithinDir(root, path)) throw new Error('Download filename must stay inside Downloads.')
        mkdirSync(dirname(path), { recursive: true })
        item.setSavePath(path)
      } catch (e) {
        item.cancel()
        console.warn('download destination', e)
        this.o.send('notice', `The download could not be saved: ${(e as Error).message}`)
        return
      }
      const d: Any = { id, item, path, url: item.getURL(), state: 'in_progress', mime: item.getMimeType() }
      this.downloads.set(id, d)
      this.event('downloads.onCreated', this.dlObj(d))
      item.on('updated', () => this.event('downloads.onChanged', { id, bytesReceived: { current: item.getReceivedBytes() } }))
      item.once('done', (_x, state) => {
        const prev = d.state; d.state = state === 'completed' ? 'complete' : 'interrupted'
        this.event('downloads.onChanged', { id, state: { previous: prev, current: d.state }, filename: { current: path } })
      })
    })
  }
  private dlObj(d: Any) {
    const it = d.item
    return { id: d.id, url: d.url, finalUrl: d.url, filename: d.path, state: d.state, mime: d.mime, bytesReceived: it?.getReceivedBytes() ?? 0,
      totalBytes: it?.getTotalBytes() ?? 0, fileSize: it?.getTotalBytes() ?? 0, exists: existsSync(d.path), paused: it?.isPaused() ?? false, danger: 'safe', incognito: false }
  }
  private download(o: { url: string; filename?: string }) {
    const id = this.nextDl++
    this.wantDl.push({ id, filename: o.filename })
    this.ses.downloadURL(o.url)
    return id
  }

  destroy() {
    clearTimeout(this.saveT)
    try { writeFileSync(this.storeFile, JSON.stringify(this.local.data)) } catch (e) { console.warn('browser storage', e) }
    for (const t of [...this.tabs.values()]) { try { t.view.webContents.close() } catch { /* gone */ } }
    this.tabs.clear()
    if (this.host && !this.host.isDestroyed()) this.host.destroy()
  }
}
