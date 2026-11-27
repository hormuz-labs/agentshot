// The editor page Claude and ChatGPT show (an MCP App): AgentShot's own film panel (ChatEditor), talking to the MCP
// server through the chat (host.ts): the project from editor_view, the panel's calls through editor_call (bridge.ts),
// its files from the server's address or through editor_media (media.ts).
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { TooltipProvider } from '@/components/ui/tooltip'
import { setMediaResolver } from '@/lib/utils'
import { Host, type ToolResult } from './host'
import { makeBridge } from './bridge'
import { MediaSource } from './media'
import { ChatEditor, type Chat } from './ChatEditor'
import type { EditorView, StartView } from '../shared/editor-view'
import { StartScreen } from './StartScreen'
import { sendFile, type Sent } from './upload'
import type { Project } from '../shared/types'

const host = new Host(m => window.parent.postMessage(m, '*'))
window.addEventListener('message', e => { if (e.source === window.parent) host.receive(e.data) })

const textOf = (r: ToolResult) => r.content?.map(c => c.text || '').join('\n').trim()
let view: EditorView | undefined
/** no projects yet: the start screen */
let starting: StartView | undefined
const viewListeners = new Set<() => void>()
const projectListeners = new Set<(p: Project) => void>()
let shown = ''
function take(v: EditorView | StartView) {
  if ('start' in v) { starting = v; viewListeners.forEach(fn => fn()); return }
  starting = undefined
  view = v
  viewListeners.forEach(fn => fn())
  const now = JSON.stringify(v.project)
  if (now !== shown) { shown = now; projectListeners.forEach(fn => fn(v.project)) }
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const r = await host.callTool(name, { ...(view ? { project: view.folder } : {}), ...args })
  if (r.isError) throw new Error(textOf(r) || 'AgentShot couldn’t do that.')
  return r
}
let looking: Promise<void> | undefined
/** Look at the project again (after a change here, and every few seconds: the chat's agent edits it too). */
function refresh() {
  looking ??= tool('editor_view').then(r => { if (r.structuredContent) take(r.structuredContent as EditorView | StartView) }).catch(() => {}).finally(() => { looking = undefined })
  return looking
}

window.agentshot = makeBridge(async (method, args) => (await tool('editor_call', { method, args })).structuredContent?.value, {
  onChange: fn => { projectListeners.add(fn); return () => { projectListeners.delete(fn) } },
  changed: () => { void refresh() },
}) as typeof window.agentshot

const media = new MediaSource(
  () => ({ dir: view!.project.dir, base: view!.media }),
  async (rel, offset) => (await tool('editor_media', { src: rel, offset })).structuredContent as { mime: string; size: number; base64: string },
)
setMediaResolver(media.url)

function paint(ctx: Record<string, any>) {
  document.documentElement.classList.toggle('dark', ctx.theme !== 'light')
  document.body.dataset.mode = ctx.displayMode || 'inline'
}

/** A file the user chose, into their space (into the open project, or as a new one); the model hears of it. */
async function send(file: File, progress: (done: number) => void, into = view?.folder): Promise<Sent> {
  const sent = await sendFile((name, args) => host.callTool(name, args || {}).then(r => { if (r.isError) throw new Error(textOf(r) || 'AgentShot couldn’t take the file.'); return r }), file, into, progress)
  void host.request('ui/update-model-context', { content: [{ type: 'text', text: into ? `In the AgentShot editor the user added ${file.name} to project "${sent.folder}".` : `In the AgentShot editor the user brought in ${file.name}: it is the new project "${sent.folder}".` }] }).catch(() => {})
  return sent
}

const chat = (ctx: Record<string, any>): Chat => ({
  ...(view?.upload ? { upload: (file: File, progress: (done: number) => void) => send(file, progress) } : {}),
  async say(text, still) {
    const words = { type: 'text', text }
    const picture = still?.startsWith('data:') ? { type: 'image', mimeType: still.slice(5, still.indexOf(';')), data: still.slice(still.indexOf(',') + 1) } : undefined
    try { await host.request('ui/message', { role: 'user', content: picture ? [words, picture] : [words] }) }
    catch (e) { if (!picture) throw e; await host.request('ui/message', { role: 'user', content: [words] }) } // a chat that takes no pictures
  },
  note(text) { void host.request('ui/update-model-context', { content: [{ type: 'text', text }] }).catch(() => {}) },
  ...((ctx.availableDisplayModes || []).includes('fullscreen') ? {
    fullscreen: {
      on: ctx.displayMode === 'fullscreen',
      toggle: () => { void host.request('ui/request-display-mode', { mode: ctx.displayMode === 'fullscreen' ? 'inline' : 'fullscreen' }).then(r => { host.context.displayMode = r?.mode; contextChanged() }).catch(() => {}) },
    },
  } : {}),
})
const contextListeners = new Set<() => void>()
const contextChanged = () => { paint(host.context); contextListeners.forEach(fn => fn()) }

function App() {
  const [v, setV] = useState(view)
  const [ready, setReady] = useState(false)
  const [, setCtx] = useState(0)
  const [mediaVersion, setMediaVersion] = useState(0)
  const [problem, setProblem] = useState('')
  const [start, setStart] = useState(starting)
  useEffect(() => { const fn = () => { setV(view); setStart(starting) }; viewListeners.add(fn); return () => { viewListeners.delete(fn) } }, [])
  useEffect(() => { const fn = () => setCtx(n => n + 1); contextListeners.add(fn); return () => { contextListeners.delete(fn) } }, [])
  useEffect(() => media.onChange(() => setMediaVersion(n => n + 1)), [])
  useEffect(() => {
    const fail = (r: ToolResult) => { if (r.isError) setProblem(textOf(r) || 'AgentShot couldn’t open the editor.') }
    host.on('ui/notifications/tool-result', fail)
  }, [])
  // first sight of the project: does this chat play from the server's address, or do the files come through MCP?
  useEffect(() => {
    if (!v || ready) return
    const cur = v.project.versions.find(x => x.id === v.project.current)
    const rel = cur ? v.project.proxies?.[cur.dry || cur.path] || cur.dry || cur.path : undefined
    void (async () => { if (!rel || !(await media.probe(rel))) media.refuse(); setReady(true) })()
  }, [v, ready])
  if (start) return <div className="p-3"><StartScreen send={(file, progress, into) => send(file, progress, into)} onDone={async sent => { const r = await tool('editor_view', { project: sent.folder }); if (r.structuredContent) take(r.structuredContent as EditorView) }} /></div>
  if (problem && !v) return <p className="p-6 text-sm text-dim">{problem}</p>
  if (!v || !ready) return <p className="flex h-40 items-center justify-center text-sm text-dim">Opening AgentShot…</p>
  return <ChatEditor initial={v.project} folder={v.folder} chat={chat(host.context)} mediaVersion={mediaVersion} />
}

host.on('ui/notifications/tool-result', (r: ToolResult) => {
  if (r.isError || !r.structuredContent) return
  const v = r.structuredContent as EditorView | StartView
  take(v)
  // just opened (not an old card drawn again): beside the chat, where the chat can put it
  const ctx = host.context
  if (v.openedAt && Date.now() - v.openedAt < 30_000 && ctx.displayMode !== 'fullscreen' && (ctx.availableDisplayModes || []).includes('fullscreen')) {
    void host.request('ui/request-display-mode', { mode: 'fullscreen' }).then(m => { host.context.displayMode = m?.mode; contextChanged() }).catch(() => {})
  }
})
host.on('ui/notifications/host-context-changed', contextChanged)
// inline, the chat sizes its frame to the page
new ResizeObserver(() => { if (document.body.dataset.mode !== 'fullscreen') host.notify('ui/notifications/size-changed', { height: Math.ceil(document.documentElement.scrollHeight) }) }).observe(document.body)
setInterval(() => { if (view && document.visibilityState === 'visible') void refresh() }, 2500)

createRoot(document.getElementById('root')!).render(<StrictMode><TooltipProvider><App /></TooltipProvider></StrictMode>)
void host.connect({ name: 'AgentShot editor', version: '2' }, { availableDisplayModes: ['inline', 'fullscreen'] }).then(() => {
  contextChanged()
  // shown some other way than with open_editor's result (the chat reloaded it): ask for the project
  setTimeout(() => { if (!view) void refresh() }, 1500)
})
