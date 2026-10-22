// The film's mix: its own audio level, background music, and the music dipping (ducking) under speech.
// Speech comes from the transcripts, carried through the timeline's cuts and clips, so the live preview (Web Audio)
// and the render (ffmpeg) follow the same envelope.
import { length, type Timeline } from './timeline'
import type { Transcript } from './types'
import { escapeFilterPath } from './ffmpeg'

export type Mix = { filmDb: number; music?: { src: string; db: number; duckDb: number } }
export type Region = [number, number]
export type Envelope = { t: number; db: number }[]

const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Where someone is speaking (s), padded a little, short gaps merged. */
export function speechRegions(t: Transcript, pad = 0.15, mergeGap = 0.6): Region[] {
  const words = t.segments.flatMap(s => s.words).sort((a, b) => a.s - b.s)
  const out: Region[] = []
  for (const w of words) {
    const a = Math.max(0, w.s - pad), b = w.e + pad
    const last = out.at(-1)
    if (last && a - last[1] <= mergeGap) last[1] = Math.max(last[1], b)
    else out.push([a, b])
  }
  return out.map(([a, b]) => [r3(a), r3(b)])
}

/** Speech regions on the timeline: each media item's source speech, cut to its range and moved to its place. */
export function regionsOnTimeline(tl: Timeline, transcripts: Record<string, Transcript | undefined>): Region[] {
  const out: Region[] = []
  let at = 0
  for (const it of tl.items) {
    const camera = it.kind === 'media' && it.src === tl.demo?.screen && tl.demo.audio === 'camera' ? tl.demo : undefined
    const src = camera ? camera.camera : it.kind === 'media' ? it.src : ''
    if (it.kind === 'media' && transcripts[src]) {
      for (const region of speechRegions(transcripts[src]!)) {
        const [a, b] = camera ? region.map(t => camera.sync.offset + t * camera.sync.rate) : region
        const s = Math.max(a, it.in), e = Math.min(b, it.out)
        if (e > s) out.push([r3(at + s - it.in), r3(at + e - it.in)])
      }
      if (camera && transcripts[it.src]) {
        const end = camera.sync.offset + camera.sync.rate * camera.cameraDuration
        for (const [a, b] of speechRegions(transcripts[it.src]!)) for (const [lo, hi] of [[it.in, Math.min(it.out, camera.sync.offset)], [Math.max(it.in, end), it.out]]) {
          const s = Math.max(a, lo), e = Math.min(b, hi)
          if (e > s) out.push([r3(at + s - it.in), r3(at + e - it.in)])
        }
      }
    }
    at += length(it)
  }
  return out.sort((a, b) => a[0] - b[0])
}

/** Keyframes: 0 dB away from speech, −duckDb during it, linear ramps of `ramp` seconds before and after. */
export function duckEnvelope(regions: Region[], duckDb: number, ramp = 0.25): Envelope {
  const env: Envelope = [{ t: 0, db: 0 }]
  for (const [a, b] of regions) {
    const down = Math.max(env.at(-1)!.t, a - ramp)
    env.push({ t: r3(down), db: env.at(-1)!.t <= down ? gainAt(env, down) : -duckDb }, { t: r3(Math.max(down, a)), db: -duckDb }, { t: r3(b), db: -duckDb }, { t: r3(b + ramp), db: 0 })
  }
  return env
}

/** dB at time t (linear between keyframes; the last value holds). */
export function gainAt(env: Envelope, t: number): number {
  if (t <= env[0].t) return env[0].db
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1], b = env[i]
    if (t <= b.t) return b.t === a.t ? b.db : a.db + ((b.db - a.db) * (t - a.t)) / (b.t - a.t)
  }
  return env.at(-1)!.db
}

export const dbToGain = (db: number) => Math.pow(10, db / 20)

/** Linear gains the live preview applies at time t: what the render does (level × duck × 1 s fade-in × 2 s fade-out). */
export function previewGains(t: number, duration: number, mix: Mix, env: Envelope) {
  const film = dbToGain(mix.filmDb)
  if (!mix.music) return { film, music: 0 }
  const fade = Math.min(1, Math.max(0, t / 1), Math.max(0, (duration - t) / 2))
  return { film, music: dbToGain(mix.music.db) * dbToGain(gainAt(env, t)) * fade }
}

/** ffmpeg asendcmd commands for the envelope (sampled every 50 ms on ramps) driving a filter named volume@duck. */
export function mixCommands(env: Envelope, step = 0.05): string {
  const times = new Set<number>([0])
  for (let i = 1; i < env.length; i++) {
    const a = env[i - 1], b = env[i]
    if (a.db !== b.db) for (let t = a.t; t < b.t; t += step) times.add(r3(t))
    times.add(b.t)
  }
  // a little after each change too, so a held level is set after any ramp
  return [...times].sort((a, b) => a - b).map(t => `${t.toFixed(3)} volume@duck volume ${dbToGain(gainAt(env, t)).toFixed(4)};`).join('\n') + '\n'
}

/**
 * ffmpeg arguments (after -y) that mix a rendered film ("dry": picture + its own sound) into the final file: the film's
 * level, the music looped to the film's length, levelled, ducked by the asendcmd envelope, faded in and out.
 * The picture is copied, not re-encoded.
 */
export function mixArgs(o: { dry: string; duration: number; mix: Mix; commands?: string; out: string }): string[] {
  const { mix } = o
  const total = r3(o.duration)
  const film = `[0:a]volume=${mix.filmDb}dB[af]`
  if (!mix.music) return ['-i', o.dry, '-filter_complex', film, '-map', '0:v', '-map', '[af]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o.out]
  const music = `[1:a]atrim=0:${total},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,volume=${mix.music.db}dB` +
    `${o.commands ? `,asendcmd=f=${escapeFilterPath(o.commands)},volume@duck=1` : ''},afade=t=in:d=1,afade=t=out:st=${Math.max(0, r3(total - 2))}:d=2[mus]`
  return ['-i', o.dry, '-stream_loop', '-1', '-i', mix.music.src,
    '-filter_complex', `${film};${music};[af][mus]amix=inputs=2:duration=first:normalize=0[am]`,
    '-map', '0:v', '-map', '[am]', '-t', String(total), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o.out]
}
