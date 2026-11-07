// Export for another editor: a folder with the cut as FCPXML (Final Cut, Resolve), FCP 7 XML (Premiere) and
// OpenTimelineIO, the files it uses copied into Media/ (a copy-on-write clone where the disk can, so no extra space), and a
// note on how to open it. The writers are in shared/handoff.ts.
import { execFile } from 'node:child_process'
import { constants, existsSync } from 'node:fs'
import { copyFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { extname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import { basename, planOf, readmeOf, toFcpxml, toOtio, toXmeml, type HandoffMedia, type HandoffPlan } from '../shared/handoff'
import type { Region } from '../shared/mix'
import type { Timeline } from '../shared/timeline'
import type { Project } from '../shared/types'

const run = promisify(execFile)

/** What ffprobe says about a file: picture size and rate, sound, length, start timecode. */
export async function describeFile(ffprobe: string, file: string): Promise<Omit<HandoffMedia, 'id' | 'name' | 'path'>> {
  const { stdout } = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { maxBuffer: 16 << 20, windowsHide: true })
  const j = JSON.parse(stdout) as { format: { duration?: string; tags?: Record<string, string> }; streams: { codec_type: string; width?: number; height?: number; avg_frame_rate?: string; r_frame_rate?: string; duration?: string; tags?: Record<string, string>; disposition?: { attached_pic?: number } }[] }
  const v = j.streams.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const rate = (s?: string) => { const [n, d] = String(s || '0/1').split('/').map(Number); return d ? n / d : 0 }
  const fps = v ? rate(v.avg_frame_rate) || rate(v.r_frame_rate) : 0
  const tcText = j.format.tags?.timecode || j.streams.map(s => s.tags?.timecode).find(Boolean)
  return {
    duration: Number(j.format.duration || v?.duration || 0),
    hasVideo: !!v, hasAudio: j.streams.some(s => s.codec_type === 'audio'),
    ...(v ? { width: v.width, height: v.height, fps: Math.round(fps * 1000) / 1000 } : {}),
    ...(tcText && fps ? { tc: timecodeFrames(tcText, fps) } : {}),
  }
}

/** "01:00:00:00" (or drop-frame "01:00:00;00") → frames at the nominal rate. */
export function timecodeFrames(tc: string, fps: number): { frames: number; drop: boolean } | undefined {
  const m = /^(\d+):(\d+):(\d+)([:;.,])(\d+)$/.exec(tc.trim())
  if (!m) return undefined
  const [h, min, s, f] = [m[1], m[2], m[3], m[5]].map(Number)
  const base = Math.round(fps), drop = m[4] === ';' || m[4] === ','
  const minutes = h * 60 + min
  let frames = (minutes * 60 + s) * base + f
  // drop-frame: two frame numbers (four at 59.94) skipped each minute, except every tenth
  if (drop) frames -= (base / 30 * 2) * (minutes - Math.floor(minutes / 10))
  return { frames, drop }
}

export type HandoffResult = { dir: string; files: string[]; notes: string[]; copied: number }

export async function exportForEditors(o: {
  p: Project; tl: Timeline; out: string; ffprobe: string
  speech?: Region[]
  /** renders a motion clip that has no file yet */
  bake(id: string): Promise<void>
  progress(share: number | null, detail?: string): void
}): Promise<HandoffResult> {
  const { p, tl, out } = o
  const abs = (rel: string) => (isAbsolute(rel) ? rel : join(p.dir, rel))
  const used = new Set([...tl.items.flatMap(i => (i.kind === 'clip' ? [i.clip] : [])), ...(tl.overlays || []).map(x => x.clip)])
  for (const id of used) if (!p.clips?.[id] || !existsSync(abs(p.clips[id].video))) { o.progress(null, `Rendering ${p.clips?.[id]?.title || id}`); await o.bake(id) }

  // every file, under a readable name in Media/ (clips by their title)
  const sources = new Map<string, { from: string; name: string }>()
  const names = new Set<string>()
  const named = (want: string) => {
    const ext = extname(want), stem = (want.slice(0, want.length - ext.length).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'clip').slice(0, 80)
    let name = `${stem}${ext}`
    for (let k = 2; names.has(name.toLowerCase()); k++) name = `${stem} ${k}${ext}`
    names.add(name.toLowerCase())
    return name
  }
  const add = (src: string, title?: string) => { if (!sources.has(src)) sources.set(src, { from: abs(src), name: named(title ? `${title}${extname(src)}` : basename(src)) }) }
  for (const it of tl.items) if (it.kind === 'media') add(it.src)
  if (tl.demo && tl.items.some(i => i.kind === 'media' && i.src === tl.demo!.screen)) add(tl.demo.camera)
  const clipFiles: Record<string, { file: string; title: string }> = {}
  for (const id of used) { const c = p.clips![id]; add(c.video, c.title); clipFiles[id] = { file: c.video, title: c.title } }
  if (tl.mix?.music) add(tl.mix.music.src)
  for (const v of tl.mix?.voiceovers || []) if (!v.muted) add(v.src)

  const media = join(out, 'Media')
  await mkdir(media, { recursive: true })
  const info: Record<string, Omit<HandoffMedia, 'id' | 'name'>> = {}
  let i = 0, copied = 0
  for (const [src, s] of sources) {
    o.progress(i++ / sources.size, `Copying ${s.name}`)
    const to = join(media, s.name)
    if (!existsSync(s.from)) throw new Error(`${src} is missing from the project.`)
    // a clone on APFS / Btrfs / ReFS: instant and takes no space until either copy changes
    if (!existsSync(to) || (await stat(to)).size !== (await stat(s.from)).size) { await copyFile(s.from, to, constants.COPYFILE_FICLONE); copied++ }
    info[src] = { ...(await describeFile(o.ffprobe, to)), path: to }
  }
  const clips = Object.fromEntries(Object.entries(clipFiles).map(([id, c]) => [id, { file: c.file, title: c.title }]))
  const plan: HandoffPlan = planOf({ name: p.title, tl, media: info, clips, speech: o.speech })
  // planOf names media by file; use the names they have in Media/
  for (const m of plan.media) m.name = basename(m.path)
  const stem = p.title.replace(/[\\/:*?"<>|]+/g, '-').trim().slice(0, 80) || 'Film'
  const files = { fcpxml: `${stem}.fcpxml`, xml: `${stem} (Premiere).xml`, otio: `${stem}.otio` }
  await writeFile(join(out, files.fcpxml), toFcpxml(plan))
  await writeFile(join(out, files.xml), toXmeml(plan))
  await writeFile(join(out, files.otio), toOtio(plan))
  await writeFile(join(out, 'How to open.txt'), readmeOf(plan, files))
  return { dir: out, files: Object.values(files).map(f => join(out, f)), notes: plan.notes, copied }
}
