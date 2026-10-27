import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { FFMPEG, FONTS_DIR, probe } from '../src/main/media'
import * as Files from '../src/main/files'
import { kindByName } from '../src/shared/file-kinds'
import { joinAttached, splitAttached } from '../src/shared/attached'
import { parseSubtitles } from '../src/shared/subtitles'
import { chipGroups, fileRows } from '../src/renderer/src/views/FilesPanel'
import type { FileInfo } from '../src/shared/types'

const root = mkdtempSync(join(tmpdir(), 'agentshot-files-'))
process.env.MANUL_PROJECTS = join(root, 'projects')
const Projects = await import('../src/main/projects')
const src = join(root, 'src')
mkdirSync(src)
const ff = (...args: string[]) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args])

beforeAll(() => {
  ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(src, 'clip.mp4'))
  ff('-f', 'lavfi', '-i', 'sine=duration=3', join(src, 'song.mp3'))
  ff('-f', 'lavfi', '-i', 'color=c=red:s=200x100,format=rgba', '-frames:v', '1', join(src, 'logo.png'))
  // an old Windows .srt: Windows-1252 with CRLF
  writeFileSync(join(src, 'clip.fr.srt'), Buffer.from('1\r\n00:00:00,500 --> 00:00:01,800\r\nCafé crème\r\n\r\n2\r\n00:00:02,000 --> 00:00:03,000\r\n<i>À bientôt</i>\r\n', 'latin1'))
  writeFileSync(join(src, 'brief.pdf'), '%PDF-1.4\n%%EOF\n')
  writeFileSync(join(src, 'warm.cube'), 'TITLE "Warm look"\nLUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n')
  writeFileSync(join(src, 'shots.csv'), 'shot,scene,description\n1,beach,wide of the bay\n2,beach,close on hands\n')
  writeFileSync(join(src, 'notes.xyz'), 'whatever')
  mkdirSync(join(src, 'More Footage'))
  copyFileSync(join(src, 'clip.mp4'), join(src, 'More Footage', 'clip.mp4'))
  writeFileSync(join(src, 'broken.mp4'), 'not a video')
  // a brand kit folder (with Finder's litter) and the same kit zipped with one top folder
  mkdirSync(join(src, 'Brand Kit', 'fonts'), { recursive: true })
  writeFileSync(join(src, 'Brand Kit', '.DS_Store'), 'x')
  writeFileSync(join(src, 'Brand Kit', 'colours.txt'), 'Orange #F2A541\nInk #111111\n')
  copyFileSync(join(FONTS_DIR, 'Inter-Bold.ttf'), join(src, 'Brand Kit', 'fonts', 'Brand-Bold.ttf'))
  const zip = new AdmZip()
  zip.addFile('Brand Kit/colours.txt', readFileSync(join(src, 'Brand Kit', 'colours.txt')))
  zip.addFile('Brand Kit/fonts/Brand-Bold.ttf', readFileSync(join(src, 'Brand Kit', 'fonts', 'Brand-Bold.ttf')))
  zip.writeZip(join(src, 'kit.zip'))
})

describe('what a file is', () => {
  it('by name, for the kinds only the name can tell', () => {
    expect(kindByName('a/clip.MOV')).toBe('video')
    expect(kindByName('x.srt')).toBe('subtitles')
    expect(kindByName('brief.pdf')).toBeNull()
    expect(kindByName('Brand.otf')).toBe('font')
    expect(kindByName('look.cube')).toBe('lut')
    expect(kindByName('mystery.bin')).toBeNull()
  })

  it('reads text in the encodings subtitle files come in', () => {
    expect(Files.decodeText(Buffer.from('﻿hé', 'utf8'))).toEqual({ text: 'hé', encoding: 'UTF-8' })
    expect(Files.decodeText(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('hé', 'utf16le')]))).toEqual({ text: 'hé', encoding: 'UTF-16' })
    expect(Files.decodeText(Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('hé', 'utf16le').swap16()]))).toEqual({ text: 'hé', encoding: 'UTF-16' })
    expect(Files.decodeText(Buffer.from('1\n00:', 'utf16le'))).toEqual({ text: '1\n00:', encoding: 'UTF-16' })
    expect(Files.decodeText(Buffer.from('Café', 'latin1'))).toEqual({ text: 'Café', encoding: 'Windows-1252' })
  })

  it('parses SRT, WebVTT, ASS and SBV cues', () => {
    expect(parseSubtitles('1\r\n00:00:01,000 --> 00:00:02,500\r\n{\\an8}<i>Hello</i>\r\nthere\r\n\r\n2\r\n01:00:00,000 --> 01:00:01,000\r\nLate\r\n', 'srt'))
      .toEqual([{ s: 1, e: 2.5, text: 'Hello\nthere' }, { s: 3600, e: 3601, text: 'Late' }])
    expect(parseSubtitles('WEBVTT\n\nNOTE made by hand\n\nintro\n00:01.000 --> 00:02.000 align:start\n<v Ana>Hi &amp; welcome</v>\n\n00:00:03.000 --> 00:00:04.250\nNext', 'vtt'))
      .toEqual([{ s: 1, e: 2, text: 'Hi & welcome' }, { s: 3, e: 4.25, text: 'Next' }])
    const ass = '[Script Info]\nTitle: x\n\n[V4+ Styles]\nFormat: Name, Fontname\nStyle: Default,Arial\n\n[Events]\n' +
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
      'Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\b1}Well,{\\b0} hello\\Nworld\nComment: 0,0:00:04.00,0:00:05.00,Default,,0,0,0,,ignored\n'
    expect(parseSubtitles(ass, 'ass')).toEqual([{ s: 1.5, e: 3, text: 'Well, hello\nworld' }])
    expect(parseSubtitles('0:00:00.500,0:00:01.000\nOne\n\n0:00:01.200,0:00:02.000\nTwo\n', 'sbv')).toEqual([{ s: 0.5, e: 1, text: 'One' }, { s: 1.2, e: 2, text: 'Two' }])
  })

  it('says which video subtitles go with', () => {
    const files = { 'media/clip.mp4': { kind: 'video' }, 'media/other/clip.mp4': { kind: 'video' }, 'media/clip.png': { kind: 'image' } } as unknown as Record<string, FileInfo>
    expect(Files.subtitlesFor('media/clip.srt', files)).toBe('media/clip.mp4')
    expect(Files.subtitlesFor('media/clip.pt-BR.vtt', files)).toBe('media/clip.mp4')
    expect(Files.subtitlesFor('media/talk.srt', files)).toBeUndefined()
  })

  it("reads a font's family and style the way libass matches them", () => {
    expect(Files.fontNames(readFileSync(join(FONTS_DIR, 'Inter-Bold.ttf')))).toEqual({ family: 'Inter', style: 'Bold', full: 'Inter Bold' })
    expect(Files.fontNames(Buffer.from('not a font at all'))).toBeNull()
  })

  it('LUTs, SVG sizes and tables', () => {
    expect(Files.lutSummary('TITLE "Teal"\nLUT_3D_SIZE 33\n', 'cube')).toBe('3D LUT, 33 points a side, for lut3d: “Teal”')
    expect(Files.svgSize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 128">')).toEqual({ w: 512, h: 128 })
    expect(Files.svgSize('<svg width="300px" height="100" viewBox="0 0 30 10">')).toEqual({ w: 300, h: 100 })
    expect(Files.textSummary('shot,scene\n1,a\n2,b\n', 'csv')).toBe('CSV table, 2 rows; columns: “shot,scene”')
  })
})

describe('adding files to a project', () => {
  it('starts with a mixed batch, preserving every asset before the project opens', async () => {
    const sources = ['logo.png', 'song.mp3', 'clip.fr.srt', 'clip.mp4', 'More Footage/clip.mp4', 'brief.pdf', 'clip.mp4'].map(f => join(src, f))
    const p = await Projects.createFromFiles(sources)
    expect(p.versions[0].path).toBe('media/clip.mp4')
    expect(p.timeline!.items).toEqual([expect.objectContaining({ src: 'media/clip.mp4' })])
    expect(Object.fromEntries(Object.entries(p.files!).map(([rel, f]) => [rel, f.kind]))).toEqual({
      'media/logo.png': 'image', 'media/song.mp3': 'audio', 'media/clip.fr.srt': 'subtitles',
      'media/clip.mp4': 'video', 'media/clip-2.mp4': 'video', 'media/brief.pdf': 'other',
    })
    expect(Object.keys(p.media)).toHaveLength(4)
    for (const rel of Object.keys(p.files!)) expect(existsSync(join(p.dir, rel))).toBe(true)
    expect(readFileSync(join(p.dir, 'media/clip.fr.srt'), 'utf8')).toContain('Café crème')
    expect((await Projects.load(p.dir)).files).toEqual(p.files)
  })

  it('starts from a folder or zip containing footage and registers bundled fonts', async () => {
    const p = await Projects.createFromFiles([join(src, 'More Footage'), join(src, 'kit.zip')])
    expect(p.versions[0].path).toBe('media/More Footage/clip.mp4')
    expect(p.files!['media/kit/fonts/Brand-Bold.ttf'].font?.family).toBe('Inter')
    expect(existsSync(join(p.dir, 'fonts/Brand-Bold.ttf'))).toBe(true)
  })

  it('uses the first playable video when an earlier video cannot be decoded', async () => {
    const p = await Projects.createFromFiles([join(src, 'broken.mp4'), join(src, 'clip.mp4')])
    expect(p.versions[0].path).toBe('media/clip.mp4')
    expect(p.files!['media/broken.mp4'].summary).toContain("can't decode")
  })

  it('cleans up a failed batch so retrying cannot leave a partial project', async () => {
    const before = readdirSync(process.env.MANUL_PROJECTS!)
    const recent = Projects.recent()
    await expect(Projects.createFromFiles([join(src, 'clip.mp4'), join(src, 'missing.png')])).rejects.toThrow()
    expect(readdirSync(process.env.MANUL_PROJECTS!)).toEqual(before)
    expect(Projects.recent()).toEqual(recent)
  })

  it('requires playable footage and cleans up batches containing only photos or audio', async () => {
    const before = readdirSync(process.env.MANUL_PROJECTS!)
    await expect(Projects.createFromFiles([join(src, 'song.mp3'), join(src, 'logo.png')])).rejects.toThrow(/at least one video/)
    await expect(Projects.createFromFiles([])).rejects.toThrow(/Choose files/)
    expect(readdirSync(process.env.MANUL_PROJECTS!)).toEqual(before)
  })

  it('describes each kind and converts old subtitles to UTF-8', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    expect(p.files?.['media/clip.mp4']).toMatchObject({ kind: 'video', summary: expect.stringMatching(/^video 320×240, 25 fps, 0:02, with sound/) })
    const add = async (name: string) => { const [rel] = await Projects.addFiles(p, join(src, name)); return [rel, p.files![rel]] as const }

    const [srt, subs] = await add('clip.fr.srt')
    expect(subs.kind).toBe('subtitles')
    expect(subs.summary).toBe('SRT subtitles: 2 cues, 0:01–0:03, 4 words; starts “Café crème” (converted from Windows-1252 to UTF-8)')
    expect(readFileSync(join(p.dir, srt), 'utf8')).toContain('Café crème') // stored as UTF-8 for ffmpeg
    expect(Files.fileLine(srt, p.files!)).toContain('goes with media/clip.mp4')

    const [, song] = await add('song.mp3')
    expect(song).toMatchObject({ kind: 'audio', summary: 'audio, 0:03' })
    const [logoRel, logo] = await add('logo.png')
    expect(logo).toMatchObject({ kind: 'image', summary: 'image 200×100, transparent background' })
    expect(p.media[logoRel].width).toBe(200)

    expect((await add('warm.cube'))[1].summary).toBe('3D LUT, 2 points a side, for lut3d: “Warm look”')
    expect((await add('shots.csv'))[1].summary).toBe('CSV table, 2 rows; columns: “shot,scene,description”')
    expect((await add('notes.xyz'))[1]).toMatchObject({ kind: 'other', summary: '.xyz file (1 KB) AgentShot doesn\'t know how to use' })
    expect((await add('brief.pdf'))[1]).toMatchObject({ kind: 'other', summary: '.pdf file (1 KB) AgentShot doesn\'t know how to use' })
    // the same name twice gets a free one
    expect((await add('logo.png'))[0]).toBe('media/logo-2.png')
  })

  it('a folder comes in whole (no hidden files), its fonts land in fonts/ beside Inter', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    const rels = await Projects.addFiles(p, join(src, 'Brand Kit'))
    expect(rels.sort()).toEqual(['media/Brand Kit/colours.txt', 'media/Brand Kit/fonts/Brand-Bold.ttf'])
    expect(p.files!['media/Brand Kit/fonts/Brand-Bold.ttf']).toMatchObject({ kind: 'font', font: { family: 'Inter', style: 'Bold' } })
    expect(Files.fileLine('media/Brand Kit/fonts/Brand-Bold.ttf', p.files!)).toContain('Fontname=Inter with Bold=1, also in fonts/ (fontsdir=fonts)')
    for (const f of ['Brand-Bold.ttf', 'Inter-Regular.ttf', 'Inter-Bold.ttf']) expect(existsSync(join(p.dir, 'fonts', f))).toBe(true)
  })

  it('a .zip is unpacked into a folder named after it (one top folder dropped)', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    const rels = await Projects.addFiles(p, join(src, 'kit.zip'))
    expect(rels.sort()).toEqual(['media/kit/colours.txt', 'media/kit/fonts/Brand-Bold.ttf'])
    expect(readFileSync(join(p.dir, 'media/kit/colours.txt'), 'utf8')).toContain('#F2A541')
  })

  it('keeps the list in step with media/ (files added or removed in Finder)', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    writeFileSync(join(p.dir, 'media', 'later.srt'), '1\n00:00:00,000 --> 00:00:01,000\nHi\n')
    expect(await Projects.syncFiles(p)).toBe(true)
    expect(p.files!['media/later.srt'].kind).toBe('subtitles')
    rmSync(join(p.dir, 'media', 'later.srt'))
    expect(await Projects.syncFiles(p)).toBe(true)
    expect(p.files!['media/later.srt']).toBeUndefined()
    expect(await Projects.syncFiles(p)).toBe(false)
  })

  it('looks again at a render listed while it was still being written', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    mkdirSync(join(p.dir, 'renders'), { recursive: true })
    const out = join(p.dir, 'renders', 'cut.mp4')
    writeFileSync(out, readFileSync(join(src, 'clip.mp4')).subarray(0, 64)) // the encoder's first bytes
    expect(await Projects.syncFiles(p)).toBe(true)
    expect(p.files!['renders/cut.mp4'].summary).toContain("can't decode")
    copyFileSync(join(src, 'clip.mp4'), out) // finished
    expect(await Projects.syncFiles(p)).toBe(true)
    expect(p.files!['renders/cut.mp4'].summary).toMatch(/^video /)
    expect(await Projects.syncFiles(p)).toBe(false)
  })

  it('removes files into the Trash with what was made from them, but never what the film uses', async () => {
    const p = await Projects.createFromFile(join(src, 'clip.mp4'))
    const [srt] = await Projects.addFiles(p, join(src, 'clip.fr.srt'))
    const kit = await Projects.addFiles(p, join(src, 'Brand Kit'))
    p.subtitles = { 'media/clip.mp4': { file: srt, match: 0.9, offset: 0 } }
    const trashed: string[] = []
    const trash = async (abs: string) => { trashed.push(abs.slice(p.dir.length + 1).replace(/\\/g, '/')); rmSync(abs, { recursive: true }) }

    let r = await Projects.removeFiles(p, [srt, 'media/clip.mp4'], trash)
    expect(r).toEqual({ removed: [srt], blocked: [{ file: 'media/clip.mp4', why: 'it is the version “Original”' }] })
    expect(trashed).toEqual([srt])
    expect(p.files![srt]).toBeUndefined()
    expect(p.subtitles).toEqual({}) // the video no longer has subtitles
    expect(existsSync(join(p.dir, 'media/clip.mp4'))).toBe(true)

    // every file of a folder: the folder goes as one, and the font's copy in fonts/ with it (Inter stays)
    expect(existsSync(join(p.dir, 'fonts', 'Brand-Bold.ttf'))).toBe(true)
    r = await Projects.removeFiles(p, kit, trash)
    expect(r.removed.sort()).toEqual(kit.sort())
    expect(trashed.at(-1)).toBe('media/Brand Kit')
    expect(existsSync(join(p.dir, 'fonts', 'Brand-Bold.ttf'))).toBe(false)
    expect(existsSync(join(p.dir, 'fonts', 'Inter-Bold.ttf'))).toBe(true)
    expect(Object.keys(p.files!)).toEqual(['media/clip.mp4'])

    // music the mix plays is kept too
    const [song] = await Projects.addFiles(p, join(src, 'song.mp3'))
    p.timeline!.mix = { filmDb: 0, music: { src: song, db: -14, duckDb: 10 } }
    expect((await Projects.removeFiles(p, [song], trash)).blocked).toEqual([{ file: song, why: 'the edit uses it' }])
  })

  it("won't start a project from something that isn't a video", async () => {
    await expect(Projects.createFromFile(join(src, 'clip.fr.srt'))).rejects.toThrow(/isn't a video AgentShot can play/)
  })
})

describe('files attached to a message', () => {
  it('travel after the text and come back as chips', () => {
    const m = joinAttached('Burn these in', ['media/a.srt — SRT subtitles: 2 cues', 'media/Brand Kit/logo.png — image 200×100'])
    expect(m).toBe('Burn these in\n\n[attached files]\n- media/a.srt — SRT subtitles: 2 cues\n- media/Brand Kit/logo.png — image 200×100')
    expect(splitAttached(m)).toEqual({ text: 'Burn these in', files: ['media/a.srt', 'media/Brand Kit/logo.png'], more: 0 })
    expect(splitAttached(joinAttached('', ['media/x.srt — SRT subtitles', '…and 4 more (project_state lists every file)']))).toEqual({ text: '', files: ['media/x.srt'], more: 4 })
    expect(splitAttached('just text [attached files] mid-sentence')).toEqual({ text: 'just text [attached files] mid-sentence', files: [], more: 0 })
  })

  it('a long list is cut short for the agent', () => {
    const files = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`media/p/${i}.jpg`, { kind: 'image', summary: 'image 10×10' }])) as unknown as Record<string, FileInfo>
    const lines = Files.attachedLines(Object.keys(files), files)
    expect(lines).toHaveLength(31)
    expect(lines.at(-1)).toBe('…and 10 more (project_state lists every file)')
  })

  it('the Files list nests every level, with folders before files', () => {
    expect(fileRows(['media/kit/b.png', 'media/z.srt', 'media/kit/a.png', 'media/a.mp4'])).toEqual([
      { kind: 'folder', name: 'media', rels: ['media/a.mp4', 'media/kit/a.png', 'media/kit/b.png', 'media/z.srt'], depth: 0 },
      { kind: 'folder', name: 'media/kit', rels: ['media/kit/a.png', 'media/kit/b.png'], depth: 1 },
      { kind: 'file', rel: 'media/kit/a.png', depth: 2 }, { kind: 'file', rel: 'media/kit/b.png', depth: 2 },
      { kind: 'file', rel: 'media/a.mp4', depth: 1 }, { kind: 'file', rel: 'media/z.srt', depth: 1 },
    ])
  })

  it('collapsing one folder hides only its descendants, including deeply nested files', () => {
    const paths = ['renders/thumbs/social/cover.png', 'renders/final.mp4', 'media/a.mp4', 'summary.md']
    const rows = fileRows(paths, new Set(['renders/thumbs']))
    expect(rows).toContainEqual({ kind: 'folder', name: 'renders/thumbs', rels: ['renders/thumbs/social/cover.png'], depth: 1 })
    expect(rows.some(r => r.kind === 'folder' && r.name === 'renders/thumbs/social')).toBe(false)
    expect(rows).toContainEqual({ kind: 'file', rel: 'renders/final.mp4', depth: 1 })
    expect(rows).toContainEqual({ kind: 'file', rel: 'media/a.mp4', depth: 1 })
    expect(fileRows(paths, new Set(['renders'])).some(r => r.kind === 'file' && r.rel.startsWith('renders/'))).toBe(false)
    expect(fileRows(paths)).toContainEqual({ kind: 'file', rel: 'renders/thumbs/social/cover.png', depth: 3 })
  })

  it('handles empty trees, duplicate paths and stale collapsed folders without mutating inputs', () => {
    const paths = ['z.txt', 'renders/b.txt', 'renders/a.txt', 'renders/a.txt', 'media/z.txt']
    const original = [...paths]
    const collapsed = new Set(['gone', 'renders-old'])
    expect(fileRows([])).toEqual([])
    expect(fileRows(paths, collapsed)).toEqual([
      { kind: 'folder', name: 'media', rels: ['media/z.txt'], depth: 0 },
      { kind: 'file', rel: 'media/z.txt', depth: 1 },
      { kind: 'folder', name: 'renders', rels: ['renders/a.txt', 'renders/b.txt'], depth: 0 },
      { kind: 'file', rel: 'renders/a.txt', depth: 1 },
      { kind: 'file', rel: 'renders/b.txt', depth: 1 },
      { kind: 'file', rel: 'z.txt', depth: 0 },
    ])
    expect(paths).toEqual(original)
    expect([...collapsed]).toEqual(['gone', 'renders-old'])
  })

  it('uses full folder paths so identically named sibling folders collapse independently', () => {
    const rows = fileRows(['media/docs/a.txt', 'outputs/docs/b.txt', 'outputs/docs-old/c.txt'], new Set(['outputs/docs']))
    expect(rows).toContainEqual({ kind: 'file', rel: 'media/docs/a.txt', depth: 2 })
    expect(rows).toContainEqual({ kind: 'file', rel: 'outputs/docs-old/c.txt', depth: 2 })
    expect(rows.some(r => r.kind === 'file' && r.rel === 'outputs/docs/b.txt')).toBe(false)
  })

  it("a folder's files collapse into one chip", () => {
    expect(chipGroups(['media/a.srt', 'media/kit/1.png', 'media/kit/2.png', 'media/kit/3.png', 'media/kit/4.png', 'media/two/x.txt']))
      .toEqual([{ label: 'a.srt', rels: ['media/a.srt'] }, { label: 'kit/ · 4 files', rels: ['media/kit/1.png', 'media/kit/2.png', 'media/kit/3.png', 'media/kit/4.png'] }, { label: 'two/x.txt', rels: ['media/two/x.txt'] }])
  })
})

it('probes with the bundled ffprobe', async () => { expect((await probe(join(src, 'clip.mp4'))).width).toBe(320) })
