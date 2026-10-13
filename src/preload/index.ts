// The renderer's only door to the main process. Keys never come back through here: only whether they are set.
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { BaseEvent } from '@ag-ui/core'
import type { AccountStatus, Anchor, BrowserMode, BrowserState, ChromeBsk, ConsentRequest, Job, KeyInfo, OnDemandTool, Project, RecentProject, ToolStatus, Transcript, WhisperConfig, WhisperStatus } from '../shared/types'
import type { CustomProvider, CustomProviderInfo } from '../shared/providers'
import type { Cue } from '../shared/subtitles'
import type { Edit } from '../shared/timeline'
import type { PreviewState } from '../shared/proxy'
import type { DemoOptions } from '../main/demo'
import type { GalleryExample, SubtitleLink } from '../shared/types'
import type { TelemetryState } from '../shared/telemetry'
import type { SettingsOpened } from '../shared/onboarding'

export type SubtitlesState = { link?: SubtitleLink; cues: Cue[]; candidates: string[] }
/** How many edits can be undone (back) and redone (forward). */
export type UndoState = { back: number; forward: number }
type ProvidersState = { providers: CustomProviderInfo[]; omp: boolean }

type SkillState = { skills: { id: string; name: string; description: string; path: string }[]; enabled: string[]; profile: { id: string; name: string }; profiles: { id: string; name: string }[] }

type ModelInfo = { provider: string; providerLabel: string; modelId: string; name: string; context?: number; price?: { input: number; output: number }; images: boolean; reasoning: boolean }

type UpdateState = { mode: string; why?: string; status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; progress?: number; error?: string }

const on = <T extends unknown[]>(ch: string) => (fn: (...args: T) => void) => {
  const h = (_e: unknown, ...args: unknown[]) => fn(...(args as T))
  ipcRenderer.on(ch, h)
  return () => { ipcRenderer.removeListener(ch, h) }
}

const api = {
  onboarding: {
    settingsOpened: () => ipcRenderer.invoke('onboarding:settings-opened') as Promise<SettingsOpened>,
    finishSettings: (status: 'completed' | 'skipped') => ipcRenderer.invoke('onboarding:settings-finish', status) as Promise<void>,
  },
  info: () => ipcRenderer.invoke('app:info') as Promise<{ version: string; platform: string; projectsRoot: string }>,
  telemetry: {
    state: () => ipcRenderer.invoke('telemetry:state') as Promise<TelemetryState>,
    set: (choice: { usage: boolean; crashes: boolean }) => ipcRenderer.invoke('telemetry:set', choice) as Promise<TelemetryState>,
  },
  pathForFile: (f: File) => webUtils.getPathForFile(f),
  tools: {
    bundled: () => ipcRenderer.invoke('tools:status') as Promise<ToolStatus[]>,
    list: () => ipcRenderer.invoke('tools:list') as Promise<OnDemandTool[]>,
    install: (id: string) => ipcRenderer.invoke('tools:install', id) as Promise<void>,
    remove: (id: string) => ipcRenderer.invoke('tools:remove', id) as Promise<void>,
  },
  skills: {
    state: () => ipcRenderer.invoke('skills:state') as Promise<SkillState>,
    enable: (id: string, on: boolean) => ipcRenderer.invoke('skills:enable', id, on) as Promise<SkillState>,
    useProfile: (id: string) => ipcRenderer.invoke('skills:profile', id) as Promise<SkillState>,
    newProfile: (name: string) => ipcRenderer.invoke('skills:newProfile', name) as Promise<SkillState>,
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list') as Promise<{ name: string; description: string; body: string }[]>,
    save: (name: string, description: string, body: string) => ipcRenderer.invoke('memory:save', name, description, body) as Promise<{ name: string; description: string; body: string }[]>,
    forget: (name: string) => ipcRenderer.invoke('memory:forget', name) as Promise<{ name: string; description: string; body: string }[]>,
  },
  whisper: {
    status: () => ipcRenderer.invoke('whisper:status') as Promise<WhisperStatus>,
    set: (c: Partial<WhisperConfig> & { mode: WhisperConfig['mode'] }) => ipcRenderer.invoke('whisper:set', c) as Promise<WhisperStatus>,
    pick: (what: 'binary' | 'model') => ipcRenderer.invoke('whisper:pick', what) as Promise<string | null>,
  },
  clips: {
    overlay: (dir: string, id: string, at: number, title: string) => ipcRenderer.invoke('clip:overlay', dir, id, at, title) as Promise<string>,
    save: (dir: string, id: string, title: string, html: string, dur: number, overlay = false) => ipcRenderer.invoke('clip:save', dir, id, title, html, dur, overlay) as Promise<{ id: string; duration: number; video: string; poster: string; frames: number }>,
    insert: (dir: string, id: string, at: number, title: string) => ipcRenderer.invoke('clip:insert', dir, id, at, title) as Promise<string>,
    move: (dir: string, id: string, element: string, dx: number, dy: number) => ipcRenderer.invoke('clip:move', dir, id, element, dx, dy) as Promise<Project>,
    render: (dir: string, id: string) => ipcRenderer.invoke('clip:render', dir, id) as Promise<{ video: string; poster: string; frames: number; duration: number; width: number; height: number; fps: number }>,
  },
  transcript: (dir: string, mediaRel: string, make = false) => ipcRenderer.invoke('transcript:get', dir, mediaRel, make) as Promise<Transcript | null>,
  thumbnails: (dir: string, src: string, count: number, start?: number, end?: number) => ipcRenderer.invoke('media:thumbnails', dir, src, count, start, end) as Promise<string[]>,
  preview: {
    prepare: (dir: string, media: string, retry = false) => ipcRenderer.invoke('preview:prepare', dir, media, retry) as Promise<PreviewState>,
    onState: on<[string, string, PreviewState]>('preview:state'),
  },
  /** The edit by hand: changes at once (no render) and can be undone; it renders on export or when saved as a version. */
  timeline: {
    edit: (dir: string, edits: Edit[]) => ipcRenderer.invoke('timeline:edit', dir, edits) as Promise<Project>,
    undo: (dir: string, redo = false) => ipcRenderer.invoke('timeline:undo', dir, redo) as Promise<Project>,
    /** Render the edit into a version and put it on screen; resolves to its id. */
    render: (dir: string) => ipcRenderer.invoke('timeline:render', dir) as Promise<string>,
    /** Put footage into the edit at t (seconds of the film). */
  },
  demo: {
    cancel: (dir: string) => ipcRenderer.invoke('demo:cancel', dir) as Promise<void>,
    create: (dir: string, options: DemoOptions) => ipcRenderer.invoke('demo:create', dir, options) as Promise<{ version: string; duration: number; removed: number; warning?: string }>,
  },
  /** Who speaks when in a media file (make: work it out as a background job if not done yet). */
  /** The subtitles that go with a media file, their lines, and the subtitle files there are to choose from. */
  export: {
    run: (dir: string, req: { preset: 'original' | 'landscape' | 'vertical' | 'square'; fit?: 'pad' | 'crop'; captions: 'none' | 'burn' | 'srt'; captionColor?: string }) =>
      ipcRenderer.invoke('export:run', dir, req) as Promise<{ file: string; srt?: string } | null>,
    reveal: (file: string) => ipcRenderer.invoke('export:reveal', file),
  },
  mix: {
    /** Where speech is on a version's timeline ('edit': the edit by hand). */
    speech: (dir: string, versionId?: string) => ipcRenderer.invoke('mix:speech', dir, versionId) as Promise<[number, number][]>,
  },
  history: {
    log: (dir: string) => ipcRenderer.invoke('history:log', dir) as Promise<{ id: string; message: string; at: number }[]>,
    restore: (dir: string, id: string) => ipcRenderer.invoke('history:restore', dir, id) as Promise<Project>,
  },
  jobs: { list: () => ipcRenderer.invoke('jobs:list') as Promise<Job[]>, onChange: on<[Job[]]>('jobs') },
  consent: {
    list: () => ipcRenderer.invoke('consent:list') as Promise<ConsentRequest[]>,
    answer: (id: string, ok: boolean) => ipcRenderer.invoke('consent:answer', id, ok),
    onChange: on<[ConsentRequest[]]>('consent'),
  },
  keys: {
    list: () => ipcRenderer.invoke('keys:list') as Promise<KeyInfo[]>,
    set: (name: string, value: string) => ipcRenderer.invoke('keys:set', name, value) as Promise<KeyInfo[]>,
  },
  /** Signing in to Manul: brings the person's Manul key (stays in the main process); only who is signed in comes back. */
  account: {
    status: () => ipcRenderer.invoke('account:status') as Promise<AccountStatus>,
    signIn: () => ipcRenderer.invoke('account:signIn') as Promise<AccountStatus>,
    cancel: () => ipcRenderer.invoke('account:cancel'),
    signOut: () => ipcRenderer.invoke('account:signOut') as Promise<AccountStatus>,
    /** USD: the credit, what's used, what's left */
    balance: () => ipcRenderer.invoke('account:balance') as Promise<{ credit: number; used: number; left: number }>,
    /** opens a Dodo Payments checkout in the browser */
    addCredit: (amount?: number) => ipcRenderer.invoke('account:addCredit', amount) as Promise<void>,
  },
  /** Custom model providers (OpenAI/Anthropic-compatible endpoints); keys go in, only "set or not" comes back. */
  providers: {
    list: () => ipcRenderer.invoke('providers:list') as Promise<ProvidersState>,
    save: (p: Partial<CustomProvider>, key?: string | null, replacing?: string) => ipcRenderer.invoke('providers:save', p, key, replacing) as Promise<ProvidersState>,
    remove: (id: string) => ipcRenderer.invoke('providers:remove', id) as Promise<ProvidersState>,
    importOmp: () => ipcRenderer.invoke('providers:import-omp') as Promise<ProvidersState & { added: { id: string; name: string; models: number; key: boolean }[] }>,
  },
  /** Manul's own browser (the Browser panel) and which browser the agent drives. */
  browser: {
    state: () => ipcRenderer.invoke('browser:state') as Promise<BrowserState>,
    onState: on<[BrowserState]>('browser:state'),
    /** the agent opened or focused a window: show the panel */
    onReveal: on<[number]>('browser:reveal'),
    /** where the panel's page area is (CSS px in the window), or null while hidden or covered */
    setBounds: (r: { x: number; y: number; width: number; height: number } | null) => ipcRenderer.send('browser:bounds', r),
    navigate: (url: string) => ipcRenderer.invoke('browser:navigate', url),
    back: () => ipcRenderer.invoke('browser:back'),
    forward: () => ipcRenderer.invoke('browser:forward'),
    reload: () => ipcRenderer.invoke('browser:reload'),
    select: (id: number) => ipcRenderer.invoke('browser:select', id),
    close: (id: number) => ipcRenderer.invoke('browser:close', id),
    newTab: () => ipcRenderer.invoke('browser:new'),
    mode: () => ipcRenderer.invoke('browser:mode') as Promise<BrowserMode>,
    setMode: (m: BrowserMode) => ipcRenderer.invoke('browser:set-mode', m) as Promise<BrowserMode>,
    chrome: () => ipcRenderer.invoke('browser:chrome') as Promise<ChromeBsk>,
  },
  tabs: {
    get: () => ipcRenderer.invoke('tabs:get') as Promise<{ open: string[]; active: string | null }>,
    set: (t: { open: string[]; active: string | null }) => ipcRenderer.invoke('tabs:set', t),
  },
  /** light, dark or the system's: the window and native menus follow it */
  theme: { set: (t: 'light' | 'dark' | 'system') => ipcRenderer.invoke('theme:set', t) },
  /** Motion examples (with the prompt behind each) for the start screen. */
  gallery: { list: () => ipcRenderer.invoke('gallery:list') as Promise<GalleryExample[]> },
  project: {
    recent: () => ipcRenderer.invoke('project:recent') as Promise<RecentProject[]>,
    pick: () => ipcRenderer.invoke('project:pick') as Promise<string[]>,
    create: (files: string | string[]) => ipcRenderer.invoke('project:create', files) as Promise<Project>,
    /** A motion video from nothing: a blank canvas in that format, from a gallery example and/or a reference video. */
    createMotion: (o: { title?: string; aspect: '16:9' | '9:16' | '1:1'; length?: number; example?: string; reference?: string; files?: string[] }) =>
      ipcRenderer.invoke('project:createMotion', o) as Promise<Project>,
    open: (dir: string) => ipcRenderer.invoke('project:open', dir) as Promise<Project>,
    close: (dir: string) => ipcRenderer.invoke('project:close', dir),
    /** Move the project folder and every render, file and conversation asset to the system Trash. */
    delete: (dir: string) => ipcRenderer.invoke('project:delete', dir),
    reveal: (dir: string) => ipcRenderer.invoke('project:reveal', dir),
    import: (dir: string, file: string) => ipcRenderer.invoke('project:import', dir, file) as Promise<string[]>,
    pickFiles: () => ipcRenderer.invoke('project:pickFiles') as Promise<string[]>,
    /** Files out of the project, into the Trash; the ones the film uses are kept, with why. */
    removeFiles: (dir: string, rels: string[]) => ipcRenderer.invoke('project:removeFiles', dir, rels) as Promise<{ removed: string[]; blocked: { file: string; why: string }[] }>,
    decide: (dir: string, accept: boolean) => ipcRenderer.invoke('project:decide', dir, accept) as Promise<Project>,
    setCurrent: (dir: string, id: string) => ipcRenderer.invoke('project:current', dir, id) as Promise<Project>,
    onChange: on<[Project]>('project'),
  },
  agent: {
    ready: () => ipcRenderer.invoke('agent:ready') as Promise<boolean>,
    attach: (dir: string) => ipcRenderer.invoke('agent:attach', dir),
    send: (dir: string, msg: { text: string; anchor?: Anchor; still?: string; files?: string[] }) => ipcRenderer.invoke('agent:send', dir, msg),
    stop: (dir: string) => ipcRenderer.invoke('agent:stop', dir),
    newConversation: (dir: string) => ipcRenderer.invoke('agent:newConversation', dir) as Promise<Project>,
    switchConversation: (dir: string, id: string) => ipcRenderer.invoke('agent:switch', dir, id) as Promise<Project>,
    renameConversation: (dir: string, id: string, title: string) => ipcRenderer.invoke('agent:rename', dir, id, title) as Promise<Project>,
    models: (dir?: string) => ipcRenderer.invoke('agent:models', dir) as Promise<{ models: ModelInfo[]; current: { provider: string; modelId: string } | null }>,
    setModel: (dir: string, model: { provider: string; modelId: string } | null) => ipcRenderer.invoke('agent:setModel', dir, model) as Promise<{ provider: string; modelId: string } | undefined>,
    onEvent: on<[string, BaseEvent]>('agui'),
    onReady: on<[]>('agent:ready'),
  },
  updates: {
    state: () => ipcRenderer.invoke('update:state') as Promise<UpdateState | undefined>,
    check: () => ipcRenderer.invoke('update:check') as Promise<UpdateState | undefined>,
    install: () => ipcRenderer.invoke('update:install'),
    onChange: on<[UpdateState]>('update'),
  },
  notices: () => ipcRenderer.invoke('app:notices'),
  onSeek: on<[string, number]>('seek'),
  onMenu: on<[string]>('menu'),
  onNotice: on<[string]>('notice'),
}

export type ManulApi = typeof api
contextBridge.exposeInMainWorld('manul', api)
