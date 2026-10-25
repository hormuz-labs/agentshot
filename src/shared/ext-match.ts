// Pure pieces of the Chrome extension API that AgentShot's browser rebuilds for BrowserSkill: match patterns, tab queries
// and storage areas. Used by src/main/browser.ts and the tab preload.

const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
const glob = (s: string) => esc(s).replace(/\*/g, '.*')

/** A Chrome match pattern (scheme://host/path, host "*" or "*.domain") or else a plain glob, as an anchored RegExp. */
export function globToRegExp(p: string): RegExp {
  const m = /^(\*|[a-z-]+):\/\/([^/]*)(\/.*)$/.exec(p)
  if (!m) return new RegExp(`^${glob(p)}$`)
  const [, scheme, host, path] = m
  const s = scheme === '*' ? 'https?' : esc(scheme)
  const h = host === '*' ? '[^/]*' : host.startsWith('*.') ? `(?:[^/]*\\.)?${esc(host.slice(2))}(?::\\d+)?` : `${esc(host)}(?::\\d+)?`
  return new RegExp(`^${s}://${h}${glob(path)}$`)
}

export function contentScriptMatches(cs: { matches?: string[]; match_about_blank?: boolean }, url: string): boolean {
  if (url === 'about:blank') return !!cs.match_about_blank
  return (cs.matches || []).some(m => (m === '<all_urls>' ? /^(https?|file|ftp|wss?):/.test(url) : globToRegExp(m).test(url)))
}

export type TabLike = { id: number; windowId: number; active: boolean; url: string; title: string; status: string }

/** chrome.tabs.query over plain tab objects; `focused` is the last-focused window (also WINDOW_ID_CURRENT, -2). */
export function queryTabs<T extends TabLike>(tabs: T[], q: { active?: boolean; currentWindow?: boolean; lastFocusedWindow?: boolean; windowId?: number; status?: string; title?: string; url?: string | string[] }, focused: number): T[] {
  const urls = q.url ? ([] as string[]).concat(q.url).map(globToRegExp) : null
  return tabs.filter(t => {
    if (q.active != null && t.active !== q.active) return false
    if ((q.currentWindow || q.lastFocusedWindow) && t.windowId !== focused) return false
    if (q.windowId != null && t.windowId !== (q.windowId === -2 ? focused : q.windowId)) return false
    if (q.status && t.status !== q.status) return false
    if (q.title && !globToRegExp(q.title).test(t.title)) return false
    if (urls && !urls.some(r => r.test(t.url))) return false
    return true
  })
}

type Changes = Record<string, { oldValue?: unknown; newValue?: unknown }>

/** One chrome.storage area. */
export class Store {
  constructor(public data: Record<string, unknown> = {}, private onChange: (c: Changes) => void = () => {}) {}

  get(keys: null | string | string[] | Record<string, unknown>) {
    const s = this.data
    if (keys == null) return { ...s }
    if (typeof keys === 'string') return keys in s ? { [keys]: s[keys] } : {}
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter(k => k in s).map(k => [k, s[k]]))
    return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in s ? s[k] : d]))
  }

  set(items: Record<string, unknown>) {
    const c: Changes = {}
    for (const [k, v] of Object.entries(items || {})) { c[k] = { oldValue: this.data[k], newValue: v }; this.data[k] = v }
    if (Object.keys(c).length) this.onChange(c)
  }

  remove(keys: string | string[]) {
    const c: Changes = {}
    for (const k of ([] as string[]).concat(keys)) if (k in this.data) { c[k] = { oldValue: this.data[k] }; delete this.data[k] }
    if (Object.keys(c).length) this.onChange(c)
  }
}
