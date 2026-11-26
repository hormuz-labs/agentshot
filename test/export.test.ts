import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captionCues, exportArgs, LOUDNESS, loudnessGain, PRESETS, toSrt } from '../src/shared/export'
import { measureLoudness } from '../src/main/analysis'
import { FFMPEG, probe } from '../src/main/media'
import type { Transcript } from '../src/shared/types'
import { escapeFilterPath, escapeFilterValue } from '../src/shared/ffmpeg'

const words = (text: string, start = 0, gap = 0.35) => text.split(' ').map((w, i) => ({ w, s: start + i * gap, e: start + i * gap + 0.3 }))
const tr = (segs: { text: string; start: number }[]): Transcript => ({ media: 'a.mp4', language: 'en', model: 'm', createdAt: 0,
  segments: segs.map(s => { const ws = words(s.text, s.start); return { s: ws[0].s, e: ws.at(-1)!.e, text: s.text, words: ws } }) })

describe('captions', () => {
  it('splits speech into short readable cues (≤ 42 chars a line, 2 lines, ≤ 6 s)', () => {
    const cues = captionCues(tr([{ text: 'This is a fairly long sentence that keeps going and going so that it has to be split into more than one caption for sure', start: 0 }]))
    expect(cues.length).toBeGreaterThan(1)
    for (const c of cues) {
      expect(c.lines.length).toBeLessThanOrEqual(2)
      for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42)
      expect(c.e - c.s).toBeLessThanOrEqual(6)
    }
    expect(cues.flatMap(c => c.lines).join(' ')).toBe('This is a fairly long sentence that keeps going and going so that it has to be split into more than one caption for sure')
  })

  it('leaves fillers out of captions', () => {
    const cues = captionCues(tr([{ text: 'Um so uh this works', start: 0 }]))
    expect(cues.flatMap(c => c.lines).join(' ')).toBe('so this works')
  })

  it('starts a new cue at a new sentence', () => {
    const cues = captionCues(tr([{ text: 'Hello there.', start: 0 }, { text: 'Second one.', start: 2 }]))
    expect(cues.map(c => c.lines.join(' '))).toEqual(['Hello there.', 'Second one.'])
  })

  it('writes SRT', () => {
    expect(toSrt([{ s: 0, e: 1.5, lines: ['Hello'] }, { s: 61.25, e: 3725.004, lines: ['a', 'b'] }])).toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nHello\n\n2\n00:01:01,250 --> 01:02:05,004\na\nb\n')
  })
})

describe('export presets', () => {
  it('has the presets people ask for', () => {
    expect(PRESETS.map(p => p.id)).toEqual(['original', 'landscape', 'vertical', 'square'])
  })

  it('vertical: blurred fill behind the picture by default, or a centre crop', () => {
    const pad = exportArgs({ preset: 'vertical', input: 'in.mp4', out: 'out.mp4', source: { width: 1920, height: 1080 } })
    expect(pad.join(' ')).toMatch(/boxblur/)
    expect(pad.join(' ')).toContain('1080:1920')
    const crop = exportArgs({ preset: 'vertical', fit: 'crop', input: 'in.mp4', out: 'out.mp4', source: { width: 1920, height: 1080 } })
    expect(crop.join(' ')).toMatch(/crop=/)
  })

  it('burns captions with the subtitles filter when asked', () => {
    const a = exportArgs({ preset: 'original', input: 'in.mp4', out: 'out.mp4', source: { width: 1280, height: 720 }, burnCaptions: 'caps.srt' })
    expect(a.join(' ')).toMatch(/subtitles=caps\.srt/)
  })

  it('renders for real: a 9:16 export with burned captions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-export-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(dir, 'in.mp4')])
    writeFileSync(join(dir, 'caps.srt'), toSrt([{ s: 0.2, e: 1.8, lines: ['Hello from Manul'] }]))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset: 'vertical', input: 'in.mp4', out: 'out.mp4', source: { width: 640, height: 360 }, burnCaptions: 'caps.srt' })], { cwd: dir })
    expect(await probe(join(dir, 'out.mp4'))).toMatchObject({ width: 1080, height: 1920, hasAudio: true })
  })
})

describe('filter path escaping', () => {
  it('escapes drive colons for both FFmpeg parsers and normalizes Windows separators', () => {
    expect(escapeFilterPath(String.raw`C:\My fonts\Inter`)).toBe(String.raw`C\\:/My\\\ fonts/Inter`)
    expect(escapeFilterPath(String.raw`\\server\share\My fonts`)).toBe(String.raw`//server/share/My\\\ fonts`)
    const options = { preset: 'original' as const, input: 'in.mp4', out: 'out.mp4', source: { width: 320, height: 180 },
      burnCaptions: String.raw`D:\Captions\O'Brien [cut],;.srt`, fontsDir: String.raw`C:\My fonts` }
    const args = exportArgs(options)
    expect(args[args.indexOf('-filter_complex') + 1]).toContain(`subtitles=${escapeFilterPath(options.burnCaptions)}:fontsdir=${escapeFilterPath(options.fontsDir)}:`)
    expect(escapeFilterValue('a:b')).toBe(String.raw`a\\:b`)
    expect(escapeFilterValue("a'b")).toBe(String.raw`a\\\'b`)
    expect(escapeFilterValue('a\\b')).toBe(String.raw`a\\\\b`)
    expect(escapeFilterValue('a[b],;')).toBe(String.raw`a\[b\]\,\;`)
  })

  it('renders real captions and loads fonts from punctuation-heavy absolute paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-escape-'))
    try {
      const fonts = join(dir, "My fonts [cut],; O'Brien %=set")
      mkdirSync(fonts)
      for (const file of ['Inter-Regular.ttf', 'Inter-Bold.ttf']) copyFileSync(join(import.meta.dirname, '..', 'resources', 'lib', 'fonts', file), join(fonts, file))
      const captions = join(dir, "Captions [cut],; O'Brien %=set.srt")
      writeFileSync(captions, toSrt([{ s: 0, e: 1, lines: ['Hello from Manul'] }]))
      const input = join(dir, 'in.mp4'), output = join(dir, 'out.mp4')
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=10:d=1', '-c:v', 'libx264', input])
      const rendered = spawnSync(FFMPEG, ['-y', '-loglevel', 'info', ...exportArgs({ preset: 'original', input, out: output,
        source: { width: 320, height: 180 }, burnCaptions: captions, fontsDir: fonts })], { encoding: 'utf8' })
      expect(rendered.status, rendered.stderr).toBe(0)
      expect(rendered.stderr).toMatch(/Loading font file.*Inter-Regular\.ttf/)
      expect(rendered.stderr).toMatch(/Loading font file.*Inter-Bold\.ttf/)
      expect(await probe(output)).toMatchObject({ width: 320, height: 180 })
      const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-ss', '0.5', '-i', output, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'])
      expect(raw.some(pixel => pixel > 200)).toBe(true)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it.skipIf(process.platform === 'win32')('passes drive-colon paths through real FFmpeg filter parsing on POSIX', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-drive-filter-'))
    try {
      const fonts = 'C:/My fonts [cut],; O\'Brien'
      const captions = 'D:/My captions [cut],; O\'Brien.srt'
      mkdirSync(join(dir, fonts), { recursive: true })
      mkdirSync(join(dir, 'D:'))
      copyFileSync(join(import.meta.dirname, '..', 'resources', 'lib', 'fonts', 'Inter-Regular.ttf'), join(dir, fonts, 'Inter-Regular.ttf'))
      writeFileSync(join(dir, captions), toSrt([{ s: 0, e: 1, lines: ['Windows drive path'] }]))
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=10:d=1', '-c:v', 'libx264', join(dir, 'in.mp4')])
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset: 'original', input: 'in.mp4', out: 'out.mp4',
        // Linux libavformat interprets a bare drive colon as a protocol; file: lets it open our simulated drive.
        source: { width: 320, height: 180 }, burnCaptions: `file:${captions}`, fontsDir: fonts })], { cwd: dir })
      expect(await probe(join(dir, 'out.mp4'))).toMatchObject({ width: 320, height: 180 })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('burned captions look right', () => {
  /** rows (as fractions of the height) that contain white caption pixels, on a black video */
  async function captionRows(preset: 'original' | 'vertical', w: number, h: number) {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-cap-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:rate=25:d=1`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(dir, 'in.mp4')])
    writeFileSync(join(dir, 'caps.srt'), toSrt([{ s: 0, e: 1, lines: ['Hello from Manul'] }]))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset, fit: 'crop', input: 'in.mp4', out: 'out.mp4', source: { width: w, height: h }, burnCaptions: 'caps.srt',
      fontsDir: join(import.meta.dirname, '..', 'resources', 'lib', 'fonts') })], { cwd: dir })
    const info = await probe(join(dir, 'out.mp4'))
    const raw = execFileSync(FFMPEG, ['-loglevel', 'error', '-ss', '0.5', '-i', join(dir, 'out.mp4'), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 })
    const rows: number[] = []
    for (let y = 0; y < info.height; y++) {
      let white = 0
      for (let x = 0; x < info.width; x++) if (raw[y * info.width + x] > 200) white++
      if (white > 2) rows.push(y / info.height)
    }
    return rows
  }

  it('landscape: one line in the bottom fifth, about 4–8% of the height tall', async () => {
    const rows = await captionRows('original', 1280, 720)
    expect(Math.min(...rows)).toBeGreaterThan(0.8)
    expect(Math.max(...rows)).toBeLessThan(0.97)
    const tall = Math.max(...rows) - Math.min(...rows)
    expect(tall).toBeGreaterThan(0.03); expect(tall).toBeLessThan(0.09)
  })

  it('vertical: above the bottom UI area, readable but not huge', async () => {
    const rows = await captionRows('vertical', 1080, 1920)
    expect(Math.min(...rows)).toBeGreaterThan(0.6)
    expect(Math.max(...rows)).toBeLessThan(0.88) // clear of the platform's buttons and caption area
    const tall = Math.max(...rows) - Math.min(...rows)
    expect(tall).toBeGreaterThan(0.02); expect(tall).toBeLessThan(0.06)
  })
})

describe('caption fonts', () => {
  it('ships Inter as TTF next to the woff2 (libass cannot read woff2, so captions would fall back to another font)', () => {
    const fonts = join(import.meta.dirname, '..', 'resources', 'lib', 'fonts')
    for (const f of ['Inter-Regular.ttf', 'Inter-Bold.ttf']) {
      const head = readFileSync(join(fonts, f)).subarray(0, 4)
      expect(head.equals(Buffer.from([0, 1, 0, 0]))).toBe(true) // a TrueType font
    }
  })
})

describe('how loud an export is', () => {
  it('offers the levels people publish at', () => {
    expect(LOUDNESS.map(l => [l.id, l.lufs])).toEqual([['none', undefined], ['online', -14], ['podcast', -16]])
  })
  it('is one change of level to the target', () => {
    expect(loudnessGain('online', { lufs: -23, peak: -12 })).toBe(9)
    expect(loudnessGain('podcast', { lufs: -23, peak: -12 })).toBe(7)
    expect(loudnessGain('online', { lufs: -9.5, peak: -0.2 })).toBe(-4.5)
  })
  it('stops short of the target rather than clip the loudest moment', () => {
    // 9 dB would reach the target, but the peak has only 2 dB of room below -1
    expect(loudnessGain('online', { lufs: -23, peak: -3 })).toBe(2)
    expect(loudnessGain('online', { lufs: -23, peak: -0.5 })).toBe(-0.5)
  })
  it('changes nothing when not asked, when there is nothing to measure, or when it is already there', () => {
    expect(loudnessGain('none', { lufs: -23, peak: -12 })).toBe(0)
    expect(loudnessGain(undefined, { lufs: -23, peak: -12 })).toBe(0)
    expect(loudnessGain('online', null)).toBe(0)
    expect(loudnessGain('online', { lufs: -Infinity, peak: -Infinity })).toBe(0)
    expect(loudnessGain('online', { lufs: NaN, peak: NaN })).toBe(0)
    expect(loudnessGain('online', { lufs: -14.2, peak: -6 })).toBe(0)
  })
  it('keeps the picture untouched when only the level changes, and leaves the sound alone otherwise', () => {
    const base = { preset: 'original' as const, input: 'in.mp4', out: 'out.mp4', source: { width: 1280, height: 720 } }
    expect(exportArgs(base).join(' ')).toContain('-c copy')
    expect(exportArgs({ ...base, gainDb: 0 }).join(' ')).toContain('-c copy')
    const louder = exportArgs({ ...base, gainDb: 6.5 }).join(' ')
    expect(louder).toContain('-c:v copy -af volume=6.5dB -c:a aac')
    expect(exportArgs({ ...base, preset: 'vertical', gainDb: -3 }).join(' ')).toContain('-af volume=-3dB -c:a aac')
    expect(exportArgs({ ...base, preset: 'vertical' }).join(' ')).not.toContain('volume=')
  })
  it('renders for real: a quiet film comes out at the level asked for, with room above its peaks', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-loud-'))
    try {
      // pink noise at about -30 LUFS, the kind of level a phone recording arrives at
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=10:d=6', '-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=6:amplitude=0.05',
        '-c:v', 'libx264', '-c:a', 'aac', '-shortest', 'in.mp4'], { cwd: dir })
      const before = await measureLoudness(join(dir, 'in.mp4'))
      expect(before!.lufs).toBeLessThan(-20)
      const gainDb = loudnessGain('online', before)
      expect(gainDb).toBeGreaterThan(3)
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...exportArgs({ preset: 'original', input: 'in.mp4', out: 'out.mp4', source: { width: 320, height: 180 }, gainDb })], { cwd: dir })
      const after = await measureLoudness(join(dir, 'out.mp4'))
      expect(after!.peak).toBeLessThanOrEqual(-0.5)
      // at the target, unless the peak got in the way; then as close as the peak allows
      const want = before!.lufs + gainDb
      expect(Math.abs(after!.lufs - want)).toBeLessThan(0.7)
      if (-1 - before!.peak >= -14 - before!.lufs) expect(Math.abs(after!.lufs + 14)).toBeLessThan(0.7)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('measures nothing in a film with no sound', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-loud-'))
    try {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=black:s=320x180:r=10:d=1', '-c:v', 'libx264', 'in.mp4'], { cwd: dir })
      expect(await measureLoudness(join(dir, 'in.mp4'))).toBeNull()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
