// window.agentshot for AgentShot's film panel inside a chat: the calls the panel makes to the app (as preload/index.ts
// has them in the window) go to the MCP server's editor_call tool, which runs the app's own handlers. What only makes
// sense in the app window (cloud jobs, signing in, the jobs tray) says so, or stays empty.
import type { Project } from '../shared/types'
import type { PreviewState } from '../shared/proxy'

export type Call = (method: string, args: unknown[]) => Promise<unknown>
type Fn = (...a: any[]) => any

const IN_APP = 'Do this in the AgentShot app.'
const noop = () => () => {}
const bytesToBase64 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return btoa(s)
}
/** JSON has no undefined: the app's optional arguments at the end are left out, not sent as null. */
const trim = (args: unknown[]) => { const a = [...args]; while (a.length && a[a.length - 1] === undefined) a.pop(); return a }

export function makeBridge(call: Call, projects: { onChange(fn: (p: Project) => void): () => void; changed(): void }) {
  const run = (method: string) => (...args: unknown[]) => call(method, trim(args))
  /** a call that changes the project: look again at once, so the panel and anything else showing it agree */
  const changes = (method: string) => async (...args: unknown[]) => { const r = await call(method, trim(args)); projects.changed(); return r }

  // preview copies are made in the background; the app tells the window when one is ready, here we ask again
  const previewListeners = new Set<(dir: string, media: string, s: PreviewState) => void>()
  const followPreview = (dir: string, media: string, s: PreviewState) => {
    if (s.status !== 'running') return
    setTimeout(async () => {
      try {
        const next = await call('preview:prepare', [dir, media]) as PreviewState
        previewListeners.forEach(fn => fn(dir, media, next))
        followPreview(dir, media, next)
      } catch { /* the panel keeps the last state */ }
    }, 1500)
  }

  const api = {
    thumbnails: run('media:thumbnails'),
    preview: {
      prepare: async (dir: string, media: string) => { const s = await call('preview:prepare', [dir, media]) as PreviewState; followPreview(dir, media, s); return s },
      onState: (fn: Fn) => { previewListeners.add(fn); return () => { previewListeners.delete(fn) } },
    },
    timeline: { edit: changes('timeline:edit'), undo: (dir: string, redo = false) => changes('timeline:undo')(dir, redo), render: changes('timeline:render') },
    project: {
      decide: changes('project:decide'), setCurrent: changes('project:current'), removeFiles: changes('project:removeFiles'),
      reveal: run('project:reveal'), revealFile: run('project:revealFile'), downloadFile: run('project:downloadFile'),
      onChange: (fn: (p: Project) => void) => projects.onChange(fn),
      import: () => Promise.reject(new Error('Attach files in the chat, or add them in the AgentShot app.')),
      pickFiles: () => Promise.resolve([]),
    },
    history: { log: run('history:log'), restore: changes('history:restore') },
    mix: { speech: run('mix:speech') },
    export: { run: run('export:run'), editors: run('export:editors'), reveal: run('export:reveal') },
    tools: { list: run('tools:list'), install: run('tools:install') },
    clips: { move: changes('clip:move') },
    voiceover: {
      access: run('voiceover:access'), begin: run('voiceover:begin'), cancel: run('voiceover:cancel'),
      save: async (token: string, audio: Uint8Array, peaks: number[]) => { const r = await call('voiceover:save', [token, bytesToBase64(audio), peaks]); projects.changed(); return r },
    },
    account: {
      status: run('account:status'),
      signIn: () => Promise.reject(new Error(`Sign in from the AgentShot app. ${IN_APP}`)),
      checkout: () => Promise.reject(new Error(`Choose a plan in the AgentShot app. ${IN_APP}`)),
    },
    cloud: { offers: async () => ({ signedIn: false, offers: [] }), run: () => Promise.reject(new Error(IN_APP)) },
    jobs: { list: async () => [], onChange: noop },
    theme: { set: () => {} },
    onSeek: noop,
    pathForFile: () => '',
  }
  // anything else the panel reaches for belongs to the app window: an event never comes, a call says so
  const missing = (path: string): any => new Proxy(function () {}, {
    get: (_t, k) => (typeof k === 'string' ? missing(`${path}.${k}`) : undefined),
    apply: () => (/\.on[A-Z]/.test(path) ? () => {} : Promise.reject(new Error(IN_APP))),
  })
  const wrap = (o: any, path: string): any => new Proxy(o, {
    get: (t, k) => (typeof k !== 'string' || k in t ? (t[k] && typeof t[k] === 'object' ? wrap(t[k], `${path}.${String(k)}`) : t[k]) : missing(`${path}.${String(k)}`)),
  })
  return wrap(api, 'agentshot')
}
