// Subtitle files (SRT, WebVTT, SBV, ASS/SSA): their cues, how well they match what the transcript heard (and how far
// their times are off), and shifting their times. Shared by the main process and the transcript panel.
import type { Word } from './types'

export type Cue = { s: number; e: number; text: string }

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/
const seconds = (s: string) => {
  const m = TIME.exec(s)
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(`0.${m[4]}`) : NaN
}
/** A cue's words: no styling tags ({\an8}, <i>, <v Name>), ASS line breaks as new lines. */
const plain = (s: string) => s.replace(/\{[^}]*\}/g, '').replace(/<[^>]+>/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim()

/** The cues of an SRT, WebVTT, SBV or ASS/SSA file, in time order. */
export function parseSubtitles(text: string, format: string): Cue[] {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
  const cues: Cue[] = []
  const push = (s: number, e: number, t: string) => { if (e >= s && t) cues.push({ s, e, text: t }) }
  if (format === 'ass' || format === 'ssa') {
    let fields: string[] | null = null, events = false
    for (const raw of src.split('\n')) {
      const l = raw.trim()
      if (l.startsWith('[')) { events = l.toLowerCase() === '[events]'; continue }
      if (!events) continue
      if (/^format\s*:/i.test(l)) fields = l.slice(l.indexOf(':') + 1).split(',').map(f => f.trim().toLowerCase())
      else if (/^dialogue\s*:/i.test(l)) {
        const f = fields || ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text']
        const parts = l.slice(l.indexOf(':') + 1).split(',') // the text is the last field and may hold commas
        push(seconds(parts[f.indexOf('start')] || ''), seconds(parts[f.indexOf('end')] || ''), plain(parts.slice(f.length - 1).join(',')))
      }
    }
  } else {
    const timing = format === 'sbv' ? /^\s*\d+:\d{2}:\d{2}\.\d+\s*,\s*\d+:\d{2}:\d{2}\.\d+/ : /-->/
    for (const block of src.split(/\n[ \t]*\n/)) {
      const lines = block.split('\n')
      const at = lines.findIndex(l => timing.test(l))
      if (at < 0) continue // the WEBVTT header, NOTE and STYLE blocks
      const [a, b] = format === 'sbv' ? lines[at].split(',') : lines[at].split('-->')
      push(seconds(a), seconds(b ?? ''), plain(lines.slice(at + 1).join('\n')))
    }
  }
  return cues.sort((x, y) => x.s - y.s)
}

// ---------------------------------------------------------------- do they match the speech?
const norm = (w: string) => w.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '')

/** How well subtitles match what the transcript heard: the share of lines (with 2+ words of 3+ letters) whose words
 *  are mostly said within the line's time, at the best shift of the subtitles' times (seconds; positive = the
 *  subtitles come late, so shifting them by -offset fixes them). Null without lines or words to compare. */
export function matchSubtitles(cues: Cue[], words: Word[]): { match: number; offset: number } | null {
  const said = words.map(w => ({ k: norm(w.w), s: w.s, e: w.e })).filter(w => w.k.length >= 3).sort((a, b) => a.s - b.s)
  const lines = cues.map(c => ({ ...c, ks: [...new Set(c.text.split(/\s+/).map(norm).filter(k => k.length >= 3))] })).filter(c => c.ks.length >= 2)
  if (!said.length || !lines.length) return null
  const sample = lines.length > 400 ? lines.filter((_, i) => i % Math.ceil(lines.length / 400) === 0) : lines
  const first = (t: number) => { let lo = 0, hi = said.length; while (lo < hi) { const m = (lo + hi) >> 1; if (said[m].e < t) lo = m + 1; else hi = m } return lo }
  // the share of a line's words said within its time (moved by offset, widened by pad), averaged; or the share of lines
  // with most of their words said
  const score = (offset: number, pad: number, lines = false) => {
    let sum = 0
    for (const c of sample) {
      const near = new Set<string>()
      for (let i = first(c.s - offset - pad); i < said.length && said[i].s <= c.e - offset + pad; i++) near.add(said[i].k)
      const found = c.ks.filter(k => near.has(k)).length / c.ks.length
      sum += lines ? (found >= 0.5 ? 1 : 0) : found
    }
    return sum / sample.length
  }
  // many shifts around the right one score the same (a window holds its words a little early or late): take the
  // middle of the best-scoring stretch (the one nearest no shift, if there are several)
  const centre = (from: number, to: number, step: number, pad: number) => {
    const xs: [number, number][] = []
    for (let o = from; o <= to + 1e-9; o += step) xs.push([o, score(o, pad)])
    const top = Math.max(...xs.map(x => x[1]))
    const runs: [number, number][] = []
    xs.forEach(([o, v], i) => { if (v >= top - 1e-9) { if (runs.length && xs[i - 1]?.[1] >= top - 1e-9) runs[runs.length - 1][1] = o; else runs.push([o, o]) } })
    const [a, b] = runs.reduce((x, y) => (Math.abs((y[0] + y[1]) / 2) < Math.abs((x[0] + x[1]) / 2) ? y : x))
    return (a + b) / 2
  }
  // coarse (0.5 s steps, a wide window) over ±60 s, then fine (0.05 s, a tight window) around it
  const coarse = centre(-60, 60, 0.5, 1.2)
  const offset = Math.round(centre(coarse - 2, coarse + 2, 0.05, 0.2) * 10) / 10
  return { match: Math.round(score(offset, 0.6, true) * 100) / 100, offset: Math.abs(offset) < 0.3 ? 0 : offset }
}

// ---------------------------------------------------------------- shifting times
const two = (n: number, w = 2) => String(n).padStart(w, '0')
function stamp(t: number, format: string) {
  const ms = Math.max(0, Math.round(t * 1000))
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60, frac = ms % 1000
  if (format === 'ass' || format === 'ssa') return `${h}:${two(m)}:${two(sec)}.${two(Math.floor(frac / 10))}`
  if (format === 'sbv') return `${h}:${two(m)}:${two(sec)}.${two(frac, 3)}`
  return `${two(h)}:${two(m)}:${two(sec)}${format === 'vtt' ? '.' : ','}${two(frac, 3)}`
}

/** The same subtitle file with every cue moved by delta seconds (earlier when negative; never before 0). */
export function shiftSubtitles(text: string, format: string, delta: number): string {
  const move = (t: string) => stamp(seconds(t) + delta, format)
  const any = /(?:\d+:)?\d{1,2}:\d{2}[,.]\d{1,3}/g
  return text.split(/(\r?\n)/).map(line => {
    if (format === 'ass' || format === 'ssa') {
      const m = /^(\s*(?:dialogue|comment)\s*:\s*[^,]*,)([^,]+),([^,]+)(,.*)$/i.exec(line)
      return m ? `${m[1]}${move(m[2])},${move(m[3])}${m[4]}` : line
    }
    if (format === 'sbv') return /^\s*\d+:\d{2}:\d{2}\.\d+\s*,\s*\d+:\d{2}:\d{2}\.\d+/.test(line) ? line.replace(any, move) : line
    return line.includes('-->') ? line.replace(any, move) : line
  }).join('')
}
