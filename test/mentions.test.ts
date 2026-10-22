// @ in the message box: what can be mentioned, finding the @word at the caret, putting the picked name in, the chips,
// and the line the agent reads for each.
import { describe, expect, it } from 'vitest'
import { insertMention, matches, mentionables, mentionAt, refChip } from '../src/renderer/src/lib/mentions'
import { refLine, refLines } from '../src/main/files'
import { joinAttached, splitAttached } from '../src/shared/attached'
import type { Project } from '../src/shared/types'

const p = {
  dir: '/p', title: 'Film', current: 'v2', proposal: 'v3',
  versions: [
    { id: 'v1', path: 'media/talk.mp4', title: 'Imported', createdAt: 0, by: 'import' },
    { id: 'v2', path: 'renders/timeline-2.mp4', title: 'Cut the ums', createdAt: 1, by: 'user' },
    { id: 'v3', path: 'renders/timeline-3.mp4', title: 'Proposed', createdAt: 2, by: 'agent' },
  ],
  media: { 'media/talk.mp4': { duration: 125 }, 'renders/timeline-2.mp4': { duration: 98.4 } },
  files: {
    'media/talk.mp4': { kind: 'video', size: 1, addedAt: 0, summary: 'video 1920×1080, 2:05' },
    'media/Brand Kit/logo.png': { kind: 'image', size: 1, addedAt: 0, summary: 'image 400×200' },
    'media/song.mp3': { kind: 'audio', size: 1, addedAt: 0, summary: 'audio 3:10' },
  },
  clips: { title: { id: 'title', title: 'Opening title', duration: 4, video: 'clips/title/clip.mp4', poster: '', updatedAt: 0 } },
  notes: [],
} as unknown as Project

describe('mentioning things in the project', () => {
  it('lists files, then versions (newest first, not the proposal, not the imported file twice), then clips', () => {
    expect(mentionables(p).map(m => [m.id, m.title])).toEqual([
      ['media/Brand Kit/logo.png', 'Brand Kit/logo.png'], ['media/song.mp3', 'song.mp3'], ['media/talk.mp4', 'talk.mp4'],
      ['renders/timeline-2.mp4', 'v2 · Cut the ums'],
      ['clips/title', 'Opening title'],
    ])
    expect(mentionables(p).find(m => m.id === 'renders/timeline-2.mp4')?.detail).toBe('Version on screen')
  })

  it('finds by name, kind or what it is', () => {
    const all = mentionables(p)
    expect(matches(all, 'song')[0].id).toBe('media/song.mp3')
    expect(matches(all, 'v2')[0].id).toBe('renders/timeline-2.mp4')
    expect(matches(all, 'clip').map(m => m.id)).toContain('clips/title')
    expect(matches(all, 'logo')[0].id).toBe('media/Brand Kit/logo.png')
    expect(matches(all, '')).toHaveLength(5)
  })

  it('opens on an @ at the start or after a space, up to the caret', () => {
    expect(mentionAt('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionAt('use @so here', 7)).toEqual({ start: 4, query: 'so' })
    expect(mentionAt('mail me at a@b.com', 18)).toBeNull()
    expect(mentionAt('use @song.mp3 here', 18)).toBeNull()
  })

  it('puts the picked name in place of the @word, with the caret after it', () => {
    const song = mentionables(p).find(m => m.id === 'media/song.mp3')!
    expect(insertMention('use @so here', { start: 4, query: 'so' }, song)).toEqual({ text: 'use @song.mp3 here', caret: 13 })
    expect(insertMention('use @', { start: 4, query: '' }, song)).toEqual({ text: 'use @song.mp3 ', caret: 14 })
  })

  it('shows chips by name: a file, a version as v2 · title, a clip by its title', () => {
    expect(refChip(p, 'media/Brand Kit/logo.png')).toEqual({ label: 'Brand Kit/logo.png', kind: 'image' })
    expect(refChip(p, 'renders/timeline-2.mp4')).toEqual({ label: 'v2 · Cut the ums', kind: 'video' })
    expect(refChip(p, 'clips/title')).toEqual({ label: 'Opening title', kind: 'clip' })
  })

  it('tells the agent what each one is, and comes back as chips in the sent message', () => {
    expect(refLine('media/song.mp3', p)).toBe('media/song.mp3 — audio 3:10')
    expect(refLine('renders/timeline-2.mp4', p)).toBe('renders/timeline-2.mp4 — version v2 of the film, “Cut the ums”, 1:38 (the one on screen)')
    expect(refLine('clips/title', p)).toBe('clips/title — motion clip title, “Opening title”, 4 s (clip.html in that folder)')
    const m = joinAttached('Use @song.mp3 under @v2 · Cut the ums', refLines(['media/song.mp3', 'renders/timeline-2.mp4', 'clips/title'], p))
    expect(splitAttached(m).files).toEqual(['media/song.mp3', 'renders/timeline-2.mp4', 'clips/title'])
  })
})
