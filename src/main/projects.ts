// Projects live in ~/Movies/Manul/<name>/ (the folder keeps the app's former name so existing projects stay put):
//   project.json   versions, notes, media info (the source of truth the UI and the agent share)
//   media/         imported files (copied, so the project is self-contained): footage, music, subtitles, documents…
//   renders/       the agent's outputs
//   notes/         frame stills attached to notes
//   fonts/         fonts the user added (copies, with AgentShot's Inter), the folder subtitles take fonts from
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join, posix } from 'node:path'
import { promisify } from 'node:util'
import { FFMPEG, FONTS_DIR, probe } from './media'
import * as Files from './files'
import { kindByName } from '../shared/file-kinds'
import { ASPECTS, type Aspect } from '../shared/motion-formats'
import { example as galleryExample, exampleVideo } from './gallery'
import { sameCut, timelineOfFile, type Timeline } from '../shared/timeline'
import { newestProjects } from '../shared/project-order'
import { filesystemSlug, toPortablePath } from '../shared/paths'
import { relativeProjectPath } from './paths'
import type { MediaInfo, Note, Project, RecentProject, Version } from '../shared/types'

const run = promisify(execFile)
const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
/** Motion videos run at 60 fps: smooth motion is the point, and they have no footage to match. */
const MOTION_FPS = 60
const slug = (s: string) => filesystemSlug(s)

export const projectsRoot = () => process.env.MANUL_PROJECTS || join(app.getPath('videos'), 'Manul')
const recentFile = () => join(app.getPath('userData'), 'recent.json')

export function recent(): RecentProject[] {
  try {
    const list = (JSON.parse(readFileSync(recentFile(), 'utf8')) as RecentProject[]).filter(r => existsSync(join(r.dir, 'project.json')))
    return newestProjects(list.map(r => {
      if (Number.isFinite(r.createdAt)) return r
      // Older recent.json entries only stored openedAt; recover the immutable creation date, not the last-opened date.
      try { return { ...r, createdAt: JSON.parse(readFileSync(join(r.dir, 'project.json'), 'utf8')).createdAt } }
      catch { return r }
    }))
  } catch { return [] }
}

function touchRecent(p: Project) {
  const thumb = existsSync(join(p.dir, 'thumb.jpg')) ? join(p.dir, 'thumb.jpg') : undefined
  const list = [{ id: p.id, title: p.title, dir: p.dir, createdAt: p.createdAt, openedAt: Date.now(), thumb }, ...recent().filter(r => r.dir !== p.dir).sort((a, b) => b.openedAt - a.openedAt)].slice(0, 12)
  writeFileSync(recentFile(), JSON.stringify(list, null, 1))
}

/** Move a whole project to the system Trash and remove it from the recent-project list. */
export async function deleteProject(p: Project, trash: (abs: string) => Promise<void>) {
  await trash(p.dir)
  writeFileSync(recentFile(), JSON.stringify(recent().filter(r => r.dir !== p.dir), null, 1))
}

/** A timeline that is just this media file, in its own size and frame rate (even sizes, sane rate). */
export const timelineOf = (src: string, info: MediaInfo) => timelineOfFile(src, info)

/** The edit was changed by hand (or by the agent's edit_timeline) since the version on screen was rendered. */
export function edited(p: Project) {
  const v = p.versions.find(x => x.id === p.current)
  if (!v || !p.timeline) return false
  return !sameCut(p.timeline, v.timeline ?? timelineOf(v.path, p.media[v.path]))
}

/** Make a version the one on screen; the timeline restarts from it. */
export function accept(p: Project, versionId: string) {
  const v = p.versions.find(x => x.id === versionId)
  if (!v) throw new Error(`no version ${versionId}`)
  p.current = v.id
  if (p.proposal === v.id) p.proposal = undefined
  p.timeline = v.timeline ? structuredClone(v.timeline) : timelineOf(v.path, p.media[v.path])
}

export async function load(dir: string): Promise<Project> {
  const p = JSON.parse(await readFile(join(dir, 'project.json'), 'utf8')) as Project
  // Older Windows projects stored native separators in every path, including lookup keys and saved timelines.
  if (process.platform === 'win32' || /^(?:[a-z]:[\\/]|\\\\)/i.test(p.dir)) {
    const timeline = (tl?: Timeline) => {
      if (!tl) return
      for (const item of tl.items) if (item.kind === 'media') item.src = toPortablePath(item.src)
      if (tl.mix?.music) tl.mix.music.src = toPortablePath(tl.mix.music.src)
      for (const v of tl.mix?.voiceovers || []) v.src = toPortablePath(v.src)
    }
    p.media = Object.fromEntries(Object.entries(p.media).map(([key, value]) => [toPortablePath(key), value]))
    for (const version of p.versions) {
      version.path = toPortablePath(version.path)
      if (version.dry) version.dry = toPortablePath(version.dry)
      timeline(version.timeline)
    }
    for (const note of p.notes) if (note.still) note.still = toPortablePath(note.still)
    for (const clip of Object.values(p.clips || {})) {
      clip.video = toPortablePath(clip.video)
      clip.poster = toPortablePath(clip.poster)
    }
    for (const key of ['proxies', 'transcripts', 'speakers'] as const) if (p[key]) p[key] = Object.fromEntries(Object.entries(p[key]).map(([k, v]) => [toPortablePath(k), toPortablePath(v)]))
    if (p.files) p.files = Object.fromEntries(Object.entries(p.files).map(([k, v]) => [toPortablePath(k), v]))
    timeline(p.timeline)
  }
  p.dir = dir
  if (!p.timeline) { const v = p.versions.find(x => x.id === p.current)!; p.timeline = timelineOf(v.path, p.media[v.path]) }
  touchRecent(p)
  return p
}

let saves = 0
/** Write project.json whole or not at all (edits by hand save often; a crash mid-write must not leave half a file). */
export async function save(p: Project) {
  const tmp = join(p.dir, `.project.json.${process.pid}.${++saves}.tmp`)
  await writeFile(tmp, JSON.stringify(p, null, 1))
  await rename(tmp, join(p.dir, 'project.json'))
}

/** A new project from picked or dropped files. Import the whole batch before opening it; the first playable video
 *  starts the timeline, and every other asset is available to the user and agent. */
export async function createFromFiles(files: string[], progress?: (done: number, total: number, file: string) => void, model?: Project['model']): Promise<Project> {
  const sources = [...new Set(files.filter(Boolean))]
  if (!sources.length) throw new Error('Choose files to start a project.')
  const file = sources.find(f => kindByName(f) === 'video') || sources[0]
  const title = basename(file, extname(file))
  let dir = join(projectsRoot(), slug(title))
  for (let n = 2; existsSync(dir); n++) dir = join(projectsRoot(), `${slug(title)}-${n}`)
  const p: Project = { id: id(), title, dir, createdAt: Date.now(), versions: [], current: '', notes: [], media: {}, files: {}, ...(model ? { model } : {}) }
  try {
    for (const sub of ['media', 'renders', 'notes', 'clips']) await mkdir(join(dir, sub), { recursive: true })
    for (const [index, src] of sources.entries()) {
      progress?.(index, sources.length, basename(src))
      for (const rel of await Files.copyIn(dir, src)) await register(p, rel)
      progress?.(index + 1, sources.length, basename(src))
    }
    const rel = Object.keys(p.files!).find(f => p.files![f].kind === 'video' && p.media[f]?.width > 0 && p.media[f]?.duration > 0)
    if (!rel) {
      const about = Object.values(p.files!)[0]
      throw new Error(sources.length === 1
        ? `${basename(file)} isn't a video AgentShot can play (${about?.summary || 'no playable video found'}). Include a video; other files can come with it.`
        : 'Include at least one video AgentShot can play. Photos, audio and other files can come with it.')
    }
    const info = p.media[rel]
    const v: Version = { id: id(), path: rel, title: 'Original', createdAt: Date.now(), by: 'import' }
    p.title = basename(rel, extname(rel))
    p.versions = [v]
    p.current = v.id
    p.timeline = timelineOf(rel, info)
    await run(FFMPEG, ['-y', '-ss', String(Math.min(1, info.duration / 2)), '-i', join(dir, rel), '-frames:v', '1', '-vf', 'scale=480:-2', join(dir, 'thumb.jpg')], { windowsHide: true }).catch(() => {})
    await save(p)
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
  touchRecent(p)
  return p
}

/** Start from one file (also used by existing import tools). */
export const createFromFile = (file: string) => createFromFiles([file])

/** A motion video from nothing: the film starts as one second of blank canvas in the chosen format (so the player,
 *  versions and tools work as for footage) and the agent replaces it with its scenes. A gallery example brings its
 *  prompt (read from the gallery when the agent runs) and its video as the reference; a reference video of the user's own
 *  is imported the same way.
 *  A product walkthrough starts the same way (16:9, 30 fps) until the agent proposes the first one it filmed. */
export async function createMotion(o: { title?: string; aspect: Aspect; length?: number; example?: string; reference?: string; files?: string[]; walkthrough?: boolean; model?: Project['model'] }): Promise<Project> {
  const ex = o.example ? galleryExample(o.example) : undefined
  if (o.example && !ex) throw new Error('That example is no longer in the gallery.')
  const title = o.title?.trim() || ex?.title || (o.walkthrough ? 'Product walkthrough' : 'Motion video')
  let dir = join(projectsRoot(), slug(title))
  for (let n = 2; existsSync(dir); n++) dir = join(projectsRoot(), `${slug(title)}-${n}`)
  const { width, height } = ASPECTS[o.aspect]
  const p: Project = { id: id(), title, dir, createdAt: Date.now(), versions: [], current: '', notes: [], media: {}, files: {}, ...(o.model ? { model: o.model } : {}) }
  try {
    for (const sub of ['media', 'renders', 'notes', 'clips']) await mkdir(join(dir, sub), { recursive: true })
    const canvas = 'media/canvas.mp4'
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=0x141312:s=${width}x${height}:r=${o.walkthrough ? 30 : MOTION_FPS}:d=1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', join(dir, canvas)], { windowsHide: true })
    await register(p, canvas)
    let reference: string | undefined
    const refSrc = o.reference || (ex ? await exampleVideo(ex.id) : undefined)
    if (refSrc) {
      if (kindByName(refSrc) !== 'video') throw new Error('A reference has to be a video.')
      reference = (await Files.copyIn(dir, refSrc))[0]
      await register(p, reference)
    }
    for (const f of o.files || []) for (const rel of await Files.copyIn(dir, f)) await register(p, rel)
    const v: Version = { id: id(), path: canvas, title: 'Blank canvas', createdAt: Date.now(), by: 'import' }
    p.versions = [v]
    p.current = v.id
    p.timeline = timelineOf(canvas, p.media[canvas])
    if (o.walkthrough) p.walkthrough = { canvas }
    else p.motion = { aspect: o.aspect, canvas, ...(o.length ? { length: o.length } : {}), ...(ex ? { example: { id: ex.id, title: ex.title, handle: ex.creator.handle, ...(ex.post ? { post: ex.post } : {}) } } : {}), ...(reference ? { reference } : {}) }
    await save(p)
  } catch (e) {
    await rm(dir, { recursive: true, force: true })
    throw e
  }
  touchRecent(p)
  return p
}

/** Record what a file in media/ is (and its probe, for footage, audio and images). */
export async function register(p: Project, rel: string) {
  const r = await Files.inspect(p.dir, rel, probe)
  p.files = { ...p.files, [rel]: r.info }
  if (r.media) p.media[rel] = r.media
  if (r.info.font) await projectFont(p, rel)
}

/** Subtitles (libass) load every file in their fonts folder, so they can't take fonts from media/ beside the footage:
 *  a font the user adds is also copied into the project's fonts/, with AgentShot's Inter beside it. */
async function projectFont(p: Project, rel: string) {
  const dir = join(p.dir, 'fonts')
  await mkdir(dir, { recursive: true })
  for (const f of readdirSync(FONTS_DIR).filter(f => /\.(ttf|otf)$/i.test(f))) if (!existsSync(join(dir, f))) await copyFile(join(FONTS_DIR, f), join(dir, f))
  if (!existsSync(join(dir, basename(rel)))) await copyFile(join(p.dir, rel), join(dir, basename(rel)))
}

/** Bring files into a project: a file of any kind, a folder (all its files) or a .zip (its contents). Returns their
 *  paths in media/. */
export async function addFiles(p: Project, src: string): Promise<string[]> {
  const rels = await Files.copyIn(p.dir, src)
  for (const rel of rels) await register(p, rel)
  await save(p)
  return rels
}

/** Bring one file into the project; its path in media/. */
export const importMedia = async (p: Project, file: string) => (await addFiles(p, file))[0]

/** Bring project.json's file list in line with media/ (files added or removed in Finder, projects made before the
 *  list existed). True when it changed. */
export async function syncFiles(p: Project): Promise<boolean> {
  const onDisk = new Set((await Files.walk(join(p.dir, 'media')).catch(() => [] as string[])).map(f => posix.join('media', toPortablePath(f))))
  for (const folder of ['renders', 'exports', 'documents', 'outputs', 'downloads', 'generated']) {
    for (const file of await Files.walk(join(p.dir, folder)).catch(() => [] as string[])) {
      if (/\.(png|jpe?g|webp|gif|svg|avif|pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|srt|vtt|ass|zip|mp4|mov|webm|mp3|wav|m4a|flac|html)$/i.test(file)) onDisk.add(posix.join(folder, toPortablePath(file)))
    }
  }
  for (const file of readdirSync(p.dir, { withFileTypes: true })) {
    if (file.isFile() && file.name !== 'thumb.jpg' && !file.name.startsWith('.') && /\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|tsv|png|jpe?g|webp|zip)$/i.test(file.name)) onDisk.add(file.name)
  }
  let changed = false
  if (p.files?.['thumb.jpg']) { delete p.files['thumb.jpg']; changed = true } // internal project thumbnail, not a deliverable
  for (const rel of Object.keys(p.files || {})) if (!onDisk.has(rel) && !existsSync(join(p.dir, rel))) { delete p.files![rel]; changed = true } // (or added while listing)
  for (const rel of onDisk) if (!p.files?.[rel]) { await register(p, rel).catch(e => console.warn('file', rel, e)); changed = true }
  // a file listed while it was still being written (a render the agent was making) is looked at again once it's whole
  for (const [rel, info] of Object.entries(p.files || {})) {
    const size = await stat(join(p.dir, rel)).then(s => s.size, () => null)
    if (size === null || typeof info.size !== 'number' || size === info.size) continue
    await register(p, rel).catch(e => console.warn('file', rel, e))
    if (p.files?.[rel]) p.files[rel].addedAt = info.addedAt // still where it was in the list
    changed = true
  }
  return changed
}

/** A file's machine name (an id, a camera's numbering, a screen recording) rather than one a person gave it. */
export const machineName = (s: string) => /^(?:[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{16,}$|(?:IMG|VID|PXL|MOV|DSC|DJI|MVI|GOPR?)_?\d|\d{6,}|Screen[ _]?Recording)/i.test(s.trim())

export async function addVersion(p: Project, absPath: string, title: string, by: Version['by'], timeline?: Version['timeline'], dry?: string) {
  const rel = relativeProjectPath(p.dir, absPath)
  p.media[rel] = await probe(absPath)
  const v: Version = { id: id(), path: rel, title, createdAt: Date.now(), by, ...(timeline ? { timeline } : {}), ...(dry ? { dry: relativeProjectPath(p.dir, dry) } : {}) }
  p.versions.push(v)
  // a project named after its footage's machine name takes the first cut's name: what people call it from then on
  if (by === 'agent' && title.trim() && machineName(p.title)) p.title = title.trim()
  return v
}

export async function addNote(p: Project, note: Omit<Note, 'id' | 'createdAt' | 'status' | 'still'>, still?: Buffer) {
  const n: Note = { ...note, id: id(), createdAt: Date.now(), status: 'open' }
  if (still) {
    n.still = posix.join('notes', `${n.id}.jpg`)
    await writeFile(join(p.dir, n.still), still)
  }
  p.notes.push(n)
  await save(p)
  return n
}

/** Why a file can't be removed: the film uses it (a version, the edit, its music, a motion clip). */
export function usedBy(p: Project, rel: string): string | null {
  const v = p.versions.find(x => x.path === rel)
  if (v) return `it is the version “${v.title}”`
  const inEdit = (tl?: Project['timeline']) => !!tl && (tl.items.some(i => i.kind === 'media' && i.src === rel) || tl.mix?.music?.src === rel || tl.mix?.voiceovers?.some(v => v.src === rel) || tl.demo?.camera === rel || tl.demo?.screen === rel)
  if (inEdit(p.timeline)) return 'the edit uses it'
  const ver = p.versions.find(x => inEdit(x.timeline))
  if (ver) return `the version “${ver.title}” uses it`
  for (const id of Object.keys(p.clips || {})) {
    const html = join(p.dir, 'clips', id, 'clip.html')
    if (existsSync(html) && readFileSync(html, 'utf8').includes(rel)) return `the motion clip “${p.clips![id].title}” uses it`
  }
  return null
}

/** Take files out of the project: into the Trash (trash), with what AgentShot made from them (transcript, preview copy,
 *  speakers, the subtitles link, a font's copy in fonts/). A folder whose files all go is trashed whole. Files the
 *  film uses stay, with the reason. */
export async function removeFiles(p: Project, rels: string[], trash: (abs: string) => Promise<void>) {
  const blocked: { file: string; why: string }[] = []
  const going = rels.filter(rel => {
    if (!p.files?.[rel]) return false
    const why = usedBy(p, rel)
    if (why) blocked.push({ file: rel, why })
    return !why
  })
  // a folder (media/<name>/…) whose every file goes is trashed as one
  const folders = new Map<string, string[]>()
  for (const rel of going) { const parts = rel.split('/'); if (parts.length > 2) folders.set(parts[1], [...(folders.get(parts[1]) || []), rel]) }
  const whole = new Set([...folders].filter(([name, list]) => Object.keys(p.files!).filter(f => f.startsWith(`media/${name}/`)).length === list.length).map(([name]) => name))
  const inWhole = (rel: string) => rel.split('/').length > 2 && whole.has(rel.split('/')[1])
  for (const name of whole) await trash(join(p.dir, 'media', name))
  for (const rel of going) if (!inWhole(rel) && existsSync(join(p.dir, rel))) await trash(join(p.dir, rel))

  for (const rel of going) {
    const font = p.files![rel].font && basename(rel)
    delete p.files![rel]
    delete p.media[rel]
    for (const map of [p.transcripts, p.proxies, p.speakers]) {
      if (map?.[rel]) { await rm(join(p.dir, map[rel]), { force: true }); delete map[rel] }
    }
    delete p.speakerNames?.[rel]
    delete p.subtitles?.[rel]
    for (const [media, link] of Object.entries(p.subtitles || {})) if (link.file === rel) delete p.subtitles![media]
    // its copy in fonts/, unless another font in the project has the same file name
    if (font && !Object.keys(p.files!).some(f => p.files![f].font && basename(f) === font)) await rm(join(p.dir, 'fonts', font), { force: true })
  }
  await save(p)
  return { removed: going, blocked }
}
