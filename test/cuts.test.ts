// Saving a cut-only edit fast: the plan (what is copied, what encoded), and real renders checked frame by frame,
// for sync and against the full render's time.
import { execFile } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import { composeArgs, type Item, type Timeline } from '../src/shared/timeline'
import { badJoin, cutSource, framesIn, indexFrames, nalLengthSize, planRuns, renderCuts, unfit, type Packet } from '../src/main/cuts'
import { FFMPEG, FFPROBE } from '../src/main/media'

const media = (from: number, to: number, more: Partial<Item> = {}): Item => ({ id: `p${from}`, kind: 'media', src: 'src.mp4', in: from, out: to, ...more } as Item)
const tlOf = (items: Item[], format = { width: 1920, height: 1080, fps: 30 }): Timeline => ({ ...format, items })

describe('the plan for a cut', () => {
  it('copies from the first keyframe in a piece to its last, and encodes the frames either side', () => {
    // keyframes every 60 frames, 1800 frames
    const splits = Array.from({ length: 30 }, (_, k) => k * 60)
    expect(planRuns([[45, 219]], splits, 1800)).toEqual([
      { from: 45, to: 60, copy: false }, { from: 60, to: 180, copy: true }, { from: 180, to: 219, copy: false }])
    // on keyframes at both ends: all copied; to the end of the file: copied to the end
    expect(planRuns([[360, 600], [1200, 1800]], splits, 1800)).toEqual([{ from: 360, to: 600, copy: true }, { from: 1200, to: 1800, copy: true }])
    // no two keyframes inside: encoded whole
    expect(planRuns([[912, 930], [61, 119]], splits, 1800)).toEqual([{ from: 912, to: 930, copy: false }, { from: 61, to: 119, copy: false }])
  })

  it('treats pieces that follow on in the file as one (a split alone copies everything)', () => {
    expect(planRuns([[0, 120], [120, 1800]], [0, 60, 1200], 1800)).toEqual([{ from: 0, to: 1800, copy: true }])
    // moved apart they are cut again
    expect(planRuns([[120, 1800], [0, 120]], [0, 60, 1200], 1800)).toEqual([
      { from: 120, to: 1200, copy: false }, { from: 1200, to: 1800, copy: true }, { from: 0, to: 60, copy: true }, { from: 60, to: 120, copy: false }])
  })

  it('finds the frames of a piece, allowing for times rounded to the millisecond', () => {
    const f = { tick: 1 / 30000, start: 0, pts: Array.from({ length: 300 }, (_, i) => i * 1001), end: 300 * 1001, splits: [0] }
    // 29.97 fps: frame 100 shows at 3.3366… s; a piece from 3.337 (rounded) starts there
    expect(framesIn(f, 3.337, 5)).toEqual([100, 150])
    expect(framesIn(f, 0, 99)).toEqual([0, 300])
  })
})

describe('the frames a file can be cut at', () => {
  // display order I0 B1 B2 P3 …, decode order I0 P3 B1 B2 …: decode runs 2 frames ahead. n frames (n = 3k + 1); an
  // open GOP's first B-frame shows before its keyframe (start - 1) but comes after it in the file
  const gop = (start: number, n: number, open = false): Packet[] => {
    const order = [start, ...(open ? [start - 1] : [])]
    for (let i = 1; i < n; i += 3) order.push(start + i + 2, start + i, start + i + 1)
    return order.map((pts, k) => ({ pts, dts: start - 2 + k, duration: 1, pos: 0, size: 1, key: k === 0, discard: false }))
  }
  const opts = { tick: 1 / 30, start: 0, idr: () => true }

  it('are the IDR keyframes of closed GOPs, in showing order', () => {
    const f = indexFrames([...gop(0, 10), ...gop(10, 10), ...gop(20, 10)], opts)
    expect(f).toMatchObject({ splits: [0, 10, 20], end: 30 })
    expect(typeof f !== 'string' && f.pts.slice(0, 5)).toEqual([0, 1, 2, 3, 4])
  })

  it('leaves out a keyframe with frames before it decoded after it (an open GOP), or that isn\'t IDR', () => {
    // the open GOP's leading frame (shown at 9) comes after its keyframe (10) in the file
    const pk = [...gop(0, 7), ...gop(8, 10, true), ...gop(18, 10)]
    expect(indexFrames(pk, opts)).toMatchObject({ splits: [0, 18] })
    const ids = [...gop(0, 10), ...gop(10, 10), ...gop(20, 10)]
    expect(indexFrames(ids, { ...opts, idr: i => i !== 10 })).toMatchObject({ splits: [0, 20] })
  })

  it('checks a joined picture: the frames planned, decode times always going forward', () => {
    const pk = [...gop(0, 10), ...gop(10, 10)]
    expect(badJoin(pk, 20)).toBeUndefined()
    expect(badJoin(pk, 21)).toMatch(/20 frames/)
    const back = [...gop(0, 10), ...gop(10, 10)].map((p, i) => (i === 10 ? { ...p, dts: 6 } : p))
    expect(badJoin(back, 20)).toMatch(/decode times out of step at frame 10/)
    // ffmpeg's fix for that: a tick past the one before
    const nudged = [...gop(0, 10), ...gop(10, 10)].map((p, i) => (i >= 10 && i < 13 ? { ...p, dts: 7 + (i - 9) * 0.001 } : p))
    expect(badJoin(nudged, 20)).toMatch(/out of step/)
  })

  it('refuses frames without times or hidden ones', () => {
    expect(indexFrames([{ pts: NaN, dts: 0, duration: 1, pos: 0, size: 1, key: true, discard: false }], opts)).toBeTypeOf('string')
    expect(indexFrames([{ pts: 0, dts: 0, duration: 1, pos: 0, size: 1, key: true, discard: true }], opts)).toBeTypeOf('string')
  })

  it('reads the NAL length size from avcC', () => {
    expect(nalLengthSize('\n00000000: 0164 001f ffe1 001a 6764 001f acd9 4050  .d......gd....@P\n')).toBe(4)
    expect(nalLengthSize('\n00000000: 0000 0001 6764 001f  ....gd..\n')).toBe(0)
  })
})

describe('what can be cut by copying', () => {
  const v = { codec_name: 'h264', pix_fmt: 'yuv420p', profile: 'High', field_order: 'progressive', width: 1280, height: 720, avg_frame_rate: '30000/1001' }
  const tl = tlOf([media(0, 5)], { width: 1280, height: 720, fps: 29.97 })
  it('is one H.264 file in its own size and frame rate', () => {
    expect(unfit(v, 'mov,mp4,m4a,3gp,3g2,mj2', tl)).toBeUndefined()
    expect(unfit({ ...v, codec_name: 'hevc' }, 'mov,mp4', tl)).toMatch(/hevc/)
    expect(unfit({ ...v, pix_fmt: 'yuv420p10le' }, 'mov,mp4', tl)).toMatch(/pixels/)
    expect(unfit({ ...v, side_data_list: [{ rotation: -90 }] }, 'mov,mp4', tl)).toBe('rotated')
    expect(unfit(v, 'mpegts', tl)).toMatch(/mpegts/)
    expect(unfit(v, 'mov,mp4', { ...tl, width: 1080, height: 1920 })).toBe('a different size')
    expect(unfit(v, 'mov,mp4', { ...tl, fps: 25 })).toBe('a different frame rate')
  })
  it('with nothing laid over it and nothing else in it', () => {
    expect(cutSource(tl)).toBe('src.mp4')
    expect(cutSource({ ...tl, overlays: [{ id: 'o', clip: 'c', start: 0, dur: 1 }] })).toBeUndefined()
    expect(cutSource({ ...tl, items: [...tl.items, { id: 'c', kind: 'clip', clip: 'c', dur: 2 }] })).toBeUndefined()
    expect(cutSource({ ...tl, items: [...tl.items, media(0, 1, { src: 'other.mp4' } as Partial<Item>)] })).toBeUndefined()
  })
})

// ---------------------------------------------------------------- real renders
const dir = mkdtempSync(join(tmpdir(), 'manul-cuts-'))
// ffmpeg runs beside the test, never blocking it: a render that holds the worker for a minute (the full render, on a
// slow Intel Mac) leaves Vitest's worker unable to answer, and the run fails with "Timeout calling onTaskUpdate"
const run = promisify(execFile)
const ff = async (args: string[]) => (await run(FFMPEG, ['-y', '-loglevel', 'error', ...args], { cwd: dir, maxBuffer: 1 << 30, encoding: 'buffer' })).stdout
const probeOut = async (file: string, entries: string) => (await run(FFPROBE, ['-v', 'error', '-show_entries', entries, '-of', 'json', file], { cwd: dir })).stdout
const md5s = async (file: string) => (await ff(['-i', file, '-map', '0:v:0', '-f', 'framemd5', '-'])).toString().split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').pop()!.trim())
const W = 320, H = 180
const thumbs = async (file: string) => { const b = await ff(['-i', file, '-map', '0:v:0', '-vf', `scale=${W}:${H},format=gray`, '-f', 'rawvideo', '-']); return Array.from({ length: b.length / (W * H) }, (_, i) => b.subarray(i * W * H, (i + 1) * W * H)) }
const mse = (a: Uint8Array, b: Uint8Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s / a.length }
const pcm = async (file: string) => { const b = Buffer.from(await ff(['-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])); return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length)) }
const frame30 = (t: number) => Math.ceil(t * 30 - 1e-6)

/** Every frame of out is the right frame of src: copied ones bit for bit, encoded ones nearer it than its neighbours. */
async function checkFrames(src: string, out: string, items: Item[], copiedAtLeast: number) {
  // one at a time, as before: ffmpeg processes in parallel would crowd the other test files' timings
  const sm = await md5s(src), om = await md5s(out), st = await thumbs(src), ot = await thumbs(out)
  const want = items.flatMap(it => (it.kind === 'media' ? Array.from({ length: frame30(it.out) - frame30(it.in) }, (_, k) => frame30(it.in) + k) : []))
  expect(om.length).toBe(want.length)
  let exact = 0
  want.forEach((i, k) => {
    if (om[k] === sm[i]) { exact++; return }
    const best = [i - 1, i, i + 1].filter(j => j >= 0 && j < st.length).sort((x, y) => mse(ot[k], st[x]) - mse(ot[k], st[y]))[0]
    expect(best, `frame ${k} of the cut shows source frame ${best}, not ${i}`).toBe(i)
  })
  expect(exact / want.length).toBeGreaterThanOrEqual(copiedAtLeast)
  return want.length
}

/** The sound in the middle of each piece is the source's from the same moment (to a millisecond). */
async function checkSync(src: string, out: string, items: Item[]) {
  const s = await pcm(src), o = await pcm(out), R = 48000, win = 2400, reach = 2400
  let at = 0
  for (const it of items) {
    if (it.kind !== 'media') continue
    const len = (frame30(it.out) - frame30(it.in)) / 30
    const oAt = Math.round((at + len / 2) * R), sAt = Math.round((frame30(it.in) / 30 + len / 2) * R)
    let best = 0, bestLag = 0
    for (let lag = -reach; lag <= reach; lag++) {
      let c = 0, e = 0
      for (let k = 0; k < win; k++) { const x = s[sAt + lag + k] || 0; c += o[oAt + k] * x; e += x * x }
      const score = c / Math.sqrt(e || 1)
      if (score > best) { best = score; bestLag = lag }
    }
    expect(Math.abs(bestLag), `piece ${it.in}–${it.out} is ${bestLag} samples off`).toBeLessThanOrEqual(48)
    at += len
  }
}

describe('a cut, rendered', () => {
  beforeAll(async () => {
    // a minute of 1080p30 with B-frames and a keyframe every second, over a rising tone (each moment sounds different)
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:r=30:d=60', '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*(200*t+50*t*t)):s=48000:d=60',
      '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-c:a', 'aac', '-b:a', '160k', '-shortest', 'src.mp4'])
  }, 120_000)

  const items = [media(0, 7.3), media(12.2, 20), media(30.4, 31), media(40, 52.5, { db: -6 }), media(3, 5), media(55, 60)]

  it('copies most of the picture, frame-exact, keeps the sound in sync, and beats the full render', async () => {
    const tl = tlOf(items)
    let t = performance.now()
    const r = await renderCuts({ ffmpeg: FFMPEG, ffprobe: FFPROBE, cwd: dir, tl, out: 'cut.mp4' })
    const fast = performance.now() - t
    expect(r).toMatchObject({ ok: true })
    expect(r.ok && r.copied).toBeGreaterThan(0.8)
    const frames = await checkFrames('src.mp4', 'cut.mp4', items, 0.8)
    const s = JSON.parse(await probeOut('cut.mp4', 'stream=codec_type,duration'))
    expect(Number(s.streams[0].duration)).toBeCloseTo(frames / 30, 3)
    expect(Math.abs(Number(s.streams[1].duration) - frames / 30)).toBeLessThan(0.05)
    await checkSync('src.mp4', 'cut.mp4', items)
    // the -6 dB piece is half as loud (its middle second, against the same second of the file)
    const rms = (x: Float32Array, at: number) => Math.sqrt(x.subarray(at * 48000, (at + 1) * 48000).reduce((s, v) => s + v * v, 0) / 48000)
    const before = (frame30(7.3) + frame30(20) - frame30(12.2) + frame30(31) - frame30(30.4)) / 30
    expect(rms(await pcm('cut.mp4'), before + 6) / rms(await pcm('src.mp4'), 46)).toBeCloseTo(0.5, 1)
    t = performance.now()
    await ff(composeArgs(tl, { inputOf: () => 'src.mp4', hasAudio: () => true, out: 'full.mp4' }))
    const full = performance.now() - t
    console.log(`cut: ${Math.round(fast)} ms, full render: ${Math.round(full)} ms`)
    expect(fast).toBeLessThan(full / 2)
  }, 120_000)

  it('leaves the tmp files out of the project', async () => {
    const { readdirSync, mkdirSync } = await import('node:fs')
    mkdirSync(join(dir, 'renders'), { recursive: true })
    expect(readdirSync(join(dir, 'renders'))).toEqual([])
  })

  it('says why when it can\'t, so the film is rendered in full', async () => {
    const r = (tl: Timeline) => renderCuts({ ffmpeg: FFMPEG, ffprobe: FFPROBE, cwd: dir, tl, out: 'no.mp4' })
    expect(await r({ ...tlOf(items), overlays: [{ id: 'o', clip: 'c', start: 0, dur: 1 }] })).toEqual({ ok: false, why: 'not just cuts of one file' })
    expect(await r(tlOf(items, { width: 1080, height: 1920, fps: 30 }))).toEqual({ ok: false, why: 'a different size' })
    // pieces shorter than the gap between keyframes: little to copy
    expect(await r(tlOf([media(0.1, 0.9), media(2.1, 2.9), media(5.2, 5.8)]))).toMatchObject({ ok: false, why: expect.stringMatching(/little to copy/) })
  }, 60_000)

  it('cuts files without B-frames, in Matroska, or without sound', async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=30:d=12', '-f', 'lavfi', '-i', 'aevalsrc=sin(2*PI*(200*t+50*t*t)):s=48000:d=12',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '15', '-c:a', 'aac', '-shortest', 'flat.mp4'])
    await ff(['-i', 'src.mp4', '-t', '12', '-c', 'copy', 'src.mkv'])
    await ff(['-i', 'src.mp4', '-t', '12', '-an', '-c', 'copy', 'silent.mp4'])
    const cut = [media(0.5, 4.2), media(6, 11.5)]
    for (const [file, size] of [['flat.mp4', [640, 360]], ['src.mkv', [1920, 1080]], ['silent.mp4', [1920, 1080]]] as const) {
      const its = cut.map(i => ({ ...i, src: file }))
      const r = await renderCuts({ ffmpeg: FFMPEG, ffprobe: FFPROBE, cwd: dir, tl: tlOf(its, { width: size[0], height: size[1], fps: 30 }), out: `cut-${file}.mp4` })
      expect(r, file).toMatchObject({ ok: true })
      await checkFrames(file, `cut-${file}.mp4`, its, 0.5)
      const s = JSON.parse(await probeOut(`cut-${file}.mp4`, 'stream=codec_type,duration'))
      expect(s.streams.map((x: { codec_type: string }) => x.codec_type)).toEqual(['video', 'audio'])
      if (file !== 'silent.mp4') await checkSync(file, `cut-${file}.mp4`, its)
    }
  }, 120_000)

  it('won\'t copy from an open GOP\'s keyframes', async () => {
    await ff(['-f', 'lavfi', '-i', 'testsrc2=size=640x360:r=30:d=12', '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-x264-params', 'open-gop=1', 'open.mp4'])
    const its = [media(0.5, 4.2), media(6, 11.5)].map(i => ({ ...i, src: 'open.mp4' }))
    const r = await renderCuts({ ffmpeg: FFMPEG, ffprobe: FFPROBE, cwd: dir, tl: tlOf(its, { width: 640, height: 360, fps: 30 }), out: 'cut-open.mp4' })
    // either nothing to copy, or what it copied is right
    if (r.ok) await checkFrames('open.mp4', 'cut-open.mp4', its, 0)
    else expect(r.why).toMatch(/little to copy/)
  }, 60_000)
})
