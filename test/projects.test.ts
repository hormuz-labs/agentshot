import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from 'electron'
import { FFMPEG } from '../src/main/media'

const root = mkdtempSync(join(tmpdir(), 'manul-proj-'))
process.env.MANUL_PROJECTS = join(root, 'projects')
const Projects = await import('../src/main/projects')
const clip = join(root, 'My Clip.mp4')

beforeAll(() => {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=25:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip])
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

  it('starts with a timeline of the whole file in its own format', async () => {
    const p = await Projects.createFromFile(clip)
    expect(p.timeline).toMatchObject({ width: 320, height: 240, fps: 25, items: [{ kind: 'media', src: 'media/My Clip.mp4', in: 0 }] })
    expect((p.timeline!.items[0] as { out: number }).out).toBeCloseTo(2, 0)
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
    execFileSync('sh', ['-c', `echo hi > "${notes}"`])
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
    expect(readFileSync(join(p.dir, n.still!), 'utf8')).toBe('jpeg')
    const again = await Projects.load(p.dir)
    expect(again.notes[0].text).toBe('blur')
    expect(Projects.recent()[0].dir).toBe(p.dir)
  })
})
