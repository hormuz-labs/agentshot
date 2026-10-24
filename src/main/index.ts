// Manul's main process: the window, the media protocol, projects, keys, and the agent (pi-durable → AG-UI → renderer).
import { CRASHES_AVAILABLE } from './crash' // first: crash reports must start before anything else
import { app, BrowserWindow, dialog, ipcMain as electronIpcMain, nativeTheme, powerMonitor, protocol, shell } from 'electron'
import { DEFAULT_MOBILE_PORT, MobileBridge, reachableIps } from './mobile-bridge'
import { projectArgument } from './mobile-contract'
import { startWorkerHeartbeat, WorkerClient, type SavedWorker } from './worker-client'
import { startMeshNode, type MeshNode } from './mesh'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { artifactPath } from './artifacts'
import { startAgent, type AgentHandle } from './agent'
import { renderCuts } from './cuts'
import { renderOutput, TimelineRenders } from './timeline-renders'
import { planDemo, type DemoOptions } from './demo'
import { demoHint } from '../shared/demo'
import { renderClip, setClipProtocol } from './clips'
import { buildMenu } from './menu'
import { startUpdates } from './updates'
import { keyStatus, loadKeys, setKey } from './keys'
import { accountStatus, accountWorkers, balance, cancelSignIn, checkout, leaseAccountWorker, manageBilling, meshJoin, releaseAccountWorker, signIn, signOut, workerHeartbeat } from './account'
import { importOmp, ompAvailable, providerInfo, removeProvider, saveProvider } from './providers'
import { asJob, listJobs, onJobs } from './jobs'
import { toolPath, toolStatus } from './media'
import { thumbnails } from './thumbnails'
import * as Tools from './tools'
import * as Whisper from './whisper'
import { getConfig, setConfig } from './config'
import { OnboardingStore } from './onboarding'
import { UsageTelemetry } from './telemetry'
import type { TelemetryState } from '../shared/telemetry'
import type { BaseEvent } from '@ag-ui/core'
import { Memory } from './memory'
import { History } from './history'
import { Skills } from './skills'
import { Browser } from './browser'
import { chromeCdp, devToolsPortFiles, probeExpression } from './cdp'
import { BskCapture, ScreencastCapture, type Capture } from './take'
import { composeWalkthrough, takeDir, Takes, type ComposeRequest } from './walkthrough'
import { generate } from './generate'
import { randomUUID } from 'node:crypto'
import { agentEnv, browserPrompt, BskDaemon, BSK_BIN, bskScript, chromeBsk, extensionStorage, HALTED, findUserBsk, privateHome, userBskEnv, userBskHome } from './bsk'
import { homedir, hostname } from 'node:os'
import * as Projects from './projects'
import * as Gallery from './gallery'
import * as Files from './files'
import { addOverlay, applyEdit, composeArgs, describeEdit, duration as timelineDuration, insertAt, sameCut, type Edit, type Item } from '../shared/timeline'
import { moveElement, prepareClipHtml } from '../shared/clip-html'
import { captionCues, exportArgs, toSrt, type ExportOptions } from '../shared/export'
import { PreviewCopies } from './proxies'
import { joinAttached } from '../shared/attached'
import { extOf } from '../shared/file-kinds'
import { matchSubtitles, parseSubtitles } from '../shared/subtitles'
import type { Speakers as SpeakersResult } from '../shared/speakers'
import * as Speakers from './speakers'
import { duckEnvelope, mixArgs, mixCommands, regionsOnTimeline, type Mix } from '../shared/mix'
import { spawn } from 'node:child_process'
import { FFMPEG, FFPROBE, probe } from './media'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import type { Anchor, BrowserMode, ClipInfo, ConsentRequest, Project, RecentProject, Transcript } from '../shared/types'
import type { Timeline } from '../shared/timeline'
import { decodeMediaPath, filesystemSlug, pathBasename } from '../shared/paths'
import { relativeProjectPath } from './paths'
import { serveMedia as mediaResponse } from './media-protocol'

declare const __MANUL_TELEMETRY_URL__: string
declare const __MANUL_POSTHOG_TOKEN__: string

app.setName('AgentShot')
process.env.PATH = toolPath() // the agent's shell and tools find bundled executables first

protocol.registerSchemesAsPrivileged([{ scheme: 'manul', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, bypassCSP: true, corsEnabled: true } }])

let win: BrowserWindow | null = null
const WORKER_MODE = process.argv.includes('--worker') || process.env.MANUL_WORKER === '1'
let stopHeartbeat: (() => void) | null = null
let meshNode: MeshNode | null = null
let meshIp: string | undefined
let agent: AgentHandle | null = null
let memory: Memory
let skills: Skills
let updates: ReturnType<typeof startUpdates> | null = null
let telemetry: UsageTelemetry
const open = new Map<string, Project>() // dir → project
let browser: Browser | null = null
let bskd: BskDaemon | null = null
let browserStartup: Promise<void> | null = null
let shutdownTask: Promise<void> | null = null
let quitting = false
let quitRequested = false
let allowQuit = false
// Register once: desktop IPC and validated mobile calls share application operations.
const handlers = new Map<string, Parameters<typeof electronIpcMain.handle>[1]>()
const workerClient = new WorkerClient({
  stateFile: join(app.getPath('userData'), 'workers.json'),
  projectsRoot: () => Projects.projectsRoot(),
  onEvent: (ch, ...args) => win?.webContents.send(ch, ...args),
  onProjectPulled: async dir => {
    const p = await Projects.load(dir)
    open.set(dir, p)
    send('project', p)
  },
})
const ipcMain = {
  handle(channel: string, listener: Parameters<typeof electronIpcMain.handle>[1]) {
    const wrapped: Parameters<typeof electronIpcMain.handle>[1] = async (ev, ...args) => {
      if (projectArgument(channel) && typeof args[0] === 'string' && workerClient.ownsProject(args[0])) {
        const remoteDir = args[0]
        if (channel === 'project:import' && typeof args[1] === 'string') return workerClient.uploadFile(args[1], remoteDir)
        if (channel === 'export:run') {
          const exported = (await workerClient.rpc('mobile:export', [remoteDir, args[1]])) as { file: string; srt?: string } | null
          if (!exported) return null
          const r = await dialog.showSaveDialog(win!, { title: 'Export', defaultPath: join(app.getPath('videos'), basename(exported.file)), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
          if (r.canceled || !r.filePath) return null
          const mediaRes = await workerClient.fetchMedia(remoteDir, exported.file)
          if (mediaRes.ok) await writeFile(r.filePath, Buffer.from(await mediaRes.arrayBuffer()))
          return { file: r.filePath }
        }
        return workerClient.rpc(channel, args)
      }
      return listener(ev, ...args)
    }
    handlers.set(channel, listener)
    electronIpcMain.handle(channel, wrapped)
  },
  on: electronIpcMain.on.bind(electronIpcMain),
}
const mobile = new MobileBridge(
  {
    stateFile: join(app.getPath('userData'), 'mobile-bridge.json'),
    projectsRoot: () => Projects.projectsRoot(),
    onProjectSynced: async dir => {
      const p = await Projects.load(dir)
      open.set(dir, p)
      send('project', p)
    },
    invoke: async (method, args) => {
      const handler = handlers.get(method)
      if (!handler) throw new Error('Operation unavailable')
      return handler(undefined as unknown as Electron.IpcMainInvokeEvent, ...args)
    },
    projects: () => Projects.recent(),
    importFile: async (file, dir) => dir
      ? handlers.get('project:import')!(undefined as unknown as Electron.IpcMainInvokeEvent, dir, file)
      : handlers.get('project:create')!(undefined as unknown as Electron.IpcMainInvokeEvent, [file]),
    galleryFile: (url, range) => mediaResponse(new Request(url, { headers: range ? { range } : {} }), LIB, [Projects.projectsRoot(), ...open.keys()], Gallery.GALLERY),
    meshIp: () => meshIp,
  },
  () => {
    const ips = reachableIps()
    return meshIp && !ips.includes(meshIp) ? [...ips, meshIp] : ips
  },
)

let meshJoining: Promise<void> | undefined
// joins Headscale in the background: the pairing code must not wait on the mesh (up to ~90 s when the control server is slow)
function joinMesh() {
  const poolSecret = process.env.MANUL_POOL_SECRET
  if (meshNode || meshJoining || !(poolSecret || getConfig().account?.keyId)) return meshJoining
  meshJoining = (async () => {
    const joined = await meshJoin('worker', poolSecret).catch(() => null)
    const port = mobile.listenPort()
    if (!joined || !port) return
    const node = await startMeshNode({
      stateDir: join(app.getPath('userData'), 'mesh-worker'),
      hostname: `manul-${(hostname() || 'worker').replace(/[^a-zA-Z0-9-]/g, '-').toLowerCase()}`,
      controlUrl: joined.controlUrl,
      authKey: joined.authKey,
      // mesh peers dial the same port the bridge advertises, forwarded to wherever it actually bound
      forwardPort: port,
      meshPort: port,
      onExit: () => { if (meshNode === node) { meshNode = null; meshIp = undefined } },
    })
    // the bridge was turned off while the mesh was coming up
    if (!mobile.listenPort()) { node?.stop(); return }
    meshNode = node
    meshIp = node?.ip
  })().finally(() => { meshJoining = undefined })
  return meshJoining
}
function stopMesh() {
  stopHeartbeat?.()
  stopHeartbeat = null
  meshNode?.stop()
  meshNode = null
  meshIp = undefined
}

async function startBridgeAndMesh(opts: { waitForMesh?: boolean } = {}) {
  await mobile.start()
  const joining = joinMesh()
  if (opts.waitForMesh) await joining
  // "New code" calls this again; keep the one heartbeat
  stopHeartbeat ??= startWorkerHeartbeat({
    bridge: mobile,
    workerId: process.env.MANUL_WORKER_ID || `worker-${(hostname() || 'host').replace(/[^a-zA-Z0-9._-]/g, '-')}`,
    workerName: process.env.MANUL_WORKER_NAME || hostname() || 'AgentShot Worker',
    poolSecret: process.env.MANUL_POOL_SECRET,
    priority: process.env.MANUL_WORKER_PRIORITY ? Number(process.env.MANUL_WORKER_PRIORITY) : undefined,
    projects: () => Projects.recent().map(r => r.id),
    sendHeartbeat: workerHeartbeat,
  })
  return mobile.status()
}
const browserMode = (): BrowserMode => getConfig().browser?.mode ?? 'manul'

function shutdown() {
  quitting = true
  for (const c of consents.values()) c.answer(false)
  consents.clear()
  return shutdownTask ??= new Promise<void>(done => {
    const timeout = setTimeout(() => {
      console.warn('Shutdown timed out; stopping the browser daemon before exit.')
      bskd?.killNow()
      done()
    }, 10_000)
    void (async () => {
      stopMesh()
      workerClient.disconnect()
      await mobile.stop()
      await startup.catch(e => console.warn('startup', e))
      await browserStartup
      await takes.stopAll().catch(e => console.warn('takes shutdown', e))
      try { browser?.destroy() } catch (e) { console.warn('browser shutdown', e) }
      await Promise.allSettled([agent?.shutdown(), bskd?.stop()])
    })().catch(e => console.warn('shutdown', e)).finally(() => { clearTimeout(timeout); done() })
  })
}

const send = (ch: string, ...args: unknown[]) => { win?.webContents.send(ch, ...args); mobile.publish(ch, ...args) }
const projectOf = (dir: string) => {
  const p = open.get(dir)
  if (!p) throw new Error('This project is not open.')
  return p
}
const publish = async (p: Project) => { await Projects.save(p); send('project', p) }
/** Save, show, and make this a point in the project's history. */
const checkpoint = async (p: Project, message: string) => {
  await publish(p)
  await new History(p.dir).record(message).catch(e => console.warn('history', e))
}

// ---------------------------------------------------------------- consent cards: the caller waits until the user answers
const consents = new Map<string, { req: ConsentRequest; answer: (ok: boolean) => void }>()
let consentSeq = 0
export function askConsent(req: Omit<ConsentRequest, 'id'>): Promise<boolean> {
  if (quitting) return Promise.resolve(false)
  const id = `c${++consentSeq}`
  return new Promise(answer => {
    consents.set(id, { req: { ...req, id }, answer })
    send('consent', [...consents.values()].map(c => c.req))
  })
}
const askTool = (project?: string) => (title: string, body: string, sizeMB: number) =>
  askConsent({ project, title, body, sizeMB, confirm: `Download ${sizeMB >= 1000 ? (sizeMB / 1000).toFixed(1) + ' GB' : sizeMB + ' MB'}` })

// Libraries motion clips may load: manul://lib/<file> (GSAP, the clip runtime)
const LIB = app.isPackaged ? join(process.resourcesPath, 'lib') : join(import.meta.dirname, '../../resources/lib')
const serveMedia = (req: Request): Response | Promise<Response> => {
  try {
    const url = new URL(req.url)
    if (url.protocol === 'manul:' && url.host !== 'lib' && url.host !== 'gallery') {
      const decoded = decodeMediaPath(url)
      for (const remoteDir of workerClient.status().remoteProjects) {
        if (decoded.startsWith(`${remoteDir}/`)) {
          const rel = decoded.slice(remoteDir.length + 1)
          return workerClient.fetchMedia(remoteDir, rel, req.headers.get('range') || undefined)
        }
      }
    }
  } catch {}
  return mediaResponse(req, LIB, [Projects.projectsRoot(), ...open.keys()], Gallery.GALLERY)
}

// ---------------------------------------------------------------- projects
async function openProject(dir: string) {
  const p = open.get(dir) || (await Projects.load(dir))
  open.set(dir, p)
  for (const rel of Object.keys(p.media)) ensureProxy(p, rel) // older projects, or a copy that was deleted
  // files added or removed in Finder (and projects from before the file list) show up in the list and to the agent
  Projects.syncFiles(p).then(changed => { if (changed) return publish(p) }).catch(e => console.warn('files', e))
  if (agent) {
    const conv = await agent.open(dir, p.conversation)
    if (conv !== p.conversation || !p.conversations?.some(c => c.id === conv)) { useConversation(p, conv); await Projects.save(p) }
  }
  return p
}

/** Make a conversation the project's current one (recording it if new). */
function useConversation(p: Project, id: string) {
  p.conversation = id
  if (!p.conversations?.some(c => c.id === id)) p.conversations = [...(p.conversations || []), { id, title: 'New conversation', createdAt: Date.now() }]
}

// ---------------------------------------------------------------- transcripts
const inflight = new Map<string, Promise<Transcript>>()

/** The transcript of a project's media file: read it if made, else make it (asking to download an engine if none). */
async function transcriptOf(p: Project, mediaRel: string, opts: { ask: boolean }): Promise<Transcript | null> {
  const rel = p.transcripts?.[mediaRel]
  if (rel && existsSync(join(p.dir, rel))) return JSON.parse(await readFile(join(p.dir, rel), 'utf8')) as Transcript
  const key = `${p.dir}|${mediaRel}`
  const busy = inflight.get(key)
  if (busy) return busy
  if (p.media[mediaRel] && !p.media[mediaRel].hasAudio) opts = { ask: false } // silent: transcribe() returns an empty transcript without an engine
  else if (!(await Whisper.resolveEngine())) {
    if (!opts.ask) return null
    await Tools.ensure(Whisper.toolToInstall(), askTool(p.dir))
  }
  const out = Whisper.transcriptPathFor(mediaRel)
  const job = Whisper.transcribe(join(p.dir, mediaRel), join(p.dir, out), `Transcribing ${mediaRel.split('/').pop()}`, p.dir)
    .then(async t => {
      p.transcripts = { ...p.transcripts, [mediaRel]: out }
      if (p.subtitles?.[mediaRel]) await checkSubtitles(p, mediaRel, t)
      await publish(p)
      // then who speaks when, in the background (local and free, so it never asks)
      if (t.segments.length && Speakers.speakerDetectionReady()) speakersOf(p, mediaRel, { make: true }).catch(e => console.warn('Speaker detection failed:', e instanceof Error ? e.message : e))
      return t
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, job)
  return job
}

// ---------------------------------------------------------------- who speaks when
const diarizing = new Map<string, Promise<SpeakersResult>>()

/** The voices in a media file: made already, or (make) worked out as a background job. With count, diarize for exactly
 *  that many people (the agent knows; more accurate) and make that the one shown. */
async function speakersOf(p: Project, mediaRel: string, o: { make: boolean; count?: number }): Promise<SpeakersResult | null> {
  const abs = join(p.dir, mediaRel)
  if (!o.count) {
    const have = await Speakers.cachedSpeakers(p.dir, abs, p.speakers?.[mediaRel] && join(p.dir, p.speakers[mediaRel]))
    if (have) return have.result
    if (!o.make) return null
  }
  const key = `${p.dir}|${mediaRel}|${o.count || 0}`
  const busy = diarizing.get(key)
  if (busy) return busy
  const name = mediaRel.split('/').pop()
  const job = asJob(`Finding who speaks in ${name}`, 'speakers', async j => Speakers.analyzeSpeakers(p.dir, abs, {
    speakers: o.count, transcript: await transcriptOf(p, mediaRel, { ask: false }).catch(() => null), onProgress: x => j.progress(x),
  }),
    { project: p.dir, doneTitle: `Found who speaks in ${name}` })
    .then(async ({ result, file }) => {
      p.speakers = { ...p.speakers, [mediaRel]: relativeProjectPath(p.dir, file) }
      await publish(p)
      return result
    })
    .finally(() => diarizing.delete(key))
  diarizing.set(key, job)
  return job
}

/** Name voices (id → name; an empty name clears it). The same name on two voices makes them one person. */
async function nameSpeakers(p: Project, mediaRel: string, names: Record<string, string>) {
  const now = { ...p.speakerNames?.[mediaRel] }
  for (const [id, n] of Object.entries(names)) { if (n.trim()) now[id] = n.trim(); else delete now[id] }
  p.speakerNames = { ...p.speakerNames, [mediaRel]: now }
  await checkpoint(p, `Named speakers in ${mediaRel.split('/').pop()}`)
  return now
}

// ---------------------------------------------------------------- subtitles for a video
/** The subtitles that go with a media file: the ones chosen, else ones named after it (chosen from then on). */
function subtitlesLink(p: Project, mediaRel: string) {
  const link = p.subtitles?.[mediaRel]
  if (link && p.files?.[link.file]) return link
  const byName = Object.keys(p.files || {}).find(f => p.files![f].kind === 'subtitles' && Files.subtitlesFor(f, p.files!) === mediaRel)
  if (!byName) return undefined
  p.subtitles = { ...p.subtitles, [mediaRel]: { file: byName } }
  return p.subtitles[mediaRel]
}

/** Do the linked subtitles match what's said (and how far off are their times)? Needs the transcript. */
async function checkSubtitles(p: Project, mediaRel: string, t?: Transcript | null) {
  const link = p.subtitles?.[mediaRel]
  if (!link) return
  t ??= await transcriptOf(p, mediaRel, { ask: false }).catch(() => null)
  const cues = parseSubtitles(await readFile(join(p.dir, link.file), 'utf8'), extOf(link.file))
  const m = t ? matchSubtitles(cues, t.segments.flatMap(s => s.words)) : null
  p.subtitles = { ...p.subtitles, [mediaRel]: { file: link.file, ...(m || {}) } }
}

async function subtitlesState(p: Project, mediaRel: string) {
  const before = JSON.stringify(p.subtitles?.[mediaRel])
  const link = subtitlesLink(p, mediaRel)
  if (link && link.match === undefined && p.transcripts?.[mediaRel]) await checkSubtitles(p, mediaRel)
  if (JSON.stringify(p.subtitles?.[mediaRel]) !== before) await publish(p)
  const now = p.subtitles?.[mediaRel]
  const cues = now ? parseSubtitles(await readFile(join(p.dir, now.file), 'utf8').catch(() => ''), extOf(now.file)) : []
  return { link: now, cues, candidates: Object.keys(p.files || {}).filter(f => p.files![f].kind === 'subtitles').sort() }
}

/** Heavy or hard-to-decode footage gets a light preview copy in proxies/ (the player uses it; renders never do). */
const previews = new PreviewCopies({ publish, notify: (dir, media, state) => send('preview:state', dir, media, state) })
const ensureProxy = (p: Project, media: string) => previews.ensure(p, media).catch(e => console.warn('preview state failed', e))

/** After an import: transcribe in the background when an engine is ready (never asks to download on its own). */
const autoTranscribe = (p: Project, mediaRel: string) => {
  const info = p.media[mediaRel]
  if (info?.hasAudio) transcriptOf(p, mediaRel, { ask: false }).catch(e => console.warn('transcription failed', e))
}

// ---------------------------------------------------------------- motion clips and timeline renders
/** Write (or replace) clips/<id>/clip.html and render it. */
async function saveClip(p: Project, id: string, title: string, html: string, dur: number, overlay = false): Promise<ClipInfo & { frames: number }> {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(id)) throw new Error('Clip ids are short kebab-case, e.g. "title-card".')
  if (filesystemSlug(id, 'clip', 41) !== id) throw new Error('Clip ids cannot be Windows device names.')
  const tl = p.timeline!
  await mkdir(join(p.dir, 'clips', id), { recursive: true })
  await writeFile(join(p.dir, 'clips', id, 'clip.html'), prepareClipHtml(html, tl, dur, overlay))
  p.clips = { ...p.clips, [id]: { ...(p.clips?.[id] || { id, title, duration: dur, video: '', poster: '', updatedAt: 0 }), title, overlay } }
  const r = await bakeClip(p, id, title)
  await checkpoint(p, `Made clip “${title}”`)
  return r
}

/** Render a clip's HTML to MP4 + poster and record it on the project. */
async function bakeClip(p: Project, id: string, title?: string) {
  const overlay = !!p.clips?.[id]?.overlay
  const r = await asJob(`Rendering clip ${id}`, 'render', j => renderClip(p.dir, id, j, overlay), { project: p.dir, doneTitle: `Rendered clip ${id}` })
  const info: ClipInfo = { id, title: title || p.clips?.[id]?.title || id, duration: r.duration, video: r.video, poster: r.poster, updatedAt: Date.now(), overlay }
  p.clips = { ...p.clips, [id]: info }
  // the clip's length may have changed: keep every timeline item and overlay that uses it in step
  if (p.timeline) {
    p.timeline.items = p.timeline.items.map(it => (it.kind === 'clip' && it.clip === id ? { ...it, dur: r.duration } : it))
    p.timeline.overlays = p.timeline.overlays?.map(o => (o.clip === id ? { ...o, dur: Math.min(o.dur, r.duration) || r.duration } : o))
  }
  await publish(p)
  return { ...info, frames: r.frames }
}

/** Transcripts already made for the timeline's media (never asks; speech without a transcript just isn't ducked). */
async function transcriptsFor(p: Project, tl: Timeline) {
  const out: Record<string, Transcript | undefined> = {}
  for (const it of tl.items) if (it.kind === 'media' && !(it.src in out)) out[it.src] = (await transcriptOf(p, it.src, { ask: false }).catch(() => null)) || undefined
  if (tl.demo?.audio === 'camera') out[tl.demo.camera] = (await transcriptOf(p, tl.demo.camera, { ask: false }).catch(() => null)) || undefined
  return out
}

/** Mix a dry render into the final file (film level, music, ducking under speech); the picture is copied. */
async function mixInto(p: Project, tl: Timeline, dryRel: string, outRel: string) {
  const mix = tl.mix!
  let commands: string | undefined
  if (mix.music && mix.music.duckDb > 0) {
    commands = `${outRel}.duck.cmd`
    await writeFile(join(p.dir, commands), mixCommands(duckEnvelope(regionsOnTimeline(tl, await transcriptsFor(p, tl)), mix.music.duckDb)))
  }
  const args = mixArgs({ dry: dryRel, duration: timelineDuration(tl), mix, commands, out: outRel })
  try {
    await new Promise<void>((ok, fail) => execFile(FFMPEG, ['-y', '-loglevel', 'error', ...args], { cwd: p.dir, maxBuffer: 1 << 24, windowsHide: true }, (err, _o, stderr) => (err ? fail(new Error(stderr.slice(-1500) || err.message)) : ok())))
  } finally { if (commands) await rm(join(p.dir, commands), { force: true }) }
}

/** The film's mix changed only: reuse the version on screen as the dry film and mix it (fast: audio only). */
async function applyMix(p: Project, mix: Mix) {
  const cur = p.versions.find(v => v.id === p.current)!
  const tl = { ...(cur.timeline || p.timeline!), mix }
  const dry = cur.dry || cur.path
  const files = await renderOutput(p.dir, 'mix', false, o => asJob('Mixing', 'render', () => mixInto(p, tl, dry, o.final), { project: p.dir, doneTitle: 'Mixed' }))
  const v = await Projects.addVersion(p, join(p.dir, files.final), describeMix(mix), 'user', tl, join(p.dir, dry))
  Projects.accept(p, v.id)
  await checkpoint(p, describeMix(mix))
  return v.id
}
const describeMix = (m: Mix) => m.music ? `Mix: music ${m.music.src.split('/').pop()} at ${m.music.db} dB, ducked ${m.music.duckDb} dB` : `Mix: film audio ${m.filmDb >= 0 ? '+' : ''}${m.filmDb} dB`
async function decideVersion(p: Project, accept: boolean) {
  if (!p.proposal) return p
  const v = p.versions.find(x => x.id === p.proposal)
  if (accept) Projects.accept(p, p.proposal)
  else p.versions = p.versions.filter(x => x.id !== p.proposal)
  telemetry.track('version decided', { accepted: accept })
  p.proposal = undefined
  if (v && !accept) p.notes.forEach(n => { if (n.status === 'resolved' && n.reply) n.reply += ` (rejected: ${v.title})` })
  await checkpoint(p, `${accept ? 'Accepted' : 'Rejected'} “${v?.title}”`)
  return p
}

/** Render a timeline into renders/ and propose it as a version (or, for the user's own edits, make it current). */
const timelineRenders = new TimelineRenders({ render: renderTimeline, addVersion: Projects.addVersion, checkpoint, preview: ensureProxy })
const proposeTimeline = (p: Project, tl: Timeline, title: string, by: 'agent' | 'user' = 'agent', propose = by === 'agent', signal?: AbortSignal) =>
  timelineRenders.request(p, tl, title, by, propose, signal)

async function renderTimeline(p: Project, tl: Timeline, title: string, signal?: AbortSignal) {
  const mixed = !!tl.mix && (!!tl.mix.music || tl.mix.filmDb !== 0)
  const rendered = (id: string) => p.clips?.[id]?.video && existsSync(join(p.dir, p.clips[id].video))
  for (const id of new Set([...tl.items.flatMap(it => (it.kind === 'clip' ? [it.clip] : [])), ...(tl.overlays || []).map(o => o.clip)])) if (!rendered(id)) await bakeClip(p, id)
  return renderOutput(p.dir, 'timeline', mixed, async ({ final, out }) => {
    const args = composeArgs(tl, {
      inputOf: it => (it.kind === 'media' ? it.src : p.clips![it.clip].video),
      hasAudio: it => it.kind === 'media' && !!p.media[it.src]?.hasAudio,
      overlayOf: o => p.clips![o.clip].video,
      out,
    })
    await asJob(`Rendering “${title}”`, 'render', async j => {
      j.progress(null, `${timelineDuration(tl).toFixed(1)} s`)
      // only cuts of one file: most of the picture is copied as it is (fast); anything else, or if that fails, in full
      const cut = await renderCuts({ ffmpeg: FFMPEG, ffprobe: FFPROBE, cwd: p.dir, tl, out, progress: f => j.progress(f) })
        .catch(e => ({ ok: false as const, why: `it failed: ${e instanceof Error ? e.message : e}` }))
      if (cut.ok) return cut.copied
      console.info(`Rendering “${title}” in full: ${cut.why}`)
      await new Promise<void>((ok, fail) => execFile(FFMPEG, ['-y', '-loglevel', 'error', ...args], { cwd: p.dir, maxBuffer: 1 << 24, signal, windowsHide: true }, (err, _o, stderr) => (err ? fail(new Error(stderr.slice(-1500) || err.message)) : ok())))
    }, { project: p.dir, doneTitle: `Rendered “${title}”`, doneDetail: copied => (copied ? `Copied ${Math.round(copied * 100)}% of the picture as it was` : undefined) })
    if (mixed) await asJob('Mixing', 'render', () => mixInto(p, tl, out, final), { project: p.dir, doneTitle: 'Mixed' })
    signal?.throwIfAborted()
    if (tl.demo) {
      const info = await probe(join(p.dir, final))
      if (Math.abs(info.duration - timelineDuration(tl)) > Math.max(0.15, 2 / tl.fps)) throw new Error(`Demo render timing check failed: expected ${timelineDuration(tl).toFixed(3)} s, got ${info.duration.toFixed(3)} s. Sync measurements are preserved; check source stream timestamps before retrying.`)
    }
  })
}

// ---------------------------------------------------------------- product walkthroughs
const takes = new Takes()
/** The agent's bsk wrappers' state (see bskScript): yield/ (commands running, for a take filming through bsk) and halted
 *  (the user interrupted the agent in the browser; cleared by their next message). */
const takeState = () => join(app.getPath('userData'), 'takes')
const yieldDir = () => join(takeState(), 'yield')
const haltFile = () => join(takeState(), 'halted')
const run = promisify(execFile)

/** The bsks a walkthrough's session can be on: the user's own Chrome (their bsk; walkthroughs film there by default), then
 *  Manul's browser. Each with the CLI and environment that reach its daemon. */
function takeBsks() {
  const userBsk = findUserBsk({ home: homedir(), bundled: BSK_BIN })
  return [
    { browser: 'chrome' as const, bin: userBsk || BSK_BIN, env: { ...process.env, ...userBskEnv(homedir()) } },
    { browser: 'manul' as const, bin: BSK_BIN, env: { ...process.env, BSK_HOME: bskd!.home, BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' } },
  ]
}

/** Mark the page the agent's bsk session drives, so the take films that tab and no other; says which bsk has it. */
async function markTab(session: string, nonce: string) {
  let why = ''
  for (const b of takeBsks()) {
    try {
      await run(b.bin, ['evaluate', probeExpression(nonce), '--session', session, '--json'], { env: b.env, timeout: 30_000, windowsHide: true })
      return b
    } catch (e) { why ||= String((e as { stderr?: string }).stderr || (e as Error).message).trim().slice(-300) }
  }
  throw new Error(`No browser has a bsk session ${session}${why ? ` (${why})` : ''}. Start one (chrome-bsk session start --json) and pass its id.`)
}

/** Film the session's tab the best way available, with nothing for the user to set up: CDP screencast in Manul's browser,
 *  or in the user's Chrome when its remote debugging is on; otherwise through their bsk's screenshots. */
async function startTake(p: Project, o: { session: string }) {
  if (takes.get(p.dir)) throw new Error('A take is already recording in this project. Stop it first (stopping keeps what it recorded).')
  if (existsSync(haltFile())) throw new Error(HALTED)
  const nonce = randomUUID()
  const b = await markTab(o.session, nonce)
  let capture: Capture
  const viaBsk = () => new BskCapture({ bin: b.bin, env: b.env, session: o.session, yieldDir: yieldDir(), haltFile: haltFile() })
  if (b.browser === 'manul') {
    if (!browser) throw new Error('Manul\'s browser is not running.')
    capture = new ScreencastCapture((await browser.film(nonce)).cdp)
  } else if (!process.env.MANUL_CHROME_BSK_HOME && devToolsPortFiles().some(f => existsSync(f))) { // (tests stand Manul's browser in for Chrome)
    capture = await chromeCdp(nonce, { timeoutMs: 30_000 }).then(cdp => new ScreencastCapture(cdp) as Capture)
      .catch(e => { console.info(`walkthrough: filming through bsk (${(e as Error).message.slice(0, 120)})`); return viaBsk() })
  } else capture = viaBsk()
  const id = `w${Date.now().toString(36)}`, rel = takeDir(id)
  await mkdir(join(p.dir, rel), { recursive: true })
  // screencast frames are 2× the viewport; bsk's are at the screen's own scale (it sizes the window, see BskCapture)
  return takes.start(p.dir, { capture, dir: join(p.dir, rel), rel, id, browser: b.browser, scale: 2, log: s => console.info(s) })
}

async function composeWalk(p: Project, req: ComposeRequest, title: string, signal?: AbortSignal) {
  let voiced = 0
  const r = await asJob('Making the walkthrough', 'render', j => composeWalkthrough(p.dir, req, {
    speak: async (text, voice, style, name) => { voiced++; return (await generate('voice', { text, voice, style }, p.dir, name, undefined, signal)).rel },
    progress: (f, d) => j.progress(f, d), signal,
  }), { project: p.dir, doneTitle: 'Walkthrough ready' })
  const version = await proposeFile(p, join(p.dir, r.file), title)
  return { version, duration: r.plan.duration, outline: r.outline, cut: r.plan.cut, spedUp: r.plan.spedUp, held: r.plan.held, voiced }
}

/** A file in renders/ becomes the proposal (replacing one not decided yet). */
async function proposeFile(p: Project, abs: string, title: string) {
  if (p.proposal) p.versions = p.versions.filter(v => v.id !== p.proposal)
  const v = await Projects.addVersion(p, abs, title, 'agent')
  p.proposal = v.id
  await checkpoint(p, `Proposed “${title}”`)
  ensureProxy(p, v.path)
  return v.id
}

const demosRunning = new Map<string, AbortController>()
async function composeDemo(p: Project, req: DemoOptions, signal?: AbortSignal) {
  if (demosRunning.has(p.dir)) throw new Error('A demo is already being prepared for this project.')
  if (p.proposal) throw new Error('Accept or reject the current preview first.')
  const controller = new AbortController()
  demosRunning.set(p.dir, controller)
  signal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
  const current = p.current, before = p.timeline
  try {
    const plan = await asJob('Syncing and cleaning your demo', 'render', async j => {
      j.progress(null, 'Matching shared audio, protecting speech and screen actions')
      return planDemo(p, req, media => transcriptOf(p, media, { ask: true }), signal)
    }, { project: p.dir, doneTitle: 'Demo plan ready' })
    if (p.current !== current || p.timeline !== before || p.proposal) throw new Error('The edit changed while the demo was being prepared. Run Auto Demo again on the updated project.')
    const title = `Synced demo${plan.removed > 0.1 ? ` · ${Math.round(plan.removed)} s of dead time removed` : ''}`
    const version = await proposeTimeline(p, plan.timeline, title, 'agent', true, signal)
    return { version, sync: plan.sync, duration: plan.duration, removed: plan.removed, audio: plan.audio, warning: plan.warning, summary: plan.timeline.demo!.summary, layout: plan.timeline.demo!.layout }
  } finally { demosRunning.delete(p.dir) }
}

// ---------------------------------------------------------------- the edit, by hand
// Splits, cuts, trims, moves and volume change the project's timeline at once: the film plays from its pieces and is
// rendered only when it is exported or saved as a version. Every change can be undone (per project, until a version
// is put on screen); the project's history gets one point a little after a run of edits.
/** back/forward: the edits to undo and redo; since: what was done since the version (undone ones taken off), for its title */
/** head: the edit as the last change left it (replaced since by a version, History…: the stack no longer applies) */
type Undo = { base: string; head?: Timeline; back: { tl: Timeline; what: string }[]; forward: { tl: Timeline; what: string }[]; since: string[] }
const undos = new Map<string, Undo>()
function undoOf(p: Project) {
  let u = undos.get(p.dir)
  if (!u || u.base !== p.current || (u.head && u.head !== p.timeline)) { u = { base: p.current, back: [], forward: [], since: [] }; undos.set(p.dir, u) }
  return u
}
const summary = (what: string[]) => (what.length <= 3 ? what.join(', ') : `${what.slice(0, 2).join(', ')} and ${what.length - 2} more edits`)

const pendingNotes = new Map<string, { timer?: NodeJS.Timeout; what: string[] }>()
function noteLater(p: Project, what: string) {
  const n = pendingNotes.get(p.dir) || { what: [] }
  clearTimeout(n.timer)
  n.what.push(what)
  n.timer = setTimeout(() => { pendingNotes.delete(p.dir); new History(p.dir).record(summary(n.what)).catch(e => console.warn('history', e)) }, 2000)
  pendingNotes.set(p.dir, n)
}

async function editTimeline(p: Project, edits: Edit[]) {
  if (p.proposal) throw new Error('Accept or reject the proposed version first, then edit.')
  const maxOf = (it: Item) => (it.kind === 'media' ? p.media[it.src]?.duration : p.clips?.[it.clip]?.duration)
  const before = p.timeline!
  let tl = before
  for (const e of edits) {
    if (e.op === 'insert' && !(p.media[e.src]?.width && p.media[e.src].duration > 0)) throw new Error(`${e.src.split('/').pop()} isn't footage that can go in the film.`)
    tl = applyEdit(tl, e, maxOf)
  }
  if (sameCut(before, tl)) return p
  const u = undoOf(p)
  const what = summary(edits.map(describeEdit))
  u.back.push({ tl: before, what })
  if (u.back.length > 200) u.back.shift()
  u.forward = []
  u.since.push(what)
  p.timeline = u.head = tl
  await publish(p)
  noteLater(p, what)
  return p
}

async function undoEdit(p: Project, redo: boolean) {
  if (p.proposal) throw new Error('Accept or reject the proposed version first.')
  const u = undoOf(p)
  const step = (redo ? u.forward : u.back).pop()
  if (!step) return p
  ;(redo ? u.back : u.forward).push({ tl: p.timeline!, what: step.what })
  if (redo) u.since.push(step.what)
  else u.since.splice(u.since.lastIndexOf(step.what), 1)
  p.timeline = u.head = step.tl
  await publish(p)
  noteLater(p, `${redo ? 'Redo' : 'Undo'} ${step.what.charAt(0).toLowerCase()}${step.what.slice(1)}`)
  return p
}

/** Render the edit into a version and put it on screen (the user's own work: no before/after). */
async function renderEdit(p: Project) {
  if (!Projects.edited(p)) return p.current
  const proposed = p.versions.find(v => v.id === p.proposal)
  if (proposed?.timeline && sameCut(proposed.timeline, p.timeline)) {
    Projects.accept(p, proposed.id)
    await checkpoint(p, `Saved “${proposed.title}”`)
    return proposed.id
  }
  const u = undoOf(p)
  const id = await proposeTimeline(p, p.timeline!, u.since.length ? summary(u.since) : 'Edited by hand', 'user', false)
  return id
}

// ---------------------------------------------------------------- export
export type ExportRequest = { preset: ExportOptions['preset']; fit?: 'pad' | 'crop'; captions: 'none' | 'burn' | 'srt'; captionColor?: string }

/** Export the version on screen to outAbs (and an .srt next to it when asked). */
async function exportFilm(p: Project, req: ExportRequest, outAbs: string, by: 'user' | 'agent', version = p.current) {
  const started = Date.now()
  const done = (ok: boolean) => telemetry.track('export finished', { preset: req.preset, captions: req.captions, by, ok, seconds: (Date.now() - started) / 1000 })
  const v = p.versions.find(x => x.id === version)!
  const info = p.media[v.path]
  return asJob(`Exporting ${pathBasename(outAbs)}`, 'render', async j => {
    let srt: string | undefined
    if (req.captions !== 'none') {
      j.progress(null, 'Captions')
      const largeCache = Whisper.transcriptPathFor(v.path).replace(/\.json$/, '.large-v3.json')
      const t = await Whisper.exportTranscript(join(p.dir, v.path), join(p.dir, largeCache), `Transcribing export captions with Large-v3`, p.dir)
        || await transcriptOf(p, v.path, { ask: true })
      srt = outAbs.replace(/\.[^.]+$/, '.srt')
      await writeFile(srt, toSrt(t ? captionCues(t) : []))
    }
    const tmpSrt = req.captions === 'burn' && srt ? join(p.dir, '.manul-captions.srt') : undefined
    if (tmpSrt) await writeFile(tmpSrt, await readFile(srt!, 'utf8'))
    const args = exportArgs({ preset: req.preset, fit: req.fit, input: join(p.dir, v.path), out: outAbs, source: info,
      burnCaptions: tmpSrt ? '.manul-captions.srt' : undefined, fontsDir: join(LIB, 'fonts'), captionColor: req.captionColor })
    try {
      await new Promise<void>((ok, fail) => {
        const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats', ...args], { cwd: p.dir, windowsHide: true })
        ff.once('error', fail)
        let err = ''
        ff.stdout.on('data', d => { const m = /out_time_ms=(\d+)/.exec(String(d)); if (m && info.duration) j.progress(Math.min(1, Number(m[1]) / 1e6 / info.duration)) })
        ff.stderr.on('data', d => { err += d })
        ff.on('close', c => (c === 0 ? ok() : fail(new Error(err.slice(-1500)))))
      })
    } finally {
      if (tmpSrt) await rm(tmpSrt, { force: true })
      if (req.captions === 'burn' && srt) await rm(srt, { force: true })
    }
    return { file: outAbs, srt: req.captions === 'srt' ? srt : undefined }
  }, { project: p.dir, doneTitle: `Exported ${pathBasename(outAbs)}` }).then(r => { done(true); return r }, e => { done(false); throw e })
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`
const describe = (a: Anchor) =>
  `@ ${fmt(a.t0)}${a.t1 != null ? `–${fmt(a.t1)}` : ''}${a.box ? `, box ${[a.box.x, a.box.y, a.box.w, a.box.h].map(n => n.toFixed(3)).join(',')}` : ''}` +
  (a.clip ? `, clip ${a.clip.id}${a.clip.element ? ` element ${a.clip.element}` : ''}` : '')

type AgentMessage = { text: string; anchor?: Anchor; still?: string; files?: string[] }

// A message to the agent, optionally anchored (time / range / box) with a frame still (JPEG data URL).
// What the user attached (files in media/, versions of the film, motion clips) follows the text, each with what it is.
async function sendToAgent(dir: string, msg: AgentMessage) {
  const p = projectOf(dir)
  const videos = Object.fromEntries(Object.keys(p.files || {}).filter(f => p.files![f].kind === 'video' && p.media[f]).map(f => [f, p.media[f]]))
  const body = joinAttached(msg.text, Files.refLines(msg.files || [], p)) + demoHint(msg.files || [], videos, skills.enabled().some(s => s.id === 'demo-editor'))
  let content: string | Record<string, unknown>[] = body
  if (msg.anchor) {
    const jpeg = msg.still ? Buffer.from(msg.still.split(',')[1], 'base64') : undefined
    const n = await Projects.addNote(p, { anchor: msg.anchor, text: msg.text }, jpeg)
    await checkpoint(p, `Note: ${msg.text.slice(0, 60)}`)
    content = [{ type: 'text', text: `[note ${n.id} ${describe(msg.anchor)}] ${body}` }]
    if (jpeg) content.push({ type: 'image', data: jpeg.toString('base64'), mimeType: 'image/jpeg' })
  }
  // a new conversation is named after its first message
  const rec = p.conversations?.find(c => c.id === p.conversation)
  if (rec && rec.title === 'New conversation') { rec.title = (msg.text || (msg.files || []).map(f => f.split('/').pop()).join(', ')).replace(/\s+/g, ' ').trim().slice(0, 48) || rec.title; await publish(p) }
  rmSync(haltFile(), { force: true }) // the user replied: the browser is the agent's again
  await agent!.send(dir, content)
}

// ---------------------------------------------------------------- IPC
function wire() {
  ipcMain.handle('mobile:status', () => mobile.status())
  ipcMain.handle('mobile:start', () => startBridgeAndMesh())
  ipcMain.handle('mobile:stop', () => { stopMesh(); return mobile.stop() })
  ipcMain.handle('worker:status', () => workerClient.status())
  ipcMain.handle('worker:discover', () => accountWorkers())
  ipcMain.handle('worker:lease', async (_e, opts?: { projectId?: string; workerId?: string }) => {
    const w = await leaseAccountWorker(opts)
    return workerClient.connect(w)
  })
  ipcMain.handle('worker:release', async (_e, id: string) => {
    await releaseAccountWorker(id)
    return workerClient.remove(id)
  })
  ipcMain.handle('worker:pair', (_e, input: { url: string; code: string; name?: string }) => workerClient.pair(input))
  ipcMain.handle('worker:connect', (_e, w: SavedWorker) => workerClient.connect(w))
  ipcMain.handle('worker:disconnect', () => workerClient.disconnect())
  ipcMain.handle('worker:remove', (_e, id: string) => workerClient.remove(id))
  ipcMain.handle('worker:pull', (_e, remoteDir: string) => workerClient.pullProject(remoteDir))
  ipcMain.handle('worker:push', (_e, localDir: string) => workerClient.pushProject(localDir))
  ipcMain.handle('mobile:revoke', (_e, id: string) => mobile.revoke(id))
  ipcMain.handle('mobile:export', async (_e, dir: string, req: ExportRequest) => {
    const p = projectOf(dir)
    await mkdir(join(p.dir, 'exports'), { recursive: true })
    const version = await renderEdit(p)
    const result = await exportFilm(p, req, join(p.dir, 'exports', `mobile-${randomUUID()}.mp4`), 'user', version)
    return { file: relativeProjectPath(p.dir, result.file), ...(result.srt ? { srt: relativeProjectPath(p.dir, result.srt) } : {}) }
  })
  const onboarding = new OnboardingStore()
  ipcMain.handle('onboarding:settings-opened', () => onboarding.opened())
  ipcMain.handle('onboarding:settings-finish', (_e, status: 'completed' | 'skipped') => onboarding.finish(status))
  ipcMain.handle('app:info', () => ({ version: app.getVersion(), platform: process.platform, projectsRoot: Projects.projectsRoot() }))
  ipcMain.handle('update:state', () => updates?.state())
  ipcMain.handle('update:check', () => updates?.check())
  ipcMain.handle('update:install', () => updates?.install())
  ipcMain.handle('app:notices', () => shell.openPath(app.isPackaged ? join(process.resourcesPath, 'THIRD_PARTY_NOTICES.md') : join(import.meta.dirname, '../../THIRD_PARTY_NOTICES.md')))
  ipcMain.handle('telemetry:state', () => telemetryState())
  ipcMain.handle('telemetry:set', (_e, choice: { usage: boolean; crashes: boolean }) => {
    const usage = choice?.usage === true && telemetry.available
    setConfig({ telemetry: { usage, crashes: choice?.crashes === true && CRASHES_AVAILABLE, asked: true } })
    telemetry.setEnabled(usage)
    return telemetryState()
  })
  ipcMain.handle('tools:status', () => toolStatus())
  ipcMain.handle('tools:list', () => Tools.listTools())
  ipcMain.handle('tools:install', (_e, id: string) => Tools.install(id))
  ipcMain.handle('tools:remove', (_e, id: string) => Tools.remove(id))
  ipcMain.handle('jobs:list', () => listJobs())
  const skillState = () => ({ skills: skills.list(), enabled: skills.enabled().map(k => k.id), profile: skills.profile(), profiles: skills.profiles() })
  ipcMain.handle('skills:state', () => skillState())
  ipcMain.handle('skills:enable', (_e, id: string, on: boolean) => { skills.setEnabled(id, on); return skillState() })
  ipcMain.handle('skills:profile', (_e, id: string) => { skills.useProfile(id); return skillState() })
  ipcMain.handle('skills:newProfile', (_e, name: string) => { const p = skills.createProfile(name); skills.useProfile(p.id); return skillState() })
  ipcMain.handle('memory:list', () => memory.list())
  ipcMain.handle('memory:save', (_e, name: string, description: string, body: string) => { memory.remember(name, description, body); return memory.list() })
  ipcMain.handle('memory:forget', (_e, name: string) => { memory.forget(name); return memory.list() })
  ipcMain.handle('whisper:status', () => Whisper.whisperStatus())
  ipcMain.handle('whisper:set', (_e, c) => Whisper.setWhisper(c))
  ipcMain.handle('whisper:pick', async (_e, what: 'binary' | 'model') => {
    const r = await dialog.showOpenDialog(win!, what === 'model'
      ? { title: 'Choose a whisper.cpp model', properties: ['openFile'], filters: [{ name: 'ggml model', extensions: ['bin'] }] }
      : { title: 'Choose the whisper-cli program', properties: ['openFile'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle('transcript:get', async (_e, dir: string, mediaRel: string, make: boolean) => transcriptOf(projectOf(dir), mediaRel, { ask: make }))
  ipcMain.handle('media:thumbnails', (_e, dir: string, src: string, count: number, start?: number, end?: number) => {
    const p = projectOf(dir)
    const info = p.media[src]
    if (!info || !info.width || !info.height) return []
    return thumbnails(p.dir, src, info.duration, count, start, end, info.fps)
  })
  ipcMain.handle('consent:list', () => [...consents.values()].map(c => c.req))
  ipcMain.handle('consent:answer', (_e, id: string, ok: boolean) => {
    const c = consents.get(id)
    consents.delete(id)
    c?.answer(ok)
    send('consent', [...consents.values()].map(x => x.req))
  })
  ipcMain.handle('keys:list', () => keyStatus())
  ipcMain.handle('keys:set', (_e, name: string, value: string) => { setKey(name, value); agent?.keysChanged(); return keyStatus() })
  // signing in to Manul: the browser, then back here with the person's Manul key (account.ts)
  ipcMain.handle('account:status', () => accountStatus())
  ipcMain.handle('account:signIn', async () => {
    const s = await signIn(url => shell.openExternal(url))
    agent?.keysChanged()
    app.focus({ steal: true })
    return s
  })
  ipcMain.handle('account:cancel', () => cancelSignIn())
  ipcMain.handle('account:signOut', () => { const s = signOut(); agent?.keysChanged(); return s })
  ipcMain.handle('account:balance', () => balance())
  ipcMain.handle('account:checkout', (_e, what: { plan: string } | { topup: string }) => checkout(url => shell.openExternal(url), what))
  ipcMain.handle('account:billing', () => manageBilling(url => shell.openExternal(url)))
  // custom model providers (any OpenAI/Anthropic-compatible endpoint), and importing the ones omp already has
  const providersState = () => ({ providers: providerInfo(), omp: ompAvailable() })
  ipcMain.handle('providers:list', () => providersState())
  ipcMain.handle('providers:save', (_e, p, key?: string | null, replacing?: string) => { saveProvider(p, key, replacing); agent?.keysChanged(); return providersState() })
  ipcMain.handle('providers:remove', (_e, id: string) => { removeProvider(id); agent?.keysChanged(); return providersState() })
  ipcMain.handle('providers:import-omp', () => { const added = importOmp(); agent?.keysChanged(); return { ...providersState(), added } })
  ipcMain.handle('agent:ready', async () => !!agent && (await agent.hasModel()))

  ipcMain.handle('project:recent', async () => {
    const local = Projects.recent()
    if (!workerClient.active()) return local
    const remote = (await workerClient.refreshProjects().catch(() => [])) as RecentProject[]
    const seen = new Set(remote.map(r => r.dir))
    return [...remote, ...local.filter(l => !seen.has(l.dir))]
  })
  ipcMain.handle('tabs:get', () => getConfig().tabs || { open: [], active: null })
  ipcMain.handle('tabs:set', (_e, tabs: { open: string[]; active: string | null }) => { setConfig({ tabs }) })
  ipcMain.handle('theme:set', (_e, theme: 'light' | 'dark' | 'system') => {
    setConfig({ theme })
    nativeTheme.themeSource = theme
    win?.setBackgroundColor(windowBackground())
  })
  ipcMain.handle('project:pick', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose project files',
      properties: ['openFile', 'multiSelections', ...(process.platform === 'darwin' ? ['openDirectory' as const] : [])],
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('project:create', async (_e, files: string | string[], model?: Project['model']) => {
    const sources = typeof files === 'string' ? [files] : files
    if (workerClient.active()) {
      let created: Project | undefined
      for (const src of sources) {
        created = (await workerClient.uploadFile(src, created?.dir)) as Project
      }
      if (!created) throw new Error('Failed to create project on worker.')
      return created
    }
    const created = await asJob(`Importing ${sources.length === 1 ? 'project files' : `${sources.length} items`}`, 'import', j => {
      return Projects.createFromFiles(sources, (done, total, file) => j.progress(done / total, `${done} of ${total} · ${file}`), model)
    }, { doneTitle: 'Project files imported' })
    const p = await openProject(created.dir)
    telemetry.track('project created', {})
    await checkpoint(p, `Imported ${sources.length === 1 ? pathBasename(sources[0]) : `${Object.keys(p.files || {}).length} files`}`)
    for (const rel of Object.keys(p.files || {})) { ensureProxy(p, rel); autoTranscribe(p, rel) }
    return p
  })
  ipcMain.handle('project:createMotion', async (_e, o: Parameters<typeof Projects.createMotion>[0]) => {
    if (workerClient.active()) {
      return (await workerClient.rpc('project:createMotion', [o])) as Project
    }
    const created = await asJob('Setting up the canvas', 'import', () => Projects.createMotion(o), { doneTitle: 'Canvas ready' })
    const p = await openProject(created.dir)
    if (!o.walkthrough) telemetry.track('motion project created', { example: o.example || 'none', aspect: o.aspect, reference: !!o.reference })
    await checkpoint(p, o.walkthrough ? 'Started a product walkthrough' : 'Started a motion video')
    for (const rel of Object.keys(p.files || {})) if (rel !== p.motion?.canvas && rel !== p.walkthrough?.canvas) { ensureProxy(p, rel); autoTranscribe(p, rel) }
    return p
  })
  ipcMain.handle('gallery:list', () => Gallery.examples())
  ipcMain.handle('project:open', (_e, dir: string) => openProject(dir))
  ipcMain.handle('preview:prepare', (_e, dir: string, media: string, retry = false) => {
    const p = projectOf(dir)
    if (!p.media[media]) throw new Error('This video is not part of the project.')
    previews.ensure(p, media, retry).catch(e => console.warn('preview state failed', e))
    return previews.state(dir, media)
  })
  ipcMain.handle('project:close', (_e, dir: string) => { agent?.close(dir); open.delete(dir) })
  ipcMain.handle('project:delete', async (_e, dir: string) => {
    const p = open.get(dir) || await Projects.load(dir)
    await agent?.stop(dir)
    await Projects.deleteProject(p, abs => shell.trashItem(abs))
    agent?.close(dir)
    open.delete(dir)
  })
  ipcMain.handle('project:reveal', (_e, dir: string) => shell.openPath(dir))
  ipcMain.handle('project:downloadFile', async (_e, dir: string, rel: string) => {
    const file = await artifactPath(projectOf(dir).dir, rel)
    const result = await dialog.showSaveDialog(win!, { title: 'Download file', defaultPath: join(app.getPath('downloads'), basename(file)) })
    if (result.canceled || !result.filePath) return null
    if (resolve(result.filePath) !== file) await copyFile(file, result.filePath)
    return result.filePath
  })
  ipcMain.handle('project:revealFile', async (_e, dir: string, rel: string) => {
    shell.showItemInFolder(await artifactPath(projectOf(dir).dir, rel))
  })
  // ---------------------------------------------------------------- the browser panel and which browser the agent drives
  ipcMain.handle('browser:state', () => browser?.state() ?? { tabs: [], active: null, bsk: { connected: false, status: 'starting' } })
  ipcMain.on('browser:bounds', (_e, r) => browser?.setBounds(r))
  ipcMain.handle('browser:navigate', (_e, url: string) => browser?.navigate(url))
  ipcMain.handle('browser:back', () => browser?.back())
  ipcMain.handle('browser:forward', () => browser?.forward())
  ipcMain.handle('browser:reload', () => browser?.reload())
  ipcMain.handle('browser:select', (_e, id: number) => browser?.activate(id))
  ipcMain.handle('browser:close', (_e, id: number) => browser?.closeTab(id))
  ipcMain.handle('browser:new', () => { browser?.createTab({ url: 'https://www.google.com/' }) })
  ipcMain.handle('browser:mode', () => browserMode())
  ipcMain.handle('browser:set-mode', (_e, mode: BrowserMode) => { setConfig({ browser: { mode: mode === 'chrome' ? 'chrome' : 'manul' } }); return browserMode() })
  ipcMain.handle('browser:chrome', () => chromeBsk({ userHome: homedir(), bundled: BSK_BIN }))
  // any file, a folder or a .zip; returns the new paths in media/
  ipcMain.handle('project:import', async (_e, dir: string, file: string) => {
    const p = projectOf(dir)
    const rels = await Projects.addFiles(p, file)
    send('project', p)
    for (const rel of rels) { ensureProxy(p, rel); autoTranscribe(p, rel) }
    return rels
  })
  // into the Trash, with what Manul made from them; files the film uses stay (with the reason)
  ipcMain.handle('project:removeFiles', async (_e, dir: string, rels: string[]) => {
    const p = projectOf(dir)
    const r = await Projects.removeFiles(p, rels, abs => shell.trashItem(abs))
    if (r.removed.length) await checkpoint(p, `Removed ${r.removed.length === 1 ? r.removed[0] : `${r.removed.length} files`}`)
    return r
  })
  ipcMain.handle('project:pickFiles', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Add files',
      buttonLabel: 'Add',
      // macOS can pick files and folders in one dialog; elsewhere asking for both shows only folders
      properties: ['openFile', 'multiSelections', ...(process.platform === 'darwin' ? ['openDirectory' as const] : [])],
    })
    return r.canceled ? [] : r.filePaths
  })
  ipcMain.handle('project:decide', async (_e, dir: string, accept: boolean) => {
    return decideVersion(projectOf(dir), accept)
  })
  ipcMain.handle('project:current', async (_e, dir: string, id: string) => {
    const p = projectOf(dir)
    Projects.accept(p, id)
    await checkpoint(p, `Switched to “${p.versions.find(v => v.id === id)?.title}”`)
    return p
  })
  ipcMain.handle('export:run', async (_e, dir: string, req: ExportRequest) => {
    const p = projectOf(dir)
    const suffix = { original: '', landscape: '-16x9', vertical: '-9x16', square: '-1x1' }[req.preset]
    const r = await dialog.showSaveDialog(win!, { title: 'Export', defaultPath: join(app.getPath('videos'), `${p.title}${suffix}.mp4`), filters: [{ name: 'MP4 video', extensions: ['mp4'] }] })
    if (r.canceled || !r.filePath) return null
    const version = await renderEdit(p) // hand edits first become a version
    return exportFilm(p, req, r.filePath, 'user', version)
  })
  ipcMain.handle('export:reveal', (_e, file: string) => shell.showItemInFolder(file))
  ipcMain.handle('mix:speech', async (_e, dir: string, versionId?: string) => {
    const p = projectOf(dir)
    // 'edit': the edit by hand, playing from its pieces
    const tl = versionId === 'edit' ? p.timeline! : p.versions.find(v => v.id === (versionId || p.current))?.timeline || p.timeline!
    return regionsOnTimeline(tl, await transcriptsFor(p, tl))
  })
  ipcMain.handle('history:log', (_e, dir: string) => new History(projectOf(dir).dir).log())
  ipcMain.handle('history:restore', async (_e, dir: string, id: string) => {
    const { clips } = await new History(dir).restore(id)
    const p = await Projects.load(dir)
    open.set(dir, p)
    for (const c of clips) if (p.clips?.[c]) await bakeClip(p, c)
    await publish(p)
    return p
  })

  ipcMain.handle('agent:send', (_e, dir: string, msg: AgentMessage) => sendToAgent(dir, msg))
  ipcMain.handle('clip:save', (_e, dir: string, id: string, title: string, html: string, dur: number, overlay?: boolean) => saveClip(projectOf(dir), id, title, html, dur, !!overlay))
  ipcMain.handle('clip:overlay', (_e, dir: string, id: string, at: number, title: string) => {
    const p = projectOf(dir)
    return proposeTimeline(p, addOverlay(p.timeline!, { clip: id, start: at, dur: p.clips![id].duration }), title)
  })
  // the edit (the agent's, and its undo), and saving it as a version
  ipcMain.handle('timeline:edit', (_e, dir: string, edits: Edit[]) => editTimeline(projectOf(dir), edits))
  ipcMain.handle('timeline:undo', (_e, dir: string, redo: boolean) => undoEdit(projectOf(dir), redo))
  ipcMain.handle('timeline:render', (_e, dir: string) => renderEdit(projectOf(dir)))
  ipcMain.handle('demo:create', (_e, dir: string, req: DemoOptions) => composeDemo(projectOf(dir), req))
  ipcMain.handle('demo:cancel', (_e, dir: string) => { projectOf(dir); demosRunning.get(dir)?.abort(new Error('Demo stopped.')) })
  ipcMain.handle('clip:insert', async (_e, dir: string, id: string, at: number, title: string) => {
    const p = projectOf(dir)
    const c = p.clips?.[id]
    if (!c) throw new Error(`No clip "${id}".`)
    return proposeTimeline(p, insertAt(p.timeline!, at, { kind: 'clip', clip: id, dur: c.duration }).timeline, title)
  })
  // The user dragged an element of a clip: write it into the HTML, re-render the clip and the film (their edit, applied).
  ipcMain.handle('clip:move', async (_e, dir: string, id: string, element: string, dx: number, dy: number) => {
    const p = projectOf(dir)
    const file = join(p.dir, 'clips', id, 'clip.html')
    await writeFile(file, moveElement(await readFile(file, 'utf8'), element, dx, dy))
    await bakeClip(p, id)
    if (p.timeline?.items.some(i => i.kind === 'clip' && i.clip === id) || p.timeline?.overlays?.some(o => o.clip === id)) await proposeTimeline(p, p.timeline, `Moved ${element} in ${id}`, 'user')
    return p
  })
  ipcMain.handle('clip:render', (_e, dir: string, id: string) =>
    asJob(`Rendering clip ${id}`, 'render', j => renderClip(projectOf(dir).dir, id, j), { project: dir, doneTitle: `Rendered clip ${id}` }))
  ipcMain.handle('agent:models', async (_e, dir?: string) => ({ models: (await agent?.models()) || [], current: (await agent?.model(dir)) || null }))
  ipcMain.handle('agent:setModel', async (_e, dir: string, model: { provider: string; modelId: string } | null) => {
    const p = projectOf(dir)
    p.model = model || undefined
    await publish(p)
    return agent?.model(dir)
  })
  ipcMain.handle('agent:newConversation', async (_e, dir: string) => { const p = projectOf(dir); useConversation(p, await agent!.newConversation(dir)); await publish(p); return p })
  ipcMain.handle('agent:switch', async (_e, dir: string, id: string) => { const p = projectOf(dir); useConversation(p, await agent!.open(dir, id)); await publish(p); return p })
  ipcMain.handle('agent:rename', async (_e, dir: string, id: string, title: string) => {
    const p = projectOf(dir)
    p.conversations = p.conversations?.map(c => (c.id === id ? { ...c, title: title.trim() || c.title } : c))
    await publish(p)
    return p
  })
  ipcMain.handle('agent:stop', (_e, dir: string) => agent?.stop(dir))
  ipcMain.handle('agent:attach', async (_e, dir: string) => { await openProject(dir) })
}

// ---------------------------------------------------------------- crash reports and usage statistics (both opt-in)
function telemetryState(): TelemetryState {
  const c = getConfig().telemetry
  return { usage: !!c?.usage, crashes: !!c?.crashes, asked: !!c?.asked, available: { usage: telemetry.available, crashes: CRASHES_AVAILABLE } }
}

/** One 'agent run' per agent turn: the model, which of Manul's tools it called, how it ended. Never what was said. */
const runs = new Map<string, { started: number; tools: string[]; failed: boolean }>()
function agentRuns(dir: string, e: BaseEvent) {
  if (e.type === 'RUN_FINISHED' || e.type === 'RUN_ERROR') {
    const p = open.get(dir)
    if (p) Projects.syncFiles(p).then(changed => { if (changed) return publish(p) }).catch(e => console.warn('generated files', e))
  }
  const r = runs.get(dir)
  if (e.type === 'RUN_STARTED') runs.set(dir, { started: Date.now(), tools: [], failed: false })
  else if (r && e.type === 'TOOL_CALL_START') r.tools.push(String((e as { toolCallName?: string }).toolCallName))
  else if (r && e.type === 'RUN_ERROR') r.failed = true
  else if (r && e.type === 'RUN_FINISHED') {
    runs.delete(dir)
    void agent?.model(dir).then(m => telemetry.track('agent run', {
      provider: m?.provider ?? '', model: m?.modelId ?? '', tools: [...new Set(r.tools)], toolCalls: r.tools.length,
      ok: !r.failed, seconds: (Date.now() - r.started) / 1000,
    })).catch(() => {})
  }
}

// ---------------------------------------------------------------- window
// The app icon. Packaged builds get it from build/ through electron-builder; in development set it by hand.
const ICON = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(import.meta.dirname, '../../build/icon.png')
/** The window's colour before the page paints: the sidebar's, light or dark. */
const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#0e0d0c' : '#fbfbf9')

function createWindow() {
  nativeTheme.themeSource = getConfig().theme || 'light'
  win = new BrowserWindow({
    ...(process.platform === 'linux' && existsSync(ICON) ? { icon: ICON } : {}),
    width: 1440, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: windowBackground(),
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 19 } } : {}),
    show: false,
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  win.on('closed', () => { win = null; if (!quitting) app.quit() })
  if (process.platform === 'win32') win.on('session-end', () => { bskd?.killNow() })
}

const startup = app.whenReady().then(async () => {
  if (quitting) return
  if (process.platform === 'darwin' && WORKER_MODE) app.dock?.hide()
  else if (process.platform === 'darwin' && !app.isPackaged && existsSync(ICON)) app.dock?.setIcon(ICON)
  protocol.handle('manul', serveMedia)
  setClipProtocol(serveMedia)
  loadKeys()
  telemetry = new UsageTelemetry({
    file: join(app.getPath('userData'), 'usage.json'), endpoint: __MANUL_TELEMETRY_URL__, token: __MANUL_POSTHOG_TOKEN__,
    enabled: () => !!getConfig().telemetry?.usage,
    focused: () => !!win?.isFocused() && !win.isMinimized(),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    context: { app_version: app.getVersion(), os: process.platform, arch: process.arch },
  })
  telemetry.start()
  telemetry.track('app opened', {})
  Tools.setOnInstalled((tool, ok) => telemetry.track('tool installed', { tool, ok }))
  memory = new Memory(join(app.getPath('userData'), 'memory'))
  const resources = app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../resources')
  skills = new Skills({ bundled: join(resources, 'skills'), profiles: join(app.getPath('userData'), 'profiles') })
  // skills come only from the bundle now: drop what the old over-the-air feed downloaded (a cache, never the user's)
  rmSync(join(app.getPath('userData'), 'skill-updates'), { recursive: true, force: true })
  wire()
  if (!WORKER_MODE) {
    buildMenu(() => win)
    updates = startUpdates(st => send('update', st), shutdown)
  }
  onJobs(jobs => send('jobs', jobs))
  if (!WORKER_MODE) createWindow()
  else {
    void startBridgeAndMesh({ waitForMesh: true }).then(st => {
      console.log(JSON.stringify({ worker: 'ready', addresses: st.addresses, tailscale: st.tailscale, code: st.code, fingerprint: st.fingerprint }))
    })
  }
  browserStartup = startBrowser(resources)
  // the agent's bsk (its browser setting's) and chrome-bsk (the user's own Chrome, where product walkthroughs are filmed)
  const agentBin = join(app.getPath('userData'), 'bin')
  mkdirSync(agentBin, { recursive: true })
  writeFileSync(join(agentBin, 'bsk'), bskScript({ name: 'bsk', stateDir: takeState() }), { mode: 0o755 })
  writeFileSync(join(agentBin, 'chrome-bsk'), bskScript({ name: 'chrome-bsk', bin: findUserBsk({ home: homedir(), bundled: BSK_BIN }) || BSK_BIN, bskHome: userBskHome(homedir()), stateDir: takeState() }), { mode: 0o755 })
  rmSync(takeState(), { recursive: true, force: true }) // marks and a halt a quit left
  mkdirSync(yieldDir(), { recursive: true })
  try {
    agent = await startAgent({
      // which browser the agent's bsk reaches: Manul's own (private daemon) unless the user chose their Chrome
      shellEnv: () => {
        const userBsk = findUserBsk({ home: homedir(), bundled: BSK_BIN })
        const env = agentEnv(browserMode(), { bundledDir: dirname(BSK_BIN), privateHome: bskd!.home, userHome: homedir(), userBsk, path: process.env.PATH || '' })
        // bsk and chrome-bsk are Manul's wrappers (bskScript); the bsk wrapper runs the setting's real one
        return { ...env, PATH: `${agentBin}${delimiter}${env.PATH}`, MANUL_BSK_BIN: browserMode() === 'chrome' ? userBsk || BSK_BIN : BSK_BIN }
      },
      browserPrompt: () => browserPrompt(browserMode()),
      // the agent's files and shell stay in the project: Manul's resources read-only, and the browser CLI's own state
      fence: (() => {
        const userBsk = findUserBsk({ home: homedir(), bundled: BSK_BIN })
        return { resources, extraRw: [privateHome(app.getPath('userData'), homedir()), userBskHome(homedir()), takeState()], extraRo: [agentBin, ...(userBsk ? [dirname(userBsk)] : [])] }
      })(),
      dbPath: join(app.getPath('userData'), 'agent.sqlite'),
      memory,
      skills,
      onEvent: (dir, e) => { agentRuns(dir, e); send('agui', dir, e) },
      bridge: {
        project: dir => open.get(dir),
        decideVersion: (dir, accept) => decideVersion(projectOf(dir), accept),
        composeDemo: (dir, req, signal) => composeDemo(projectOf(dir), req, signal),
        proposeVersion: (dir, abs, title) => proposeFile(projectOf(dir), abs, title),
        startTake: (dir, o) => startTake(projectOf(dir), o),
        take: dir => takes.get(dir),
        stopTake: dir => takes.stop(dir),
        browserHalted: () => (existsSync(haltFile()) ? HALTED : null),
        composeWalkthrough: (dir, req, title, signal) => composeWalk(projectOf(dir), req, title, signal),
        async resolveNote(dir, id, reply) {
          const p = projectOf(dir)
          const n = p.notes.find(x => x.id === id)
          if (n) { n.status = 'resolved'; n.reply = reply }
          await publish(p)
        },
        seek: (dir, t) => send('seek', dir, t),
        transcript: (dir, mediaRel) => transcriptOf(projectOf(dir), mediaRel, { ask: true }),
        speakers: async (dir, mediaRel, count) => {
          const p = projectOf(dir)
          const result = (await speakersOf(p, mediaRel, { make: true, count }))!
          return { result, file: p.speakers![mediaRel], names: p.speakerNames?.[mediaRel] || {} }
        },
        nameSpeakers: (dir, mediaRel, names) => nameSpeakers(projectOf(dir), mediaRel, names),
        saveClip: (dir, id, title, html, dur, overlay) => saveClip(projectOf(dir), id, title, html, dur, overlay),
        async overlayClip(dir, id, at, dur, title) {
          const p = projectOf(dir)
          const c = p.clips?.[id]
          if (!c) throw new Error(`No clip "${id}". Create it with create_clip (overlay: true) first.`)
          if (!c.overlay) throw new Error(`Clip "${id}" is full-frame; make it with overlay: true to lay it over the footage, or use insert_clip.`)
          return proposeTimeline(p, addOverlay(p.timeline!, { clip: id, start: at, dur: dur ?? c.duration }), title)
        },
        bakeClip: (dir, id) => bakeClip(projectOf(dir), id),
        async insertClip(dir, id, at, title) {
          const p = projectOf(dir)
          const c = p.clips?.[id]
          if (!c) throw new Error(`No clip "${id}". Create it with create_clip first.`)
          const { timeline } = insertAt(p.timeline!, at, { kind: 'clip', clip: id, dur: c.duration })
          return proposeTimeline(p, timeline, title)
        },
        async exportFilm(dir, req) {
          const p = projectOf(dir)
          await mkdir(join(p.dir, 'exports'), { recursive: true })
          const suffix = { original: '', landscape: '-16x9', vertical: '-9x16', square: '-1x1' }[req.preset]
          const version = await renderEdit(p) // an edit not rendered yet becomes a version first
          return exportFilm(p, req, join(p.dir, 'exports', `${p.title}${suffix}.mp4`), 'agent', version)
        },
        async setMix(dir, mix) {
          const p = projectOf(dir)
          if (Projects.edited(p)) { await editTimeline(p, [{ op: 'mix', mix }]); return 'Set the mix on the edit: the user hears it now; it renders with the edit.' }
          return `Mixed as version ${await applyMix(p, mix)}.`
        },
        editTimeline: (dir, edits) => editTimeline(projectOf(dir), edits),
        async importFiles(dir, abs) {
          const p = projectOf(dir)
          const rels = await Projects.addFiles(p, abs)
          await checkpoint(p, `Added ${rels.length === 1 ? rels[0] : `${rels.length} files`}`)
          for (const rel of rels) { ensureProxy(p, rel); autoTranscribe(p, rel) }
          return Files.attachedLines(rels, p.files || {}, 30, p.subtitles)
        },
        rerenderTimeline: (dir, title) => { const p = projectOf(dir); return proposeTimeline(p, p.timeline!, title) },
      },
    })
    send('agent:ready')
  } catch (err) {
    console.error('agent failed to start', err)
    send('notice', `The agent could not start: ${(err as Error).message}`)
  }
})

/** Manul's browser: its private bsk daemon (own home, own port) and the bundled extension running against its tabs. */
async function startBrowser(resources: string) {
  bskd = new BskDaemon({ bin: BSK_BIN, home: privateHome(app.getPath('userData'), homedir()), log: s => { if (/ERROR/.test(s)) console.warn('[bsk]', s.trim().slice(0, 300)) } })
  try {
    const { port } = await bskd.start()
    if (quitting) { await bskd.stop(); return }
    browser = new Browser({
      win: () => win, dataDir: join(app.getPath('userData'), 'browser'), extDir: join(resources, 'bsk-ext'),
      preloadDir: join(import.meta.dirname, '../preload'), storagePreset: extensionStorage(port), send,
    })
    await browser.startHost()
  } catch (e) {
    console.warn('browser', e)
    send('notice', `AgentShot's browser could not start: ${(e as Error).message}`)
  }
}

app.on('before-quit', e => {
  if (allowQuit) return
  e.preventDefault()
  if (quitRequested) return
  quitRequested = true
  // Internal browser/clip windows must not keep a closed desktop app alive.
  void shutdown().finally(() => { allowQuit = true; app.quit() })
})
app.on('window-all-closed', () => { if (!WORKER_MODE) app.quit() })
app.on('will-quit', () => { telemetry?.stop(); bskd?.killNow() })
app.on('activate', () => { if (!WORKER_MODE && !win && !quitting) createWindow() })
