// Product walkthroughs: the takes being recorded (one per project), and turning a take into a film. A take is condensed
// to its actions and paced to the narration for each step (src/shared/walkthrough.ts), then drawn: the zoom on what is
// being done, a cursor gliding into each click with a ripple, and the voice. Everything is kept in
// walkthroughs/<take>/ (take.mp4, take.json, walkthrough.json), so a walkthrough can be made again with other words,
// pacing or zoom without recording it again, and lines that did not change keep their voice.
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import { FFMPEG, probe } from './media'
import { analyzeScreen } from './screen-activity'
import { Recorder, type TakeOptions } from './take'
import { describePlan, drawCommands, planWalkthrough, rippleTrack, type Pace, type Take, type WalkPlan } from '../shared/walkthrough'

const run = promisify(execFile)

/** The take being recorded in each project. */
export class Takes {
  private live = new Map<string, Recorder>()
  /** The take in this project, until it is stopped (also one that ended by itself: stop keeps what it recorded). */
  get(dir: string) { return this.live.get(dir) }
  async start(dir: string, o: TakeOptions) {
    if (this.live.has(dir)) throw new Error('A take is already recording in this project. Stop it first (stopping keeps what it recorded).')
    const r = new Recorder(o)
    try { await r.start() } catch (e) { await o.capture.stop().catch(() => {}); throw e }
    this.live.set(dir, r)
    return r
  }
  async stop(dir: string) {
    const r = this.live.get(dir)
    if (!r) throw new Error('No take is recording in this project.')
    try { return await r.stop() } finally { this.live.delete(dir) }
  }
  /** At quit: stop filming everywhere (the takes are lost, the pages are put back). */
  async stopAll() { await Promise.all([...this.live.keys()].map(d => this.stop(d).catch(() => {}))) }
}

export const takeDir = (id: string) => `walkthroughs/${id}`
export async function readTake(project: string, id: string): Promise<Take> {
  const file = join(project, takeDir(id), 'take.json')
  if (!existsSync(file)) throw new Error(`No take "${id}". Record one with walkthrough_record first.`)
  return JSON.parse(await readFile(file, 'utf8'))
}

export type Line = { text: string; voice?: string; style?: string }
export type Zoom = 'on' | 'subtle' | 'off'
const MAX_ZOOM: Record<Zoom, number> = { on: 1.8, subtle: 1.35, off: 1 }
export type ComposeRequest = {
  take: string
  /** what is said over each step, in the take's step order ('' or null: nothing) */
  narration: (Line | string | null)[]
  voice?: string; style?: string
  /** natural (default) or tight */
  pace?: Pace
  /** on (default): in on what is being done; subtle: less; off */
  zoom?: Zoom
  /** step numbers (1-based) left out of the film */
  skip?: number[]
}
type Spoken = { text: string; voice?: string; style?: string; file: string; duration: number }
type Saved = { take: string; lines: (Spoken | null)[]; options: Omit<ComposeRequest, 'take' | 'narration'>; output?: string; at: number }

export type Deps = {
  /** say text in a voice; returns the project-relative file */
  speak(text: string, voice: string | undefined, style: string | undefined, name: string): Promise<string>
  progress?(f: number | null, detail?: string): void
  signal?: AbortSignal
}

const libDir = () => app.isPackaged ? join(process.resourcesPath, 'lib') : join(import.meta.dirname, '../../resources/lib')
export const CURSOR = { file: 'cursor.png', hotX: 6, hotY: 4 }
const RIPPLE = { size: 120, frames: 15 }

/** The film's size: the take's shape, its long side at most 1920 (even numbers). */
export function filmSize(w: number, h: number) {
  const k = Math.min(1, 1920 / Math.max(w, h))
  return { width: Math.round((w * k) / 2) * 2, height: Math.round((h * k) / 2) * 2 }
}

/** Voice each step (keeping takes of lines said before the same way), plan the film and render it into renders/. */
export async function composeWalkthrough(project: string, req: ComposeRequest, deps: Deps) {
  const take = await readTake(project, req.take)
  const dir = join(project, takeDir(take.id))
  const savedFile = join(dir, 'walkthrough.json')
  const before: Saved | null = existsSync(savedFile) ? JSON.parse(await readFile(savedFile, 'utf8')) : null
  const steps = Math.max(1, take.steps.length)
  if (req.narration.length > steps) throw new Error(`The take has ${steps} step${steps === 1 ? '' : 's'}, but ${req.narration.length} narration lines were given: one per step, in order.`)
  const lines: (Spoken | null)[] = []
  for (let i = 0; i < steps; i++) {
    deps.signal?.throwIfAborted()
    const raw = req.skip?.includes(i + 1) ? null : req.narration[i]
    const line = typeof raw === 'string' ? { text: raw } : raw
    const text = line?.text?.trim()
    if (!text) { lines.push(null); continue }
    const voice = line!.voice || req.voice, style = line!.style || req.style
    const old = before?.lines[i]
    if (old && old.text === text && old.voice === voice && old.style === style && existsSync(join(project, old.file))) { lines.push(old); continue }
    deps.progress?.(null, `Voicing step ${i + 1} of ${steps}`)
    const file = await deps.speak(text, voice, style, `${take.id}-step-${i + 1}`)
    const duration = (await probe(join(project, file))).duration
    lines.push({ text, ...(voice ? { voice } : {}), ...(style ? { style } : {}), file, duration })
  }
  deps.progress?.(null, 'Finding what happened on screen')
  const activity = await analyzeScreen(project, take.video, deps.signal)
  const plan = planWalkthrough(take, activity.active, lines.map(l => l?.duration), { pace: req.pace, zoom: req.zoom !== 'off', maxZoom: MAX_ZOOM[req.zoom || 'on'], skip: req.skip?.map(n => n - 1) })
  if (!plan.segments.length) throw new Error('Nothing in this take made it into the film (was it all paused?). Record it again.')
  let out = `renders/walkthrough-${take.id}.mp4`
  for (let n = 2; existsSync(join(project, out)); n++) out = `renders/walkthrough-${take.id}-${n}.mp4`
  const voices = plan.steps.flatMap(s => (s.narration && lines[s.index] ? [{ file: lines[s.index]!.file, at: s.narration.at }] : []))
  await renderWalkthrough({ project, take, plan, voices, out, progress: deps.progress, signal: deps.signal })
  const { take: _t, narration: _n, ...options } = req
  await writeFile(savedFile, JSON.stringify({ take: take.id, lines, options, output: out, at: Date.now() } satisfies Saved, null, 1))
  return { file: out, take, plan, lines, outline: describePlan(plan) }
}

type RenderJob = {
  project: string; take: Take; plan: WalkPlan; voices: { file: string; at: number }[]; out: string
  progress?: Deps['progress']; signal?: AbortSignal
}

/** Pass 1: the condensed take (cuts, speed, holds) in parts. Pass 2: zoom, ripples, cursor and the voices, in one. */
export async function renderWalkthrough(j: RenderJob) {
  const { take, plan } = j
  const work = join(j.project, '.cache', 'walkthrough', `${take.id}-${Date.now().toString(36)}`)
  await mkdir(work, { recursive: true })
  await mkdir(join(j.project, 'renders'), { recursive: true })
  const fps = take.fps
  const ff = (args: string[]) => run(FFMPEG, ['-y', '-loglevel', 'error', ...args], { cwd: work, maxBuffer: 1 << 24, signal: j.signal })
  try {
    const src = join(j.project, take.video)
    const CHUNK = 24
    const parts: string[] = []
    for (let c = 0; c < plan.segments.length; c += CHUNK) {
      const segs = plan.segments.slice(c, c + CHUNK)
      j.progress?.((c / plan.segments.length) * 0.5, 'Cutting the take')
      const inputs = segs.flatMap(g => ['-ss', g.s.toFixed(4), '-t', (g.e - g.s + 2 / fps).toFixed(4), '-i', src])
      const chains = segs.map((g, i) => {
        const n = Math.max(1, Math.round(((g.e - g.s) / g.speed) * fps))
        return `[${i}:v]setpts=(PTS-STARTPTS)/${g.speed},fps=${fps},trim=end_frame=${n},setpts=PTS-STARTPTS,` +
          `tpad=start=${Math.round(g.pre * fps)}:start_mode=clone:stop=${Math.round(g.hold * fps)}:stop_mode=clone[v${i}]`
      })
      const part = `part-${parts.length}.mp4`
      await ff([...inputs, '-filter_complex', `${chains.join(';')};${segs.map((_, i) => `[v${i}]`).join('')}concat=n=${segs.length}:v=1:a=0[v]`,
        '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12', '-pix_fmt', 'yuv420p', part])
      parts.push(part)
    }
    await writeFile(join(work, 'parts.txt'), parts.map(p => `file '${p}'`).join('\n') + '\n')

    j.progress?.(0.5, 'Zoom, cursor and voice')
    const film = filmSize(take.width, take.height)
    await copyFile(join(libDir(), 'walkthrough', CURSOR.file), join(work, CURSOR.file))
    const rippleDur = RIPPLE.frames / fps
    await writeFile(join(work, 'draw.txt'), drawCommands(plan, {
      width: take.width, height: take.height, outWidth: film.width, outHeight: film.height, fps,
      cursor: { hotX: CURSOR.hotX, hotY: CURSOR.hotY },
      ripple: plan.clicks.length ? { size: RIPPLE.size, dur: rippleDur } : null,
    }))
    const ripples = plan.clicks.length > 0
    if (ripples) {
      await makeRipple(work, fps)
      await writeFile(join(work, 'ripple.txt'), rippleTrack(plan.clicks, plan.duration, { fps, frames: RIPPLE.frames, blank: 'blank.png', frame: i => `ripple-${String(i).padStart(2, '0')}.png` }))
    }
    const inputs = ['-f', 'concat', '-safe', '0', '-i', 'parts.txt']
    let graph = `[0:v]fps=${fps},sendcmd=f=draw.txt,crop@zoom=w=${take.width}:h=${take.height}:x=0:y=0:exact=1,scale=${film.width}:${film.height}:flags=lanczos,setsar=1[z0]`
    let last = 'z0', k = 1
    if (ripples) {
      inputs.push('-f', 'concat', '-safe', '0', '-i', 'ripple.txt')
      graph += `;[${k}:v]format=rgba[rp];[${last}][rp]overlay@ripple=x=-999:y=-999:eof_action=pass:format=rgb[z${k}]`
      last = `z${k++}`
    }
    {
      inputs.push('-loop', '1', '-framerate', String(fps), '-i', CURSOR.file)
      graph += `;[${k}:v]format=rgba[cur];[${last}][cur]overlay@cursor=x=-999:y=-999:shortest=1:format=rgb[z${k}]`
      last = `z${k++}`
    }
    graph += `;[${last}]format=yuv420p[v]`
    const dur = plan.duration.toFixed(3)
    if (j.voices.length) {
      const first = k
      for (const v of j.voices) inputs.push('-i', join(j.project, v.file))
      graph += ';' + j.voices.map((v, i) => `[${first + i}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(v.at * 1000)}:all=1[a${i}]`).join(';') +
        `;${j.voices.map((_, i) => `[a${i}]`).join('')}amix=inputs=${j.voices.length}:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,atrim=0:${dur}[a]`
    } else {
      inputs.push('-f', 'lavfi', '-t', dur, '-i', 'anullsrc=r=48000:cl=stereo')
      graph += `;[${k}:a]anull[a]`
    }
    await ff([...inputs, '-filter_complex', graph, '-map', '[v]', '-map', '[a]', '-t', dur,
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-r', String(fps), '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', join(j.project, j.out)])
    j.progress?.(1)
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** A click ripple: an amber ring with a thin dark edge (it reads on light and dark pages) that grows and fades over
 *  RIPPLE.frames, over a soft fill; and a transparent frame for between clicks. */
async function makeRipple(work: string, fps: number) {
  const S = RIPPLE.size, c = S / 2, last = RIPPLE.frames - 1
  const d = `hypot(X-${c},Y-${c})`, R = `(9+${c - 13}*N/${last})`, fade = `(1-pow(N/${last},2))`
  const ring = `max(0,1-abs(${d}-${R})/3.2)`, edge = `max(0,1-abs(${d}-${R}-3.6)/1.4)`, fill = `0.18*lt(${d},${R})`
  const mix = (amber: number) => `'${amber}*(${ring}+${fill})/max(0.001,${ring}+${fill}+${edge})'`
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black@0:s=${S}x${S}:r=${fps}:d=${RIPPLE.frames / fps}`,
    '-vf', `format=rgba,geq=r=${mix(242)}:g=${mix(165)}:b=${mix(65)}:a='255*${fade}*min(1,${ring}+${fill}+0.55*${edge})'`,
    '-frames:v', String(RIPPLE.frames), '-start_number', '0', 'ripple-%02d.png'], { cwd: work })
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=black@0:s=${S}x${S}`, '-vf', 'format=rgba,geq=r=0:g=0:b=0:a=0', '-frames:v', '1', 'blank.png'], { cwd: work })
}
