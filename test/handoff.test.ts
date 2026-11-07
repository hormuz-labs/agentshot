// Export for another editor: the plan (which clip goes where, at which level) and the three files made from it, checked
// against what each editor reads: frames that meet exactly, source in points kept, overlays above, music ducked.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => tmpdir() } }))
import { FFMPEG, FFPROBE } from '../src/main/media'
import { describeFile, exportForEditors, timecodeFrames } from '../src/main/handoff'
import { fileUrl, planOf, rateOf, toFcpxml, toOtio, toXmeml, type PlanInput } from '../src/shared/handoff'
import { cameraLayout } from '../src/shared/demo'
import type { Item, Timeline } from '../src/shared/timeline'
import type { Project } from '../src/shared/types'

const media = (src: string, a: number, b: number, extra: Partial<Item> = {}): Item => ({ id: `${src}${a}`, kind: 'media', src, in: a, out: b, ...extra } as Item)
const file = (o: Partial<PlanInput['media'][string]> = {}) => ({ path: '/p/x.mp4', duration: 60, width: 1920, height: 1080, fps: 30, hasVideo: true, hasAudio: true, ...o })

describe('the plan', () => {
  const base: PlanInput = {
    name: 'Talk', clips: { intro: { file: 'clips/intro/clip.mp4', title: 'Intro' }, name: { file: 'clips/name/overlay.mov', title: 'Name' } },
    media: { 'media/a.mp4': file({ path: '/p/a.mp4' }), 'clips/intro/clip.mp4': file({ path: '/p/intro.mp4', duration: 3, hasAudio: false }), 'clips/name/overlay.mov': file({ path: '/p/name.mov', duration: 4, hasAudio: false }), 'media/song.mp3': file({ path: '/p/song.mp3', duration: 5, hasVideo: false, width: undefined, height: undefined }) },
    tl: { width: 1920, height: 1080, fps: 30, items: [{ id: 'c', kind: 'clip', clip: 'intro', dur: 3 }, media('media/a.mp4', 10, 15), media('media/a.mp4', 20, 22.5, { db: -3 })], overlays: [{ id: 'o1', clip: 'name', start: 3.5, dur: 4 }, { id: 'o2', clip: 'name', start: 5, dur: 1 }] },
  }

  it('keeps each cut\'s source range, one after another on V1', () => {
    const plan = planOf(base)
    expect(plan.video[0].map(c => [c.start, c.in, c.dur])).toEqual([[0, 0, 3], [3, 10, 5], [8, 20, 2.5]])
    expect(plan.duration).toBe(10.5)
    expect(plan.video[0][2].sound).toEqual({ db: -3 })
    expect(plan.video[0][0].sound).toBeNull() // the motion clip has no sound
  })

  it('stacks overlays that overlap on separate tracks, and trims them to the film', () => {
    const plan = planOf(base)
    expect(plan.video.slice(1).map(t => t.map(c => [c.start, c.dur]))).toEqual([[[3.5, 4]], [[5, 1]]])
    const late = planOf({ ...base, tl: { ...base.tl, overlays: [{ id: 'o', clip: 'name', start: 9, dur: 4 }] } })
    expect(late.video[1][0].dur).toBe(1.5)
  })

  it('loops the music to the film, ducked under speech and faded at both ends', () => {
    const plan = planOf({ ...base, tl: { ...base.tl, mix: { filmDb: 0, music: { src: 'media/song.mp3', db: -12, duckDb: 10 } } }, speech: [[4, 6]] })
    const music = plan.audio[0]
    expect(music.map(c => [c.start, c.dur])).toEqual([[0, 5], [5, 5], [10, 0.5]])
    const keys = music.flatMap(c => c.sound!.keys!.map(k => ({ t: c.start + k.t, db: k.db })))
    const at = (t: number) => keys.find(k => Math.abs(k.t - t) < 1e-6)!.db
    expect(at(0)).toBe(-96)
    expect(at(1)).toBe(-12)
    expect(at(4)).toBe(-22) // ducked: speech runs 4–6
    expect(at(5)).toBe(-22)
    expect(at(6.25)).toBe(-12)
    expect(at(10.5)).toBe(-96)
  })

  it('puts the camera of a screen recording over it, where AgentShot draws it', () => {
    const layout = cameraLayout(1920, 1080, { shape: 'circle', width: 400 }, 'bottom-right')
    const tl: Timeline = { width: 1920, height: 1080, fps: 30, items: [media('media/screen.mp4', 2, 8)],
      demo: { screen: 'media/screen.mp4', camera: 'media/cam.mp4', cameraDuration: 60, sync: { offset: 1, rate: 1, confidence: 1, reliable: true, anchors: [], residual: 0, overlap: [0, 60], method: 'x' }, layout, audio: 'camera' } }
    const plan = planOf({ name: 'Demo', tl, clips: {}, media: { 'media/screen.mp4': file({ path: '/p/s.mp4' }), 'media/cam.mp4': file({ path: '/p/c.mp4', width: 1280, height: 720 }) } })
    expect(plan.video[0][0].sound).toBeNull() // the sound is the camera's
    const cam = plan.video[1][0]
    expect([cam.start, cam.in, cam.dur]).toEqual([0, 1, 6])
    expect(cam.sound).toEqual({ db: 0 })
    expect(cam.place!.width).toBe(400)
    expect(cam.place!.left + cam.place!.width).toBe(layout.x + layout.width)
    expect(plan.notes.join(' ')).toMatch(/circle shape/)
  })
})

describe('the files', () => {
  const plan = planOf({
    name: 'Talk & <friends>', clips: {},
    media: { 'media/a b.mp4': file({ path: '/p/a b.mp4', fps: 29.97, tc: { frames: 108000, drop: false } }), 'media/v.wav': file({ path: '/p/v.wav', hasVideo: false, duration: 10 }) },
    tl: { width: 1920, height: 1080, fps: 29.97, items: [media('media/a b.mp4', 1, 2), media('media/a b.mp4', 5, 6.5, { framing: { fit: 'cover', zoom: 1.5, x: 0.1, y: 0 } })], mix: { filmDb: 0, voiceovers: [{ id: 'v', src: 'media/v.wav', start: 0.5, in: 0, out: 2, db: 2 }] } },
  })

  it('NTSC rates are fractions', () => {
    expect(rateOf(29.97)).toEqual({ num: 30000, den: 1001, base: 30, ntsc: true })
    expect(rateOf(23.976)).toMatchObject({ num: 24000, den: 1001 })
    expect(rateOf(25)).toMatchObject({ num: 25, den: 1 })
  })

  it('FCPXML: cuts meet on frames, in points carry the file\'s timecode, the voiceover hangs below', () => {
    const x = toFcpxml(plan)
    expect(x).toContain('frameDuration="1001/30000s"')
    expect(x).toContain('name="Talk &amp; &lt;friends&gt;"')
    expect(x).toContain(`src="${fileUrl('/p/a b.mp4')}"`)
    expect(fileUrl('/p/a b.mp4')).toBe('file:///p/a%20b.mp4')
    // 1 s in at 29.97 is frame 30, and timecode 01:00:00:00 is frame 108000: (108000 + 30) × 1001/30000 s = 3604601/1000 s
    expect(x).toContain(`<asset-clip ref="m1" offset="0s" name="a b.mp4" start="3604601/1000s" duration="1001/1000s">`)
    expect(x).toMatch(/offset="1001\/1000s" name="a b.mp4"/) // the second cut starts where the first ends
    expect(x).toMatch(/lane="-1"[^>]*name="v.wav"/)
    expect(x).toContain('<adjust-volume amount="2dB"/>')
    expect(x).toMatch(/<adjust-transform position="17\.7778 0" scale="1\.5 1\.5"\/>/) // 0.1 × 1920 = 192 px = 17.78% of 1080
  })

  it('Premiere XML: linked picture and sound, levels as gains', () => {
    const x = toXmeml(plan)
    expect(x).toContain('<timebase>30</timebase><ntsc>TRUE</ntsc>')
    expect(x).toMatch(/<start>0<\/start><end>30<\/end><in>30<\/in><out>60<\/out>/)
    expect(x).toMatch(/<start>30<\/start><end>75<\/end><in>150<\/in><out>195<\/out>/)
    expect((x.match(/<linkclipref>/g) || []).length).toBe(8) // two clips, each linked both ways, written on both
    expect(x).toContain('<pathurl>file://localhost/p/a%20b.mp4</pathurl>')
    expect(x).toContain(`<value>${Math.round(Math.pow(10, 2 / 20) * 10000) / 10000}</value>`)
    expect((x.match(/<file id="file-m1">/g) || []).length).toBe(1) // described once, then referred to
  })

  it('OTIO: tracks with gaps, ranges in the file\'s own time', () => {
    const j = JSON.parse(toOtio(plan))
    const [v1, a1, a2] = j.tracks.children
    expect(v1.kind).toBe('Video')
    expect(v1.children.map((c: { source_range: { start_time: { value: number }; duration: { value: number } } }) => [c.source_range.start_time.value, c.source_range.duration.value])).toEqual([[108030, 30], [108150, 45]])
    expect(a1.children).toHaveLength(2)
    expect(a2.children.map((c: { OTIO_SCHEMA: string }) => c.OTIO_SCHEMA)).toEqual(['Gap.1', 'Clip.2'])
  })

  it('reads timecode, drop-frame too', () => {
    expect(timecodeFrames('01:00:00:00', 25)).toEqual({ frames: 90000, drop: false })
    expect(timecodeFrames('00:10:00;00', 29.97)).toEqual({ frames: 17982, drop: true })
    expect(timecodeFrames('00:01:00;02', 29.97)).toEqual({ frames: 1800, drop: true })
    expect(timecodeFrames('nope', 30)).toBeUndefined()
  })
})

describe('export for editors (real files)', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'agentshot-handoff-'))
    mkdirSync(join(dir, 'media')); mkdirSync(join(dir, 'clips', 'name'), { recursive: true })
    const ff = (args: string[]) => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args])
    ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=25:d=6', '-f', 'lavfi', '-i', 'sine=f=440:d=6', '-c:v', 'libx264', '-c:a', 'aac', '-timecode', '10:00:00:00', '-shortest', join(dir, 'media', 'a.mov')])
    ff(['-f', 'lavfi', '-i', 'color=c=red@0.5:s=640x360:r=25:d=2,format=argb', '-c:v', 'qtrle', join(dir, 'clips', 'name', 'overlay.mov')])
  })
  afterAll(() => { if (!process.env.HANDOFF_KEEP) rmSync(dir, { recursive: true, force: true }) })

  it('probes size, rate, sound and timecode', async () => {
    expect(await describeFile(FFPROBE, join(dir, 'media', 'a.mov'))).toMatchObject({ width: 640, height: 360, fps: 25, hasVideo: true, hasAudio: true, tc: { frames: 900000, drop: false } })
  })

  it('writes the folder: the three files, a note, the media', async () => {
    const tl: Timeline = { width: 640, height: 360, fps: 25, items: [media('media/a.mov', 0, 2), media('media/a.mov', 3, 5)], overlays: [{ id: 'o', clip: 'name', start: 1, dur: 2 }] }
    const p = { title: 'My film', dir, clips: { name: { id: 'name', title: 'Name / title', duration: 2, video: 'clips/name/overlay.mov', poster: '', updatedAt: 0, overlay: true } } } as unknown as Project
    const out = join(process.env.HANDOFF_KEEP || dir, 'My film for editors')
    const r = await exportForEditors({ p, tl, out, ffprobe: FFPROBE, bake: async () => { throw new Error('no bake') }, progress: () => {} })
    for (const f of ['My film.fcpxml', 'My film (Premiere).xml', 'My film.otio', 'How to open.txt', 'Media/a.mov', 'Media/Name - title.mov']) expect(existsSync(join(out, f)), f).toBe(true)
    expect(r.copied).toBe(2)
    const x = readFileSync(join(out, 'My film.fcpxml'), 'utf8')
    expect(x).toContain(`src="${fileUrl(join(out, 'Media', 'a.mov'))}"`)
    expect(x).toContain('start="36000s"') // 10:00:00:00
    expect(x).toMatch(/lane="1"[^>]*name="Name \/ title"/)
    // a second export into the same folder copies nothing again
    expect((await exportForEditors({ p, tl, out, ffprobe: FFPROBE, bake: async () => {}, progress: () => {} })).copied).toBe(0)
    writeFileSync(join(dir, 'done'), '')
  })
})
