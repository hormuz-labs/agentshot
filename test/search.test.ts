import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { kindsFor, mentions, saidHits, searchReport, seenRanges, stem } from '../src/main/search'
import { fileLine, sourceLine } from '../src/main/files'
import { rangesOf } from '../src/shared/timeline'
import { editorExtension } from '../src/main/agent'
import type { Det } from '../src/main/subjects'
import type { FileInfo } from '../src/shared/types'

const det = (t: number, kind: string, size = 0.2, score = 0.9): Det => ({ t, kind, score, x: 0.1, y: 0.1, w: size, h: 1 })
const words = (text: string, t0 = 0) => text.split(' ').map((w, i) => ({ w, s: t0 + i * 0.5, e: t0 + i * 0.5 + 0.4 }))
const transcript = { segments: [
  { s: 0, e: 3, text: 'Hello and welcome back.', words: words('Hello and welcome back.') },
  { s: 10, e: 14, text: 'Thank you, everyone. Thank you so much!', words: words('Thank you, everyone. Thank you so much!', 10) },
] }

describe('what a search for something shown means', () => {
  it('knows the detector’s own names, their plurals and everyday words for them', () => {
    expect(kindsFor('dog')).toEqual(['dog'])
    expect(kindsFor('the dogs')).toEqual(['dog'])
    expect(kindsFor('a puppy on a sofa')).toEqual(['dog', 'couch'])
    expect(kindsFor('two people and a bike')).toEqual(['person', 'bicycle'])
    expect(kindsFor('her FACE')).toEqual(['face'])
    expect(kindsFor('someone on their phone')).toEqual(['person', 'cell phone'])
    expect(kindsFor('traffic lights')).toEqual(['traffic light'])
    expect(kindsFor('buses')).toEqual(['bus'])
    expect(kindsFor('horses and sheep')).toEqual(['horse', 'sheep'])
  })
  it('means nothing it can’t see', () => {
    expect(kindsFor('a sunset over the beach')).toEqual([])
    expect(kindsFor('')).toEqual([])
  })
  it('brings words down to themselves', () => {
    expect(['dogs', 'boxes', 'running', 'parties', 'glass', 'bus'].map(stem)).toEqual(['dog', 'box', 'runn', 'party', 'glass', 'bus'])
  })
})

describe('when something is on screen', () => {
  it('joins sightings a moment apart into one stretch and drops a single stray frame', () => {
    const dets = [det(1, 'dog'), det(1.5, 'dog', 0.4), det(2, 'dog'), det(9, 'dog'), det(20, 'dog'), det(20.5, 'dog'), det(1, 'person')]
    expect(seenRanges(dets, ['dog'])).toEqual([{ kind: 'dog', s: 1, e: 2, size: 0.4 }, { kind: 'dog', s: 20, e: 20.5, size: 0.2 }])
  })
  it('ignores what the detector wasn’t sure of, and kinds not asked for', () => {
    expect(seenRanges([det(1, 'cat', 0.2, 0.3), det(1.5, 'cat', 0.2, 0.3), det(1, 'dog'), det(1.4, 'dog')], ['cat'])).toEqual([])
  })
  it('lists several kinds in the order they appear', () => {
    const dets = [det(5, 'dog'), det(5.5, 'dog'), det(1, 'car'), det(2, 'car')]
    expect(seenRanges(dets, ['dog', 'car']).map(r => r.kind)).toEqual(['car', 'dog'])
  })
})

describe('where something is said', () => {
  it('finds a phrase whatever its capitals and punctuation, each time it is said', () => {
    expect(saidHits(transcript, 'thank you')).toEqual([
      { s: 10, e: 10.9, text: 'Thank you, everyone. Thank you so much!' },
      { s: 11.5, e: 12.4, text: 'Thank you, everyone. Thank you so much!' },
    ])
    expect(saidHits(transcript, 'WELCOME')).toEqual([{ s: 1, e: 1.4, text: 'Hello and welcome back.' }])
  })
  it('lets the last word be the start of one ("welc" finds "welcome")', () => expect(saidHits(transcript, 'and welc')).toHaveLength(1))
  it('finds nothing for words that aren’t there, in that order, or for nothing', () => {
    expect(saidHits(transcript, 'goodbye')).toEqual([])
    expect(saidHits(transcript, 'you thank')).toEqual([])
    expect(saidHits(transcript, '  ')).toEqual([])
  })
})

describe('what was written about a file', () => {
  it('matches when every word asked for is there, plural or not', () => {
    expect(mentions('0:12 two dogs run along the beach at sunset', 'dog beach')).toBe(true)
    expect(mentions('0:12 two dogs run along the beach', 'sunset beach')).toBe(false)
    expect(mentions('anything', 'a')).toBe(false)
  })
  it('comes back to the agent with the file, with where it came from', () => {
    const files: Record<string, FileInfo> = { 'media/song.mp3': { kind: 'audio', size: 1, addedAt: 0, summary: 'audio, 3:12',
      notes: 'drop at 0:42', source: { page: 'https://example.com/track', licence: 'CC BY 4.0' } }, 'media/a.mp4': { kind: 'video', size: 1, addedAt: 0, summary: 'video, 0:10' } }
    expect(fileLine('media/song.mp3', files)).toBe('media/song.mp3 — audio, 3:12; from https://example.com/track (CC BY 4.0); your notes (times are this file\'s own, not the film\'s): drop at 0:42')
    expect(fileLine('media/a.mp4', files)).toBe('media/a.mp4 — video, 0:10')
  })
  it('is one line of the sources list', () => {
    expect(sourceLine('media/song.mp3', { page: ' https://example.com/track ', licence: 'CC\nBY 4.0' }, new Date('2026-11-26T10:00:00Z'))).toBe('2026-11-26  media/song.mp3  https://example.com/track  CC BY 4.0')
  })
})

describe('the answer', () => {
  it('gives each file its moments, ready to cut on', () => {
    const r = searchReport({ shows: 'dog', said: 'thank you' }, [
      { rel: 'media/park.mp4', seen: [{ kind: 'dog', s: 61, e: 75.5, size: 0.3 }], said: [] },
      { rel: 'media/talk.mp4', seen: [], said: [{ s: 10, e: 10.9, text: 'Thank you, everyone.' }], notes: 'dog asleep under the desk throughout' },
      { rel: 'media/empty.mp4', seen: [], said: [] },
    ], { kinds: ['dog'], unheard: ['media/raw.mov'] })
    expect(r).toBe([
      'media/park.mp4', '  shows dog 1:01.0–1:15.5 (large in frame)',
      'media/talk.mp4', '  said 0:10.0–0:10.9: Thank you, everyone.', '  your notes: dog asleep under the desk throughout',
      'Times are each file\'s own (seconds into that file); they don\'t move when the film is cut. To cut one of these moments, give edit_timeline the file as src with these times.',
      'No transcript yet (call transcript on them to search what\'s said): media/raw.mov',
    ].join('\n'))
  })
  it('says where each moment plays in the film as it is cut now, or that the cut left it out', () => {
    // the film: 20–30 s of park.mp4, then 60–70 s of it. So 61–75.5 s of the file plays at 11–20 s; 0–5 s is cut.
    const tl = { width: 1920, height: 1080, fps: 30, items: [
      { id: 'a', kind: 'media' as const, src: 'media/park.mp4', in: 20, out: 30 }, { id: 'b', kind: 'media' as const, src: 'media/park.mp4', in: 60, out: 70 }] }
    const inFilm = (rel: string, s: number, e: number) => (tl.items.some(i => i.src === rel) ? rangesOf(tl, rel, s, e) : null)
    const r = searchReport({ shows: 'dog', said: 'hello' }, [
      { rel: 'media/park.mp4', seen: [{ kind: 'dog', s: 61, e: 75.5, size: 0.05 }, { kind: 'dog', s: 0, e: 5, size: 0.05 }, { kind: 'dog', s: 25, e: 65, size: 0.05 }] },
      { rel: 'media/other.mp4', said: [{ s: 3, e: 3.4, text: 'Hello.' }] },
    ], { kinds: ['dog'], inFilm })
    expect(r).toContain('  shows dog 1:01.0–1:15.5 → in the film now at 0:11.0–0:20.0')
    expect(r).toContain('  shows dog 0:00.0–0:05.0 → cut out of the film now')
    // one stretch of the file the cut split in two
    expect(r).toContain('  shows dog 0:25.0–1:05.0 → in the film now at 0:05.0–0:10.0, 0:10.0–0:15.0')
    // a file the edit doesn't name: nothing is claimed about the film
    expect(r).toContain('  said 0:03.0–0:03.4: Hello.')
  })
  it('says so when nothing is found, and when the thing asked for can’t be told by sight', () => {
    expect(searchReport({ shows: 'sunset' }, [{ rel: 'media/a.mp4' }], { kinds: [] })).toContain('Nothing found for shows "sunset".')
    expect(searchReport({ shows: 'sunset' }, [{ rel: 'media/a.mp4' }], { kinds: [] })).toContain('isn\'t something detection knows by sight')
  })
})

describe('the tools', () => {
  function project() {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-search-'))
    mkdirSync(join(dir, 'media')); mkdirSync(join(dir, 'transcripts'))
    for (const f of ['talk.mp4', 'raw.mov', 'song.mp3']) writeFileSync(join(dir, 'media', f), 'x')
    mkdirSync(join(dir, 'renders')); writeFileSync(join(dir, 'renders', 'v2.mp4'), 'x')
    writeFileSync(join(dir, 'transcripts', 'talk.json'), JSON.stringify(transcript))
    const file = (kind: FileInfo['kind']): FileInfo => ({ kind, size: 1, addedAt: 0, summary: kind })
    // the film as cut: only 9–13 s of talk.mp4, so its 10 s plays at 1 s
    const p = { dir, timeline: { width: 1920, height: 1080, fps: 30, items: [{ id: 'a', kind: 'media', src: 'media/talk.mp4', in: 9, out: 13 }] },
      files: { 'media/talk.mp4': file('video'), 'media/raw.mov': file('video'), 'media/song.mp3': file('audio'), 'renders/v2.mp4': file('video') } as Record<string, FileInfo>,
      media: { 'media/talk.mp4': { hasAudio: true, width: 1920 }, 'media/raw.mov': { hasAudio: true, width: 1920 }, 'media/song.mp3': { hasAudio: true } },
      transcripts: { 'media/talk.mp4': 'transcripts/talk.json' } }
    const noted: [string, string][] = []
    const bridge = { project: () => p, noteFile: async (_d: string, rel: string, notes: string) => { noted.push([rel, notes]); if (notes) p.files[rel].notes = notes; else delete p.files[rel].notes } }
    const tools = (editorExtension(bridge as never, () => dir) as unknown as { tools: { name: string; execute: (a: object, api: object) => Promise<{ content: { text: string }[] }> }[] }).tools
    const run = async (name: string, args: object) => (await tools.find(t => t.name === name)!.execute(args, { conversationId: '1' })).content[0].text
    return { p, noted, run }
  }
  it('note_file keeps notes on a project file, replaces them, forgets them, and refuses other paths', async () => {
    const { p, noted, run } = project()
    expect(await run('note_file', { path: 'media/talk.mp4', notes: ' 0:10 she thanks everyone; sunset behind her ' })).toBe('Noted on media/talk.mp4.')
    expect(p.files['media/talk.mp4'].notes).toBe('0:10 she thanks everyone; sunset behind her')
    expect(await run('note_file', { path: 'media/talk.mp4', notes: '' })).toBe('Forgot the notes on media/talk.mp4.')
    expect(noted).toEqual([['media/talk.mp4', '0:10 she thanks everyone; sunset behind her'], ['media/talk.mp4', '']])
    await expect(run('note_file', { path: 'media/missing.mp4', notes: 'x' })).rejects.toThrow(/not one of the project's files/)
    await expect(run('note_file', { path: '../elsewhere.mp4', notes: 'x' })).rejects.toThrow(/inside the project/)
    // a cut of the film: its times are gone with the next cut
    await expect(run('note_file', { path: 'renders/v2.mp4', notes: '0:05 title' })).rejects.toThrow(/its times change with the next cut/)
  })
  it('search_footage finds what is said in transcripts already made, and names the files it couldn’t listen to', async () => {
    const { run } = project()
    const r = await run('search_footage', { said: 'thank you' })
    // the file's own times, and where that moment is in the film after the cut; the second thank-you too
    expect(r).toContain('media/talk.mp4\n  said 0:10.0–0:10.9 → in the film now at 0:01.0–0:01.9: Thank you, everyone. Thank you so much!')
    expect(r).toContain('  said 0:11.5–0:12.4 → in the film now at 0:02.5–0:03.4')
    expect(r).toContain('No transcript yet (call transcript on them to search what\'s said): media/raw.mov, media/song.mp3')
  })
  it('search_footage finds by the agent’s own notes what detection can’t tell by sight', async () => {
    const { run } = project()
    await run('note_file', { path: 'media/talk.mp4', notes: '0:10 she thanks everyone; sunset behind her' })
    const r = await run('search_footage', { shows: 'sunset' })
    expect(r).toContain('media/talk.mp4\n  your notes: 0:10 she thanks everyone; sunset behind her')
    expect(r).not.toContain('Nothing found')
    await expect(run('search_footage', {})).rejects.toThrow('Give shows, said, or both.')
  })
})
