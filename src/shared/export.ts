// Exporting a film: size presets (original, 16:9, 9:16, 1:1) and captions from the transcript (SRT, or burned in).
import { isFiller } from './fillers'
import { escapeFilterPath } from './ffmpeg'
import type { Transcript } from './types'

export type Cue = { s: number; e: number; lines: string[] }

const MAX_LINE = 42, MAX_LINES = 2, MAX_DUR = 6

/** Speech → caption cues: fillers left out, a new cue at each sentence, ≤ 2 lines of ≤ 42 characters, ≤ 6 s each. */
export function captionCues(t: Transcript): Cue[] {
  const cues: Cue[] = []
  for (const seg of t.segments) {
    let words: { w: string; s: number; e: number }[] = []
    const flush = () => { if (words.length) cues.push({ s: words[0].s, e: words.at(-1)!.e, lines: wrap(words.map(w => w.w)) }) ; words = [] }
    for (const w of seg.words) {
      if (isFiller(w)) continue
      const next = [...words, w]
      if (words.length && (wrap(next.map(x => x.w)).length > MAX_LINES || w.e - words[0].s > MAX_DUR)) flush()
      words.push(w)
    }
    flush()
  }
  return cues
}

/** Greedy wrap into lines of at most MAX_LINE characters (a single long word gets its own line). */
function wrap(words: string[]): string[] {
  const lines: string[] = []
  for (const w of words) {
    const last = lines.at(-1)
    if (last != null && (last + ' ' + w).length <= MAX_LINE) lines[lines.length - 1] = last + ' ' + w
    else lines.push(w)
  }
  return lines
}

const stamp = (t: number) => {
  const ms = Math.round(t * 1000)
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${c.lines.join('\n')}\n`).join('\n')

export type PresetId = 'original' | 'landscape' | 'vertical' | 'square'
export const PRESETS: { id: PresetId; label: string; hint: string; size?: [number, number] }[] = [
  { id: 'original', label: 'Original', hint: 'Same size as the film' },
  { id: 'landscape', label: '16:9 · 1080p', hint: 'YouTube, websites', size: [1920, 1080] },
  { id: 'vertical', label: '9:16 · 1080×1920', hint: 'Shorts, Reels, TikTok', size: [1080, 1920] },
  { id: 'square', label: '1:1 · 1080×1080', hint: 'Feeds', size: [1080, 1080] },
]

export type ExportOptions = {
  preset: PresetId
  /** how a different shape is filled: a blurred copy behind the picture (default) or a centre crop */
  fit?: 'pad' | 'crop'
  input: string
  out: string
  source: { width: number; height: number }
  /** an .srt to burn into the picture (absolute, or relative to ffmpeg's cwd) */
  burnCaptions?: string
  /** folder with fonts for burned captions (Inter ships with AgentShot) */
  fontsDir?: string
  captionColor?: string
}

/** ffmpeg arguments (after "ffmpeg -y") for one export. */
export function exportArgs(o: ExportOptions): string[] {
  const preset = PRESETS.find(p => p.id === o.preset)!
  // No resize/captions: export the finished edit without a second lossy encode.
  if (!preset.size && !o.burnCaptions) return ['-i', o.input, '-map', '0:v', '-map', '0:a?', '-c', 'copy', '-movflags', '+faststart', o.out]
  const [W, H] = preset.size || [o.source.width - (o.source.width % 2), o.source.height - (o.source.height % 2)]
  const filters: string[] = []
  let label = '0:v'
  if (preset.size) {
    if (o.fit === 'crop') {
      filters.push(`[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1[pic]`)
    } else {
      filters.push(`[0:v]split[bgsrc][fgsrc]`)
      filters.push(`[bgsrc]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=40:2,eq=brightness=-0.08[bg]`)
      filters.push(`[fgsrc]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg]`)
      filters.push(`[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[pic]`)
    }
    label = 'pic'
  }
  if (o.burnCaptions) {
    // libass measures SRT styles on a 288-unit-tall canvas (PlayResY) whatever the video's size, and Inter's capitals
    // come out at 0.5 × the font size (measured; test/export.test.ts checks the result in pixels)
    const unit = (fracOfHeight: number) => Math.max(1, Math.round(fracOfHeight * 288))
    const tall = H > W
    const fontSize = unit((tall ? 0.032 : 0.045) / 0.5)
    const colour = assColour(o.captionColor || '#ffffff')
    const style = [`FontName=Inter`, `FontSize=${fontSize}`, `PrimaryColour=${colour}`, `OutlineColour=&H000000&`, `BorderStyle=1`,
      `Outline=${Math.max(1, Math.round(fontSize / 10))}`, `Shadow=0`, `Bold=1`,
      // vertical: well above the bottom, clear of the platform's buttons and caption area
      `MarginV=${unit(tall ? 0.2 : 0.07)}`, `Alignment=2`].join(',')
    filters.push(`[${label}]subtitles=${escapeFilterPath(o.burnCaptions)}${o.fontsDir ? `:fontsdir=${escapeFilterPath(o.fontsDir)}` : ''}:force_style='${style}'[cap]`)
    label = 'cap'
  }
  return [
    '-i', o.input,
    ...(filters.length ? ['-filter_complex', filters.join(';'), '-map', `[${label}]`] : ['-map', '0:v']),
    '-map', '0:a?',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    o.out,
  ]
}

/** #rrggbb → ASS &HBBGGRR& */
const assColour = (hex: string) => { const h = hex.replace('#', ''); return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase() }
