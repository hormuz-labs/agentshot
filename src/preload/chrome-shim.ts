// The `chrome` extension API, rebuilt on Electron IPC so BrowserSkill runs unmodified inside AgentShot's browser. The
// background script (role "host", in a hidden page) and the content scripts (role "content", in each tab's isolated
// world) both get one of these. Calls go to src/main/browser.ts; events come back on "ext:event". Callback and promise
// styles both work, as in Chrome.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IpcRenderer } from 'electron'

type Any = any

export class Ev {
  l = new Set<(...a: Any[]) => Any>()
  addListener(f: (...a: Any[]) => Any) { this.l.add(f) }
  removeListener(f: (...a: Any[]) => Any) { this.l.delete(f) }
  hasListener(f: (...a: Any[]) => Any) { return this.l.has(f) }
  hasListeners() { return this.l.size > 0 }
  emit(...a: Any[]) { for (const f of [...this.l]) { try { f(...a) } catch (e) { console.error('[chrome shim] listener', e) } } }
}

export type ExtInfo = { id: string; base: string; manifest: Any; scripts: Any[]; platform: { os: string; arch: string } }

export function makeChrome({ ipcRenderer, role, info }: { ipcRenderer: IpcRenderer; role: 'host' | 'content'; info: ExtInfo }) {
  const chrome: Any = {}
  const call = (name: string, ...args: Any[]) => ipcRenderer.invoke('ext:call', name, args).then((r: Any) => {
    if (r && typeof r === 'object' && '__error' in r) throw new Error(r.__error)
    return r
  })
  // chrome-style: a trailing callback gets the value and chrome.runtime.lastError; otherwise a promise
  const wrap = (fn: (...a: Any[]) => Any) => (...args: Any[]) => {
    const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null
    const p = Promise.resolve().then(() => fn(...args))
    if (!cb) return p
    p.then(v => { try { cb(v) } catch (e) { console.error(e) } }, e => {
      chrome.runtime.lastError = { message: e.message }
      try { cb() } catch (x) { console.error(x) } finally { chrome.runtime.lastError = undefined }
    })
    return undefined
  }
  const api = (name: string) => wrap((...a) => call(name, ...a))
  const events: Record<string, Ev> = {}
  const ev = (name: string) => (events[name] ||= new Ev())

  // ---------------------------------------------------------------- runtime + messaging
  const portsById = new Map<string, Any>()
  const makePort = (id: string, name: string, sender: Any) => {
    const port = { name, sender, onMessage: new Ev(), onDisconnect: new Ev(),
      postMessage: (msg: Any) => ipcRenderer.send('ext:port-msg', id, msg),
      disconnect: () => { portsById.delete(id); ipcRenderer.send('ext:port-close', id) } }
    portsById.set(id, port)
    return port
  }
  ipcRenderer.on('ext:port-msg', (_, id, msg) => portsById.get(id)?.onMessage.emit(msg, portsById.get(id)))
  ipcRenderer.on('ext:port-close', (_, id) => { const p = portsById.get(id); if (p) { portsById.delete(id); p.onDisconnect.emit(p) } })
  ipcRenderer.on('ext:port-open', (_, id, name, sender) => ev('runtime.onConnect').emit(makePort(id, name, sender)))

  // a message arrives (host: from a content script; content: from the background): run onMessage like Chrome does
  ipcRenderer.on('ext:message', (_, reqId, msg, sender) => {
    const ls = [...ev('runtime.onMessage').l]
    if (!ls.length) { ipcRenderer.send('ext:reply', reqId, role === 'content' ? { __noReceiver: true } : undefined); return }
    let done = false, waiting = false
    const respond = (v: Any) => { if (!done) { done = true; ipcRenderer.send('ext:reply', reqId, v) } }
    for (const f of ls) {
      let r: Any
      try { r = f(msg, sender, respond) } catch (e) { console.error(e); continue }
      if (r === true) waiting = true
      else if (r && typeof r.then === 'function') { waiting = true; r.then(respond, () => respond(undefined)) }
    }
    if (!waiting) setTimeout(() => respond(undefined), 0)
  })

  chrome.runtime = {
    id: info.id,
    lastError: undefined,
    getURL: (p: string) => info.base + String(p).replace(/^\//, ''),
    getManifest: () => info.manifest,
    getPlatformInfo: wrap(() => ({ os: info.platform.os, arch: info.platform.arch, nacl_arch: info.platform.arch === 'arm64' ? 'arm' : 'x86-64' })),
    onMessage: ev('runtime.onMessage'), onConnect: ev('runtime.onConnect'), onStartup: ev('runtime.onStartup'),
    onInstalled: ev('runtime.onInstalled'), onSuspend: ev('runtime.onSuspend'), onMessageExternal: ev('runtime.onMessageExternal'),
    sendMessage: wrap((...a) => {
      const msg = typeof a[0] === 'string' ? a[1] : a[0]
      return role === 'content' ? ipcRenderer.invoke('ext:cs-message', msg) : undefined // the background has no other pages to talk to
    }),
    connect: (...a: Any[]) => {
      const o = typeof a[0] === 'string' ? a[1] : a[0]
      const id = `p${Math.random().toString(36).slice(2)}${Date.now()}`
      const port = makePort(id, o?.name || '', undefined)
      ipcRenderer.send('ext:port-open', id, o?.name || '')
      return port
    },
    reload: () => location.reload(),
    getContexts: wrap(() => []),
  }
  chrome.i18n = { getUILanguage: () => navigator.language || 'en', getMessage: () => '', getAcceptLanguages: wrap(() => [navigator.language || 'en']) }

  // ---------------------------------------------------------------- storage
  const area = (n: string) => ({
    get: wrap(keys => call('storage.get', n, keys ?? null)),
    set: wrap(items => call('storage.set', n, items)),
    remove: wrap(keys => call('storage.remove', n, keys)),
    clear: wrap(() => call('storage.clear', n)),
    getBytesInUse: wrap(() => 0),
    setAccessLevel: wrap(() => undefined),
    onChanged: new Ev(),
  })
  chrome.storage = { local: area('local'), session: area('session'), sync: area('local'), onChanged: ev('storage.onChanged') }
  ev('storage.onChanged').l.add((changes: Any, n: string) => chrome.storage[n]?.onChanged.emit(changes))

  if (role === 'content') return { chrome, events }

  // ---------------------------------------------------------------- background-only APIs
  const ns = (name: string, methods: string[], evs: string[] = []) => {
    const o: Any = {}
    for (const m of methods) o[m] = api(`${name}.${m}`)
    for (const e of evs) o[e] = ev(`${name}.${e}`)
    return o
  }
  chrome.tabs = ns('tabs', ['get', 'query', 'create', 'update', 'remove', 'reload', 'goBack', 'goForward', 'move', 'sendMessage', 'captureVisibleTab'],
    ['onCreated', 'onUpdated', 'onRemoved', 'onActivated', 'onAttached', 'onDetached', 'onMoved', 'onReplaced', 'onHighlighted'])
  chrome.tabs.TAB_ID_NONE = -1
  chrome.tabs.getCurrent = wrap(() => undefined)
  chrome.windows = ns('windows', ['get', 'getAll', 'getLastFocused', 'getCurrent', 'create', 'update', 'remove'], ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged'])
  chrome.windows.WINDOW_ID_NONE = -1; chrome.windows.WINDOW_ID_CURRENT = -2
  chrome.debugger = ns('debugger', ['attach', 'detach', 'sendCommand', 'getTargets'], ['onEvent', 'onDetach'])
  chrome.scripting = {
    executeScript: wrap(inj => call('scripting.executeScript', { ...inj, func: inj.func ? String(inj.func) : undefined })),
    insertCSS: wrap(() => undefined), removeCSS: wrap(() => undefined),
    registerContentScripts: wrap(() => undefined), getRegisteredContentScripts: wrap(() => []), unregisterContentScripts: wrap(() => undefined),
  }
  chrome.webNavigation = ns('webNavigation', ['getFrame', 'getAllFrames'],
    ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onCreatedNavigationTarget', 'onReferenceFragmentUpdated', 'onHistoryStateUpdated', 'onTabReplaced'])
  chrome.downloads = ns('downloads', ['download', 'search', 'cancel', 'removeFile', 'erase', 'pause', 'resume', 'open', 'show'], ['onCreated', 'onChanged', 'onErased', 'onDeterminingFilename'])
  chrome.notifications = ns('notifications', ['create', 'clear', 'update', 'getAll'], ['onClicked', 'onButtonClicked', 'onClosed'])
  chrome.action = { setBadgeText: wrap(() => undefined), setBadgeBackgroundColor: wrap(() => undefined), setIcon: wrap(() => undefined),
    setTitle: wrap(() => undefined), setPopup: wrap(() => undefined), openPopup: wrap(() => undefined), onClicked: new Ev() }
  chrome.permissions = { contains: wrap(() => true), request: wrap(() => true), getAll: wrap(() => ({ permissions: info.manifest?.permissions || [], origins: ['<all_urls>'] })), onAdded: new Ev(), onRemoved: new Ev() }
  chrome.idle = { setDetectionInterval: () => {}, queryState: wrap(() => 'active'), onStateChanged: new Ev() }
  chrome.contextMenus = { create: () => {}, removeAll: wrap(() => undefined), onClicked: new Ev() }
  chrome.offscreen = { createDocument: wrap(() => undefined), closeDocument: wrap(() => undefined), hasDocument: wrap(() => false) }

  // alarms: plain timers in this page
  const alarms = new Map<string, Any>()
  const pub = (r: Any) => ({ name: r.name, scheduledTime: r.scheduledTime, periodInMinutes: r.periodInMinutes })
  chrome.alarms = {
    onAlarm: new Ev(),
    create: wrap((...a) => {
      const name = typeof a[0] === 'string' ? a[0] : '', o = typeof a[0] === 'string' ? a[1] : a[0]
      clearTimeout(alarms.get(name)?.t); clearInterval(alarms.get(name)?.i)
      const first = o.when ? Math.max(0, o.when - Date.now()) : (o.delayInMinutes ?? o.periodInMinutes ?? 0) * 60000
      const rec: Any = { name, scheduledTime: Date.now() + first, periodInMinutes: o.periodInMinutes }
      rec.t = setTimeout(() => {
        chrome.alarms.onAlarm.emit(pub(rec))
        if (o.periodInMinutes) rec.i = setInterval(() => chrome.alarms.onAlarm.emit({ name, scheduledTime: Date.now(), periodInMinutes: o.periodInMinutes }), o.periodInMinutes * 60000)
        else alarms.delete(name)
      }, first)
      alarms.set(name, rec)
    }),
    get: wrap(name => { const r = alarms.get(name || ''); return r ? pub(r) : undefined }),
    getAll: wrap(() => [...alarms.values()].map(pub)),
    clear: wrap(name => { const r = alarms.get(name || ''); if (!r) return false; clearTimeout(r.t); clearInterval(r.i); alarms.delete(name || ''); return true }),
    clearAll: wrap(() => { for (const r of alarms.values()) { clearTimeout(r.t); clearInterval(r.i) } alarms.clear(); return true }),
  }

  ipcRenderer.on('ext:event', (_, name, args) => ev(name).emit(...args))
  return { chrome, events }
}
