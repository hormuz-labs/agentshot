// Files the user adds to a project besides the film: more footage, music and voice-over, logos and photos, subtitles,
// fonts, LUTs. Each is copied into media/ (a folder or a .zip comes in whole, keeping its layout) and described in
// project.json `files`: its kind and one line on what is in it, so the agent knows what it has and how to use it.
// Subtitles and text in another encoding are stored as UTF-8 (what ffmpeg's subtitles filter and the agent read).
import { createWriteStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, posix, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { extOf, kindByName } from '../shared/file-kinds'
import { toPortablePath } from '../shared/paths'
import { parseSubtitles, type Cue } from '../shared/subtitles'
import type { FileInfo, FileKind, MediaInfo, Project, SubtitleLink } from '../shared/types'

const clock = (t: number) => {
  const s = Math.round(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`
}
const bytes = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1e3))} KB` : n < 1e9 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e9).toFixed(1)} GB`)
const quote = (s: string, n = 60) => { const t = s.replace(/\s+/g, ' ').trim(); return `“${t.length > n ? `${t.slice(0, n)}…` : t}”` }
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const count = (n: number, what: string) => `${n} ${what}${n === 1 ? '' : 's'}`

// ---------------------------------------------------------------- text in any encoding
/** Text in whatever encoding subtitle and text files come in: UTF-8 (with or without a BOM), UTF-16 (a BOM, or the
 *  zero bytes of ASCII in UTF-16), else Windows-1252 (old .srt files from Windows tools). */
export function decodeText(buf: Buffer): { text: string; encoding: string } {
  const utf16be = (b: Buffer) => Buffer.from(b.subarray(0, b.length & ~1)).swap16().toString('utf16le')
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8' }
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'UTF-16' }
  if (buf[0] === 0xfe && buf[1] === 0xff) return { text: utf16be(buf.subarray(2)), encoding: 'UTF-16' }
  if (buf.length >= 4 && buf[0] !== 0 && buf[1] === 0 && buf[3] === 0) return { text: buf.toString('utf16le'), encoding: 'UTF-16' }
  if (buf.length >= 4 && buf[0] === 0 && buf[2] === 0 && buf[1] !== 0) return { text: utf16be(buf), encoding: 'UTF-16' }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' }
  } catch {
    return { text: new TextDecoder('windows-1252').decode(buf), encoding: 'Windows-1252' }
  }
}

// ---------------------------------------------------------------- subtitles
export function subtitlesSummary(cues: Cue[], format: string) {
  if (!cues.length) return `${format.toUpperCase()} subtitles with no cues AgentShot could read`
  const end = Math.max(...cues.map(c => c.e))
  return `${format.toUpperCase()} subtitles: ${count(cues.length, 'cue')}, ${clock(cues[0].s)}–${clock(end)}, ${count(cues.reduce((n, c) => n + words(c.text), 0), 'word')}; ` +
    `starts ${quote(cues[0].text)}`
}

/** The video (or audio) a subtitle file goes with, by name: clip.srt, clip.en.srt or clip.pt-BR.srt → clip.mp4 beside it. */
export function subtitlesFor(rel: string, files: Record<string, FileInfo>): string | undefined {
  const stem = basename(rel, extname(rel))
  const stems = [stem, stem.replace(/\.[a-z]{2,3}(?:[-_][a-z]{2,4})?$/i, '')]
  return Object.keys(files).find(f => (files[f].kind === 'video' || files[f].kind === 'audio') && dirname(f) === dirname(rel) && stems.includes(basename(f, extname(f))))
}

// ---------------------------------------------------------------- fonts, LUTs, images, text
/** A TrueType/OpenType font's names (the first font of a .ttc): family as libass and ASS `Fontname` match it (name
 *  ID 1), style (ID 2) and full name (ID 4). Null for anything that isn't one. */
export function fontNames(buf: Buffer): { family: string; style: string; full: string } | null {
  try {
    const base = buf.toString('latin1', 0, 4) === 'ttcf' ? buf.readUInt32BE(12) : 0
    const sig = buf.readUInt32BE(base)
    if (sig !== 0x00010000 && sig !== 0x4f54544f /* OTTO */ && sig !== 0x74727565 /* true */) return null
    let table: Buffer | undefined
    for (let i = 0, n = buf.readUInt16BE(base + 4); i < n; i++) {
      const o = base + 12 + i * 16
      if (buf.toString('latin1', o, o + 4) === 'name') table = buf.subarray(buf.readUInt32BE(o + 8), buf.readUInt32BE(o + 8) + buf.readUInt32BE(o + 12))
    }
    if (!table) return null
    const found: Record<number, string> = {}, rank: Record<number, number> = {}
    const strings = table.readUInt16BE(4)
    for (let i = 0, n = table.readUInt16BE(2); i < n; i++) {
      const r = 6 + i * 12
      const [platform, encoding, language, id, len, off] = [0, 2, 4, 6, 8, 10].map(k => table!.readUInt16BE(r + k))
      if (id !== 1 && id !== 2 && id !== 4) continue
      // Windows Unicode in US English first, then any Unicode, then Mac Roman
      const score = platform === 3 && (encoding === 1 || encoding === 10) ? (language === 0x409 ? 3 : 2) : platform === 0 ? 2 : platform === 1 && encoding === 0 ? 1 : 0
      if (score <= (rank[id] || 0)) continue
      const raw = table.subarray(strings + off, strings + off + len)
      rank[id] = score
      found[id] = platform === 1 ? raw.toString('latin1') : Buffer.from(raw.subarray(0, raw.length & ~1)).swap16().toString('utf16le')
    }
    if (!found[1]) return null
    const style = found[2] || 'Regular'
    return { family: found[1], style, full: found[4] || `${found[1]} ${style}` }
  } catch { return null }
}

export function lutSummary(text: string, format: string) {
  if (format !== 'cube') return '3D LUT (.3dl) for lut3d'
  const n3 = /^\s*LUT_3D_SIZE\s+(\d+)/m.exec(text), n1 = /^\s*LUT_1D_SIZE\s+(\d+)/m.exec(text), title = /^\s*TITLE\s+"([^"]*)"/m.exec(text)
  const what = n3 ? `3D LUT, ${n3[1]} points a side, for lut3d` : n1 ? `1D LUT, ${n1[1]} points, for lut1d` : '.cube file with no LUT size in it'
  return title?.[1] ? `${what}: ${quote(title[1], 40)}` : what
}

/** An SVG's size from its width/height or viewBox. */
export function svgSize(text: string) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] || ''
  const attr = (a: string) => Number(new RegExp(`\\s${a}\\s*=\\s*["']\\s*([\\d.]+)(?:px)?\\s*["']`, 'i').exec(tag)?.[1] || 0)
  const box = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(tag)
  const [w, h] = attr('width') && attr('height') ? [attr('width'), attr('height')] : box ? [Number(box[1]), Number(box[2])] : [0, 0]
  return { w: Math.round(w), h: Math.round(h) }
}

const TEXT_LABEL: Record<string, string> = {
  txt: 'Text', md: 'Markdown', markdown: 'Markdown', json: 'JSON', xml: 'XML', yaml: 'YAML', yml: 'YAML', html: 'HTML', htm: 'HTML',
  edl: 'EDL (edit decision list)', fcpxml: 'Final Cut Pro XML', otio: 'OpenTimelineIO', ttml: 'TTML subtitles', dfxp: 'TTML subtitles',
}
export function textSummary(text: string, format: string) {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (format === 'csv' || format === 'tsv') return `${format.toUpperCase()} table, ${count(Math.max(0, lines.length - 1), 'row')}; columns: ${quote(lines[0] || '', 80)}`
  return `${TEXT_LABEL[format] || `.${format} text`}, ${count(lines.length, 'line')}${lines.length ? `; starts ${quote(lines[0])}` : ''}`
}

const ALPHA = /^(rgba|bgra|argb|abgr|ya\d|yuva|gbrap)/
export function mediaSummary(kind: FileKind, m: MediaInfo) {
  if (kind === 'audio') return `audio, ${clock(m.duration)}`
  if (kind === 'image') return `image ${m.width}×${m.height}${ALPHA.test(m.pixfmt || '') ? ', transparent background' : ''}`
  return `video ${m.width}×${m.height}, ${m.fps} fps, ${clock(m.duration)}, ${m.hasAudio ? 'with sound' : 'no sound'}`
}

// ---------------------------------------------------------------- describing a file
export type Probe = (abs: string) => Promise<MediaInfo>

/** What a file in the project (rel, under media/) is. Media files also return their ffprobe details. */
export async function inspect(projectDir: string, rel: string, probe: Probe): Promise<{ info: FileInfo; media?: MediaInfo }> {
  const abs = join(projectDir, rel)
  const { size } = await stat(abs)
  const format = extOf(rel)
  const kind = kindByName(rel)
  const info = (kind: FileKind, summary: string, more: Partial<FileInfo> = {}): FileInfo => ({ kind, size, addedAt: Date.now(), summary, ...more })

  if (kind === null || kind === 'video' || kind === 'audio' || (kind === 'image' && format !== 'svg')) {
    const m = await probe(abs).catch(() => null)
    if (!m || (!m.width && !m.hasAudio)) {
      return { info: kind ? info(kind, `${format.toUpperCase()} ${kind} AgentShot can't decode`) : info('other', otherSummary(format, size)) }
    }
    // the name decides between audio and a picture (an MP3's cover art is a picture stream); animation makes a video
    const moving = m.duration > 0.5
    const k: FileKind = kind === 'audio' || !m.width ? 'audio'
      : kind === 'image' ? (moving && ['gif', 'webp', 'png', 'avif'].includes(format) ? 'video' : 'image')
      : kind === null ? (moving ? 'video' : 'image') : 'video'
    return { info: info(k, mediaSummary(k, m)), media: m }
  }
  if (kind === 'image') { // SVG: ffmpeg can't draw it, a motion clip (HTML) can
    const { w, h } = svgSize(decodeText(await readFile(abs)).text)
    return { info: info('image', `vector image (SVG)${w && h ? ` ${w}×${h}` : ''}: use it in a motion clip; ffmpeg can't read SVG`) }
  }
  if (kind === 'subtitles' || kind === 'text' || kind === 'lut') {
    const { text, encoding } = decodeText(await readFile(abs))
    if (encoding !== 'UTF-8') await writeFile(abs, text) // our copy: UTF-8 for ffmpeg's subtitles filter and the agent
    const note = encoding !== 'UTF-8' ? ` (converted from ${encoding} to UTF-8)` : ''
    const summary = kind === 'subtitles' ? subtitlesSummary(parseSubtitles(text, format), format) : kind === 'lut' ? lutSummary(text, format) : textSummary(text, format)
    return { info: info(kind, summary + note) }
  }
  if (kind === 'font') {
    if (format === 'woff' || format === 'woff2') return { info: info('font', `web font (${format.toUpperCase()}): for motion clips; ffmpeg text needs a TTF or OTF`) }
    const names = fontNames(await readFile(abs))
    return { info: names ? info('font', `font “${names.family}” ${names.style} (${names.full})`, { font: { family: names.family, style: names.style } }) : info('font', `${format.toUpperCase()} font AgentShot couldn't read`) }
  }
  return { info: info('other', otherSummary(format, size)) }
}

function otherSummary(format: string, size: number) {
  if (['rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz'].includes(format)) return `.${format} archive (${bytes(size)}) AgentShot doesn't unpack: ask for a .zip or the files themselves`
  return `${format ? `.${format}` : 'a'} file (${bytes(size)}) AgentShot doesn't know how to use`
}

// ---------------------------------------------------------------- copying in
const hidden = (name: string) => name.startsWith('.') || name === '__MACOSX' || name === 'Thumbs.db' || name === 'desktop.ini'
export const MAX_FILES = 2000

/** The files under a folder (relative paths): no hidden files, no symlinks. */
export async function walk(dir: string, sub = ''): Promise<string[]> {
  const out: string[] = []
  for (const d of await readdir(join(dir, sub), { withFileTypes: true })) {
    if (hidden(d.name) || d.isSymbolicLink()) continue
    const rel = sub ? posix.join(sub, d.name) : d.name
    if (d.isDirectory()) out.push(...(await walk(dir, rel)))
    else if (d.isFile()) out.push(rel)
    if (out.length > MAX_FILES) break
  }
  return out
}

/** A name in dir that isn't taken: name, name-2, name-3… (a file keeps its extension). */
function freeName(dir: string, name: string, isFile: boolean) {
  const ext = isFile ? extname(name) : '', stem = isFile ? basename(name, ext) : name
  let out = name
  for (let n = 2; existsSync(join(dir, out)); n++) out = `${stem}-${n}${ext}`
  return out
}

/** A .zip's files into dest (one top folder that holds everything is dropped). yauzl refuses entries that would land
 *  outside dest (absolute paths, ..); the check below is a second guard. */
async function unzip(zip: string, dest: string): Promise<string[]> {
  const z = await new Promise<yauzl.ZipFile>((ok, fail) => yauzl.open(zip, { lazyEntries: true, autoClose: false }, (err, f) => (err ? fail(err) : ok(f))))
  const read = (e: yauzl.Entry) => new Promise<NodeJS.ReadableStream>((ok, fail) => z.openReadStream(e, (err, s) => (err ? fail(err) : ok(s))))
  const entries: yauzl.Entry[] = []
  await new Promise<void>((ok, fail) => {
    z.on('entry', (e: yauzl.Entry) => {
      if (!e.fileName.endsWith('/') && !e.fileName.split('/').some(hidden)) entries.push(e)
      if (entries.length > MAX_FILES) { z.close(); fail(new Error(`${basename(zip)} holds more than ${MAX_FILES} files; add the ones the edit needs.`)) } else z.readEntry()
    })
    z.on('end', ok)
    z.on('error', fail)
    z.readEntry()
  })
  const top = entries[0]?.fileName.split('/')[0]
  const strip = entries.length > 0 && entries.every(e => e.fileName.startsWith(`${top}/`)) ? top.length + 1 : 0
  const out: string[] = []
  try {
    for (const e of entries) {
      const rel = toPortablePath(e.fileName.slice(strip))
      const to = join(dest, rel)
      if (!to.startsWith(dest + sep)) continue
      await mkdir(dirname(to), { recursive: true })
      await pipeline(await read(e), createWriteStream(to))
      out.push(rel)
    }
  } finally { z.close() }
  return out
}

/** Copy a file, a folder (its files, keeping the layout) or a .zip's contents into the project's media/. Returns the
 *  new files, project-relative. */
export async function copyIn(projectDir: string, src: string): Promise<string[]> {
  const media = join(projectDir, 'media')
  await mkdir(media, { recursive: true })
  if ((await lstat(src)).isDirectory()) {
    const files = await walk(src)
    if (files.length > MAX_FILES) throw new Error(`${basename(src)} holds more than ${MAX_FILES} files; add the ones the edit needs.`)
    const root = freeName(media, basename(src), false)
    for (const f of files) {
      await mkdir(dirname(join(media, root, f)), { recursive: true })
      await copyFile(join(src, f), join(media, root, f))
    }
    return files.map(f => posix.join('media', root, toPortablePath(f)))
  }
  if (extOf(src) === 'zip') {
    const root = freeName(media, basename(src, extname(src)), false)
    return (await unzip(src, join(media, root))).map(f => posix.join('media', root, toPortablePath(f)))
  }
  const name = freeName(media, basename(src), true)
  await copyFile(src, join(media, name))
  return [posix.join('media', name)]
}

// ---------------------------------------------------------------- telling the agent
/** How subtitles relate to a video: chosen for it (and whether they match its speech), or named after it. */
function subtitlesNote(rel: string, files: Record<string, FileInfo>, links: Record<string, SubtitleLink>) {
  const linked = Object.entries(links).find(([, l]) => l.file === rel)
  if (!linked) { const by = subtitlesFor(rel, files); return by ? `; goes with ${by}` : '' }
  const [media, l] = linked
  if (l.match === undefined) return `; subtitles for ${media}`
  if (l.match < 0.2) return `; chosen for ${media} but they don't match its speech (another video, or a translation)`
  return `; subtitles for ${media}, ${Math.round(l.match * 100)} % of lines heard in its speech${l.offset ? `, ${Math.abs(l.offset)} s ${l.offset > 0 ? 'late' : 'early'}` : ''}`
}

/** A file as the agent sees it: its path, what it is, and how to use it (the video subtitles go with, a font's name). */
export function fileLine(rel: string, files: Record<string, FileInfo>, links: Record<string, SubtitleLink> = {}) {
  const f = files[rel]
  if (!f) return rel
  const target = f.kind === 'subtitles' ? subtitlesNote(rel, files, links) : ''
  const font = f.font ? `; Fontname=${f.font.family}${/bold/i.test(f.font.style) ? ' with Bold=1' : ''}, also in fonts/ (fontsdir=fonts)` : ''
  return `${rel} — ${f.summary}${target}${font}`
}

/**
 * Anything in the project the user can point the agent at, as the agent sees it: a file (media/…), a version of the
 * film (its render's path, numbered v1, v2… as the version list numbers them) or a motion clip (clips/<id>).
 */
export function refLine(rel: string, p: Pick<Project, 'files' | 'subtitles' | 'versions' | 'proposal' | 'current' | 'media' | 'clips'>) {
  if (p.files?.[rel]) return fileLine(rel, p.files, p.subtitles)
  const versions = p.versions.filter(v => v.id !== p.proposal)
  const k = versions.findIndex(v => v.path === rel)
  if (k >= 0) {
    const v = versions[k], d = p.media[rel]?.duration
    return `${rel} — version v${k + 1} of the film, “${v.title}”${d ? `, ${clock(d)}` : ''}${v.id === p.current ? ' (the one on screen)' : ''}`
  }
  const id = /^clips\/([^/]+)$/.exec(rel)?.[1]
  const c = id ? p.clips?.[id] : undefined
  if (c) return `${rel} — motion clip ${id}, “${c.title}”, ${c.duration} s${c.overlay ? ', laid over the footage' : ''} (clip.html in that folder)`
  return rel
}

/** The lines for what's attached to a message (files, versions, clips): at most `max`, then a count. */
export function refLines(rels: string[], p: Parameters<typeof refLine>[1], max = 30) {
  const lines = rels.slice(0, max).map(r => refLine(r, p))
  if (rels.length > max) lines.push(`…and ${rels.length - max} more (project_state lists everything)`)
  return lines
}

/** The lines for files attached to a message: at most `max`, then a count (project_state lists them all). */
export function attachedLines(rels: string[], files: Record<string, FileInfo>, max = 30, links: Record<string, SubtitleLink> = {}) {
  const lines = rels.slice(0, max).map(r => fileLine(r, files, links))
  if (rels.length > max) lines.push(`…and ${rels.length - max} more (project_state lists every file)`)
  return lines
}
