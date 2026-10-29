import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { app } from 'electron'
import { FFMPEG } from '../src/main/media'

const root = mkdtempSync(join(tmpdir(), 'agentshot-proj-'))
const previousRoot = process.env.MANUL_PROJECTS
process.env.MANUL_PROJECTS = join(root, 'projects')
const Projects = await import('../src/main/projects')
const clip = join(root, 'My Clip.mp4')

beforeAll(() => {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
})
afterAll(() => {
  if (previousRoot === undefined) delete process.env.MANUL_PROJECTS
  else process.env.MANUL_PROJECTS = previousRoot
  rmSync(root, { recursive: true, force: true })
})

describe('projects', () => {
  it('creates a self-contained project from a file', async () => {
    const p = await Projects.createFromFile(clip)
    expect(p.dir).toBe(join(process.env.MANUL_PROJECTS!, 'my-clip'))
    expect(p.versions).toHaveLength(1)
    expect(existsSync(join(p.dir, 'media', 'My Clip.mp4'))).toBe(true)
    expect(existsSync(join(p.dir, 'thumb.jpg'))).toBe(true)
    expect(p.media['media/My Clip.mp4']).toMatchObject({ width: 320, height: 240, fps: 25, hasAudio: true, codec: 'h264' })
    expect(p.media['media/My Clip.mp4'].duration).toBeCloseTo(2, 0)
  })

  it('names a project from a phone-numbered file by its day, and reads older ones that way too', async () => {
    const numbered = join(root, '5959.mp4')
    writeFileSync(numbered, readFileSync(clip))
    const p = await Projects.createFromFiles([numbered])
    expect(p.title).toMatch(/^Video from \d{1,2} [A-Z][a-z]{2}$/)
    expect(p.dir).toMatch(/video-from-/)
    // a project titled by its number before this
    writeFileSync(join(p.dir, 'project.json'), JSON.stringify({ ...JSON.parse(readFileSync(join(p.dir, 'project.json'), 'utf8')), title: '5959' }))
    expect((await Projects.load(p.dir)).title).toBe(p.title)
  })

  it('starts with a timeline of the whole file in its own format', async () => {
    const p = await Projects.createFromFile(clip)
    expect(p.timeline).toMatchObject({ width: 320, height: 240, fps: 25, items: [{ kind: 'media', src: 'media/My Clip.mp4', in: 0 }] })
    expect((p.timeline!.items[0] as { out: number }).out).toBeCloseTo(2, 0)
  })

  it('persists a startup model selection before a footage project is opened', async () => {
    const model = { provider: 'azure', modelId: 'gpt-6.1-sol' }
    const p = await Projects.createFromFiles([clip], undefined, model)
    expect(p.model).toEqual(model)
    expect(JSON.parse(readFileSync(join(p.dir, 'project.json'), 'utf8')).model).toEqual(model)
    expect((await Projects.load(p.dir)).model).toEqual(model)
  })

  it.each([false, true])('persists startup model selection for motion/walkthrough projects (walkthrough=%s)', async walkthrough => {
    const model = { provider: 'azure', modelId: 'gpt-6.1-sol' }
    const p = await Projects.createMotion({ title: 'Model choice', aspect: '16:9', walkthrough, model })
    expect(JSON.parse(readFileSync(join(p.dir, 'project.json'), 'utf8')).model).toEqual(model)
    expect((await Projects.load(p.dir)).model).toEqual(model)
  })

  it('gives older projects a timeline when they load', async () => {
    const p = await Projects.createFromFile(clip)
    delete p.timeline
    await Projects.save(p)
    expect((await Projects.load(p.dir)).timeline?.items).toHaveLength(1)
  })

  it('accepting a version makes it the new timeline', async () => {
    const p = await Projects.createFromFile(clip)
    const v = await Projects.addVersion(p, join(p.dir, 'media', 'My Clip.mp4'), 'Same', 'agent')
    Projects.accept(p, v.id)
    expect(p.current).toBe(v.id)
    expect(p.timeline!.items).toEqual([expect.objectContaining({ kind: 'media', src: v.path })])
  })

  it('accepting a version made from a timeline keeps that timeline (clips and cuts stay editable)', async () => {
    const p = await Projects.createFromFile(clip)
    const tl = { ...p.timeline!, items: [...p.timeline!.items, { id: 'c1', kind: 'clip' as const, clip: 'title', dur: 2 }] }
    const v = await Projects.addVersion(p, join(p.dir, 'media', 'My Clip.mp4'), 'With title', 'agent', tl)
    Projects.accept(p, v.id)
    expect(p.timeline!.items.map(i => i.kind)).toEqual(['media', 'clip'])
  })

  it('starts a motion video on a blank canvas in the chosen format, with a reference', async () => {
    const p = await Projects.createMotion({ title: 'Launch film', aspect: '9:16', length: 15, reference: clip })
    expect(p.dir).toBe(join(process.env.MANUL_PROJECTS!, 'launch-film'))
    expect(p.motion).toEqual({ aspect: '9:16', length: 15, reference: 'media/My Clip.mp4', canvas: 'media/canvas.mp4' })
    expect(p.versions).toMatchObject([{ path: 'media/canvas.mp4', title: 'Blank canvas' }])
    expect(p.timeline).toMatchObject({ width: 1080, height: 1920, fps: 60, items: [{ kind: 'media', src: 'media/canvas.mp4' }] })
    expect(p.media['media/canvas.mp4']).toMatchObject({ width: 1080, height: 1920, hasAudio: false })
    expect(existsSync(join(p.dir, 'media', 'My Clip.mp4'))).toBe(true)
  })

  it('refuses a reference that is not a video, and leaves nothing behind', async () => {
    const notes = join(root, 'notes.txt')
    writeFileSync(notes, 'hi\n')
    await expect(Projects.createMotion({ title: 'Bad ref', aspect: '16:9', reference: notes })).rejects.toThrow('has to be a video')
    expect(existsSync(join(process.env.MANUL_PROJECTS!, 'bad-ref'))).toBe(false)
  })

  it('refuses an example that is not in the gallery', async () => {
    await expect(Projects.createMotion({ title: 'Gone', aspect: '16:9', example: 'no-such-example' })).rejects.toThrow('no longer in the gallery')
  })

  it('never overwrites: a second project from the same file gets its own folder', async () => {
    const a = await Projects.createFromFile(clip)
    const b = await Projects.createFromFile(clip)
    expect(b.dir).not.toBe(a.dir)
    expect(b.dir).toMatch(/my-clip-\d+$/)
  })

  it('moves a project to the Trash and removes its recent-project record', async () => {
    const p = await Projects.createFromFile(clip)
    const trashed: string[] = []
    await Projects.deleteProject(p, async dir => { trashed.push(dir); rmSync(dir, { recursive: true, force: true }) })
    expect(trashed).toEqual([p.dir])
    expect(existsSync(p.dir)).toBe(false)
    const saved = JSON.parse(readFileSync(join(app.getPath('userData'), 'recent.json'), 'utf8')) as { dir: string }[]
    expect(saved.some(r => r.dir === p.dir)).toBe(false)
  })

  it('imports media under a free name and remembers notes with stills', async () => {
    const p = await Projects.createFromFile(clip)
    expect(await Projects.importMedia(p, clip)).toBe('media/My Clip-2.mp4')
    const n = await Projects.addNote(p, { anchor: { t0: 1, box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }, text: 'blur' }, Buffer.from('jpeg'))
    expect(n.status).toBe('open')
    expect(n.still).toMatch(/^notes\/[^/]+\.jpg$/)
    expect(readFileSync(join(p.dir, n.still!), 'utf8')).toBe('jpeg')
    const again = await Projects.load(p.dir)
    expect(again.notes[0].text).toBe('blur')
    expect(Projects.recent()[0].dir).toBe(p.dir)
  })

  it('normalizes an older Windows project, including lookup keys and saved timelines', async () => {
    const p = await Projects.createFromFile(clip)
    const dir = p.dir
    const info = p.media['media/My Clip.mp4']
    p.dir = 'C:\\Users\\Me\\Videos\\AgentShot\\my-clip'
    p.media = { 'media\\My Clip.mp4': info }
    p.versions[0].path = 'media\\My Clip.mp4'
    p.versions[0].dry = 'renders\\dry.mp4'
    p.timeline!.items = [{ id: 'm', kind: 'media', src: 'media\\My Clip.mp4', in: 0, out: 2 }]
    p.timeline!.mix = { filmDb: 0, music: { src: 'media\\music.mp3', db: -10, duckDb: 6 } }
    p.versions[0].timeline = structuredClone(p.timeline!)
    p.proxies = { 'media\\My Clip.mp4': 'proxies\\My Clip.mp4' }
    p.transcripts = { 'media\\My Clip.mp4': 'transcripts\\My Clip.json' }
    p.clips = { title: { id: 'title', title: 'Title', duration: 2, video: 'clips\\title\\clip.mp4', poster: 'clips\\title\\poster.jpg', updatedAt: 0 } }
    p.notes = [{ id: 'n', anchor: { t0: 0 }, text: 'note', still: 'notes\\n.jpg', status: 'open', createdAt: 0 }]
    // Save at its current disk location while preserving the original platform marker in project.json.
    await writeFile(join(dir, 'project.json'), JSON.stringify(p))
    const loaded = await Projects.load(dir)
    expect(loaded.dir).toBe(dir)
    expect(loaded.media).toEqual({ 'media/My Clip.mp4': info })
    expect(loaded.versions[0]).toMatchObject({ path: 'media/My Clip.mp4', dry: 'renders/dry.mp4' })
    expect(loaded.timeline!.items[0]).toMatchObject({ src: 'media/My Clip.mp4' })
    expect(loaded.versions[0].timeline!.items[0]).toMatchObject({ src: 'media/My Clip.mp4' })
    expect(loaded.timeline!.mix!.music!.src).toBe('media/music.mp3')
    expect(loaded.proxies).toEqual({ 'media/My Clip.mp4': 'proxies/My Clip.mp4' })
    expect(loaded.transcripts).toEqual({ 'media/My Clip.mp4': 'transcripts/My Clip.json' })
    expect(loaded.clips!.title).toMatchObject({ video: 'clips/title/clip.mp4', poster: 'clips/title/poster.jpg' })
    expect(loaded.notes[0].still).toBe('notes/n.jpg')
    await Projects.save(loaded)
    expect((await Projects.load(dir)).media).toEqual(loaded.media)
  })

  it.skipIf(process.platform === 'win32')('preserves literal backslashes in POSIX project filenames', async () => {
    const p = await Projects.createFromFile(clip)
    p.versions[0].path = 'media/literal\\filename.mp4'
    await Projects.save(p)
    expect((await Projects.load(p.dir)).versions[0].path).toBe('media/literal\\filename.mp4')
  })
})
