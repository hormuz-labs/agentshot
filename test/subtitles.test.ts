import { describe, expect, it } from 'vitest'
import { matchSubtitles, parseSubtitles, shiftSubtitles } from '../src/shared/subtitles'
import type { Word } from '../src/shared/types'

// a transcript: one sentence every 4 s from 30 s, each word 0.4 s
const lines = Array.from({ length: 40 }, (_, i) => `line number ${i} talks about ${['harbour', 'sunrise', 'engines', 'robots', 'coffee'][i % 5]} and ${['green', 'quiet', 'heavy', 'bright'][i % 4]} things`)
const words: Word[] = lines.flatMap((l, i) => l.split(' ').map((w, j) => ({ w, s: 30 + i * 4 + j * 0.4, e: 30 + i * 4 + j * 0.4 + 0.35 })))
const srt = (shift: number, text = (i: number) => lines[i]) => lines.map((_, i) => {
  const t = (x: number) => { const ms = Math.round(x * 1000); return `00:${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}` }
  return `${i + 1}\n${t(30 + i * 4 + shift)} --> ${t(30 + i * 4 + 3.6 + shift)}\n${text(i)}\n`
}).join('\n')

describe('do subtitles match the speech', () => {
  it('in time', () => {
    expect(matchSubtitles(parseSubtitles(srt(0), 'srt'), words)).toEqual({ match: 1, offset: 0 })
  })

  it('finds how late or early they are', () => {
    expect(matchSubtitles(parseSubtitles(srt(2.3), 'srt'), words)).toEqual({ match: 1, offset: 2.3 })
    expect(matchSubtitles(parseSubtitles(srt(-11.5), 'srt'), words)?.offset).toBe(-11.5)
  })

  it("another film's subtitles don't match", () => {
    const other = srt(0, i => `Do you recognise what this is, Changqing? Number ${i + 100}`)
    expect(matchSubtitles(parseSubtitles(other, 'srt'), words)!.match).toBeLessThan(0.2)
  })

  it('nothing to compare', () => {
    expect(matchSubtitles([], words)).toBeNull()
    expect(matchSubtitles(parseSubtitles(srt(0), 'srt'), [])).toBeNull()
  })
})

describe('shifting subtitle times', () => {
  it('SRT and WebVTT, never before zero', () => {
    expect(shiftSubtitles('1\r\n00:00:02,500 --> 00:00:04,000\r\nHi 00:00:09,000\r\n', 'srt', -2.3)).toBe('1\r\n00:00:00,200 --> 00:00:01,700\r\nHi 00:00:09,000\r\n')
    expect(shiftSubtitles('WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nHi\n', 'vtt', -1.5)).toBe('WEBVTT\n\n00:00:00.000 --> 00:00:01.000 align:start\nHi\n')
  })

  it('ASS keeps everything but the times', () => {
    const ass = '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\b1}Well, hi\n'
    expect(shiftSubtitles(ass, 'ass', 61)).toBe(ass.replace('0:00:01.50,0:00:03.00', '0:01:02.50,0:01:04.00'))
    expect(parseSubtitles(shiftSubtitles(ass, 'ass', 61), 'ass')).toEqual([{ s: 62.5, e: 64, text: 'Well, hi' }])
  })

  it('SBV', () => {
    expect(shiftSubtitles('0:00:00.500,0:00:01.000\nOne\n', 'sbv', 1)).toBe('0:00:01.500,0:00:02.000\nOne\n')
  })

  it('fixing a late file makes it match in time', () => {
    const fixed = shiftSubtitles(srt(2.3), 'srt', -2.3)
    expect(matchSubtitles(parseSubtitles(fixed, 'srt'), words)).toEqual({ match: 1, offset: 0 })
  })
})
