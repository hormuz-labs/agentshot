// The editor inside Claude and ChatGPT (src/mcp-app) is AgentShot's own film panel; it gets the project as the app has
// it, plus where its files play from. Only the files the film plays may be loaded, and only the calls the panel makes
// may be run (src/shared/editor-view.ts).
import { describe, expect, it } from 'vitest'
import { editorView, servable, mediaUrl, relOf, EDITOR_CALLS } from '../src/shared/editor-view'
import type { Project } from '../src/shared/types'

const project = (over: Partial<Project> = {}): Project => ({
  id: 'p1', title: 'Launch film', dir: '/films/launch', createdAt: 1,
  versions: [
    { id: 'v1', path: 'media/talk.mov', title: 'Original', createdAt: 1, by: 'import' },
    { id: 'v2', path: 'renders/tight.mp4', title: 'Tighter', createdAt: 2, by: 'agent', dry: 'renders/tight-dry.mp4' },
  ],
  current: 'v1', proposal: 'v2', notes: [],
  media: { 'media/talk.mov': { duration: 60, width: 3840, height: 2160, fps: 30 } as never, 'media/song.mp3': { duration: 90 } as never },
  proxies: { 'media/talk.mov': 'proxies/talk-ab12.mp4' },
  clips: { title: { id: 'title', title: 'Opening title', duration: 3, video: 'clips/title/clip.mp4', poster: 'clips/title/poster.jpg', updatedAt: 1 } },
  voiceovers: [{ id: 'vo1', src: 'voiceovers/vo1.webm', duration: 4 } as never],
  timeline: { width: 1920, height: 1080, fps: 30, items: [{ id: 'b', kind: 'media', src: 'media/talk.mov', in: 2, out: 10 }], mix: { filmDb: 0, music: { src: 'media/song.mp3', db: -12, duckDb: 10 } } },
  ...over,
})

describe('the editor’s view of a project', () => {
  it('is the project as the app has it, with the folder name the tools take and where its files play from', () => {
    const p = project()
    expect(editorView(p, { base: 'http://127.0.0.1:48620/media/k/', folder: 'launch', edited: true })).toEqual({ folder: 'launch', media: 'http://127.0.0.1:48620/media/k/', edited: true, project: p })
  })
})

describe('which files the page may load', () => {
  const p = project()
  it('allows what the film, its versions, clips, music and voiceovers play', () => {
    for (const rel of ['proxies/talk-ab12.mp4', 'media/talk.mov', 'media/song.mp3', 'renders/tight.mp4', 'renders/tight-dry.mp4', 'clips/title/clip.mp4', 'clips/title/poster.jpg', 'clips/title/clip.html', 'clips/title/assets/logo.png', 'voiceovers/vo1.webm']) expect(servable(p, rel), rel).toBe(true)
  })
  it('refuses anything else in the project, and anything outside it', () => {
    for (const rel of ['project.json', 'notes/secret.txt', '../other/media/talk.mov', 'media/../project.json', 'clips/title/../../project.json', 'clips/other/clip.html', 'clips/title/.secret', '/etc/passwd', 'media\\talk.mov', '', 'media/talk.mov\0']) expect(servable(p, rel), rel).toBe(false)
  })
  it('makes an address the page can load, keeping folders and escaping the rest', () => {
    expect(mediaUrl('http://h/media/k/', 'media/my talk #1.mov')).toBe('http://h/media/k/media/my%20talk%20%231.mov')
  })
  it('finds a file’s place in the project from the absolute path the panel asks for', () => {
    expect(relOf('/films/launch', '/films/launch/media/talk.mov')).toBe('media/talk.mov')
    expect(relOf('/films/launch', '/films/launch/clips/title/clip.html?v=3')).toBe('clips/title/clip.html')
    expect(relOf('/films/launch', '/films/other/media/talk.mov')).toBeUndefined()
    expect(relOf('C:\\films\\launch', 'C:\\films\\launch/media/talk.mov')).toBe('media/talk.mov')
  })
})

describe('what the page may ask AgentShot to do', () => {
  it('is the film panel’s own calls: editing, deciding, versions, history, thumbnails, export, voiceover', () => {
    for (const m of ['timeline:edit', 'timeline:undo', 'timeline:render', 'project:decide', 'project:current', 'history:log', 'history:restore', 'media:thumbnails', 'mix:speech', 'preview:prepare', 'export:run', 'export:editors', 'export:reveal', 'project:revealFile', 'project:downloadFile', 'clip:move', 'voiceover:begin', 'voiceover:save', 'voiceover:cancel', 'voiceover:access']) expect(EDITOR_CALLS, m).toContain(m)
  })
  it('never the agent, keys, settings, other projects or the browser', () => {
    for (const m of ['agent:send', 'keys:set', 'keys:list', 'project:open', 'project:delete', 'project:recent', 'browser:navigate', 'memory:save', 'account:adopt', 'keys:list', 'cloud:run']) expect(EDITOR_CALLS, m).not.toContain(m)
  })
})
