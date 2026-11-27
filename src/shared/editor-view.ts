// AgentShot's film panel inside Claude and ChatGPT (src/mcp-app): the same React panel as the app's, given the project
// as the app has it and where its files play from. The same wherever the tools run: AgentShot on this computer gives
// its own media address (src/main/mcp.ts); a hosted server in front of a cloud worker swaps `media` for its own.
import type { Project } from './types'

/** The editor page's address, as tools name it. */
export const EDITOR_URI = 'ui://agentshot/editor.html'
/** What an MCP App page is served as. */
export const APP_MIME = 'text/html;profile=mcp-app'

export type EditorView = {
  /** the project's folder name: what the tools take as `project` */
  folder: string
  /** where the files are: a project-relative path appended to it is a playable address */
  media: string
  /** the film changed since the current version was rendered */
  edited: boolean
  project: Project
  /** when open_editor opened it (ms): only a page opened just now asks to go beside the chat */
  openedAt?: number
  /** the page may send files in (upload_start): AgentShot in the cloud */
  upload?: boolean
}
/** No projects yet (AgentShot in the cloud): the editor opens on a start screen, to bring a video in. */
export type StartView = { start: true; upload: true; openedAt?: number }

export const editorView = (project: Project, o: { base: string; folder: string; edited: boolean }): EditorView =>
  ({ folder: o.folder, media: o.base, edited: o.edited, project })

/** The calls the film panel makes (the app's own, as the phone has them in mobile-contract.ts): editing the film,
 *  deciding on a cut, versions and history, thumbnails, the live mix, export, moving a clip's element, voiceover. Never
 *  the agent (the chat is the agent), keys, settings, the browser or other projects. */
export const EDITOR_CALLS = [
  'timeline:edit', 'timeline:undo', 'timeline:render', 'project:decide', 'project:current', 'project:removeFiles',
  'history:log', 'history:restore', 'media:thumbnails', 'mix:speech', 'preview:prepare', 'transcript:get',
  'export:run', 'export:editors', 'export:reveal', 'project:reveal', 'project:revealFile', 'project:downloadFile',
  'clip:move', 'tools:list', 'tools:install', 'account:status',
  'voiceover:access', 'voiceover:begin', 'voiceover:save', 'voiceover:cancel',
] as const

const safe = (rel: string) => !!rel && !rel.includes('\0') && !rel.includes('\\') && !rel.startsWith('/') && rel.split('/').every(s => s && s !== '..' && !s.startsWith('.'))

/** Whether the page may load [rel]: only what the film plays (its files, light copies, versions, clips, music,
 *  voiceovers), never anything else in the folder. Exact names, except inside a clip's own folder (its page loads
 *  its images and styles beside it). */
export function servable(p: Project, rel: string) {
  if (!safe(rel)) return false
  const ok = new Set<string>([
    ...Object.keys(p.media), ...Object.values(p.proxies || {}), ...p.versions.flatMap(v => [v.path, ...(v.dry ? [v.dry] : [])]),
    ...(p.voiceovers || []).map(v => v.src),
  ])
  if (ok.has(rel)) return true
  const clip = /^clips\/([^/]+)\//.exec(rel)?.[1]
  return !!clip && !!p.clips?.[clip]
}

/** A playable address for a project file. */
export const mediaUrl = (base: string, rel: string) => base + rel.split('/').map(encodeURIComponent).join('/')

/** The project-relative path of a file the panel asks for by its absolute path (and maybe ?v=…), if it is inside. */
export function relOf(dir: string, path: string) {
  const plain = path.replace(/[?#].*$/, '').replace(/\\/g, '/')
  const root = dir.replace(/\\/g, '/').replace(/\/$/, '') + '/'
  return plain.startsWith(root) ? plain.slice(root.length) : undefined
}
