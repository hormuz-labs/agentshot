// Coarse normalized envelope correlation, then independent GCC-PHAT anchors and robust clock-drift fitting.
// GCC-PHAT frequency-domain formulation adapted from xiongyihui/tdoa (Apache-2.0),
// Copyright (c) 2017 Yihui Xiong. TypeScript implementation and multi-anchor fitting by Hormuz Labs.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { FFMPEG, probe } from './media'
import type { MediaSync, SyncAnchor } from '../shared/demo'

const SR = 8000
// Self-contained closure: bundlers may rename top-level symbols, so the worker serializes the whole engine.
function audioSyncEngine() {
const SR = 8000, HZ = 50
const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]

/** In-place radix-2 FFT, bounded to audio windows / low-rate envelopes. */
function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let b = n >> 1
    for (; j & b; b >>= 1) j ^= b
    j ^= b
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len *= 2) {
    const a = (inverse ? 2 : -2) * Math.PI / len, cr = Math.cos(a), ci = Math.sin(a)
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0
      for (let j = 0; j < len / 2; j++) {
        const u = i + j, v = u + len / 2, r = re[v] * wr - im[v] * wi, m = re[v] * wi + im[v] * wr
        re[v] = re[u] - r; im[v] = im[u] - m; re[u] += r; im[u] += m
        const next = wr * cr - wi * ci; wi = wr * ci + wi * cr; wr = next
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

function correlation(a: Float32Array, b: Float32Array, phat = false): Float64Array {
  const n = 2 ** Math.ceil(Math.log2(a.length + b.length))
  const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n)
  ar.set(a); br.set(b); fft(ar, ai); fft(br, bi)
  for (let i = 0; i < n; i++) {
    const r = ar[i] * br[i] + ai[i] * bi[i], m = ai[i] * br[i] - ar[i] * bi[i]
    const scale = phat ? Math.max(1e-12, Math.hypot(r, m)) : 1
    ar[i] = r / scale; ai[i] = m / scale
  }
  fft(ar, ai, true)
  return ar
}

function audioEnvelope(x: Float32Array, sr = SR): Float32Array {
  const hop = Math.round(sr / HZ), n = Math.floor(x.length / hop), out = new Float32Array(n)
  for (let k = 0; k < n; k++) {
    let sum = 0
    for (let i = k * hop; i < (k + 1) * hop; i++) sum += x[i] * x[i]
    out[k] = Math.log(Math.max(1e-8, sum / hop))
  }
  return out
}

function prefix(x: Float32Array) {
  const sum = new Float64Array(x.length + 1), sq = new Float64Array(x.length + 1)
  for (let i = 0; i < x.length; i++) { sum[i + 1] = sum[i] + x[i]; sq[i + 1] = sq[i] + x[i] * x[i] }
  return { sum, sq }
}

/** Offset is a_time - b_time; normalize each candidate using its actual overlap (not padded zeros). */
function envelopeMatch(a: Float32Array, b: Float32Array, lo?: number, hi?: number) {
  if (!a.length || !b.length) return { lag: 0, score: 0, margin: 0 }
  const cc = correlation(a, b), pa = prefix(a), pb = prefix(b)
  const minimum = Math.min(Math.min(a.length, b.length), Math.max(100, Math.min(500, Math.floor(Math.min(a.length, b.length) * 0.4))))
  const scores: { lag: number; score: number }[] = []
  for (let lag = Math.max(-b.length + minimum, lo ?? -Infinity); lag <= Math.min(a.length - minimum, hi ?? Infinity); lag++) {
    const s = Math.max(0, lag), e = Math.min(a.length, b.length + lag), bs = s - lag, be = e - lag, n = e - s
    const sa = pa.sum[e] - pa.sum[s], sb = pb.sum[be] - pb.sum[bs]
    const va = pa.sq[e] - pa.sq[s] - sa * sa / n, vb = pb.sq[be] - pb.sq[bs] - sb * sb / n
    const score = va > 1e-6 && vb > 1e-6 ? (cc[(lag + cc.length) % cc.length] - sa * sb / n) / Math.sqrt(va * vb) : 0
    scores.push({ lag, score })
  }
  scores.sort((x, y) => y.score - x.score)
  const best = scores[0] || { lag: 0, score: 0 }
  const other = scores.find(x => Math.abs(x.lag - best.lag) > HZ)
  return { ...best, margin: best.score - (other?.score ?? 0) }
}

function refine(a: Float32Array, b: Float32Array, maxLag: number) {
  const cc = correlation(a, b, true)
  let peak = 0, lag = 0, sum = 0, count = 0
  for (let k = -maxLag; k <= maxLag; k++) {
    const v = Math.abs(cc[(k + cc.length) % cc.length])
    sum += v; count++
    if (v > peak) { peak = v; lag = k }
  }
  return { lag, strength: peak / Math.max(1e-12, sum / count) }
}

function fitSync(anchors: SyncAnchor[], coarse: number, screenDuration: number, cameraDuration: number): MediaSync {
  let good = anchors.filter(a => a.score >= 0.4 && Number.isFinite(a.camera) && Number.isFinite(a.screen)).sort((a, b) => a.camera - b.camera)
    .filter((a, i, all) => !i || a.camera - all[i - 1].camera >= 0.1), rate = 1, offset = coarse
  if (good.length >= 2) {
    const slopes: number[] = []
    for (let i = 0; i < good.length; i++) for (let j = i + 1; j < good.length; j++) if (good[j].camera - good[i].camera > 3) slopes.push((good[j].screen - good[i].screen) / (good[j].camera - good[i].camera))
    if (slopes.length) rate = median(slopes)
    offset = median(good.map(a => a.screen - rate * a.camera))
    good = good.filter(a => Math.abs(a.screen - offset - rate * a.camera) <= 0.12)
    if (good.length >= 2) {
      const cx = good.reduce((s, a) => s + a.camera, 0) / good.length, cy = good.reduce((s, a) => s + a.screen, 0) / good.length
      rate = good.reduce((s, a) => s + (a.camera - cx) * (a.screen - cy), 0) / good.reduce((s, a) => s + (a.camera - cx) ** 2, 0)
      offset = cy - rate * cx
    }
  }
  const residual = good.length ? Math.max(...good.map(a => Math.abs(a.screen - offset - rate * a.camera))) : 999
  const span = good.length > 1 ? good.at(-1)!.camera - good[0].camera : 0
  const reliable = good.length >= 3 && span >= Math.min(10, cameraDuration * 0.4) && rate >= 0.995 && rate <= 1.005 && residual < 0.08
  return { offset, rate, confidence: good.length ? Math.min(1, good.reduce((s, a) => s + a.score, 0) / good.length * Math.min(1, good.length / 3)) : 0,
    reliable, anchors: good, residual, overlap: [Math.max(0, offset), Math.min(screenDuration, offset + rate * cameraDuration)], method: 'normalized-envelope + multi-anchor GCC-PHAT + robust drift fit' }
}

/** Pure sync engine, also used on known shifted/noisy/drifting fixture signals. */
function synchronize(screen: Float32Array, camera: Float32Array, sr = SR): MediaSync {
  const se = audioEnvelope(screen, sr), ce = audioEnvelope(camera, sr), match = envelopeMatch(se, ce), coarse = match.lag / HZ
  const sd = screen.length / sr, cd = camera.length / sr
  const from = Math.max(0, -coarse), to = Math.min(cd, sd - coarse), win = Math.min(8, (to - from) / 3)
  const anchors: SyncAnchor[] = []
  if (win >= 1 && match.score > 0.25) {
    for (let i = 0; i < 7; i++) {
      const c = from + win / 2 + (to - from - win) * i / 6, cs = Math.round((c - win / 2) * HZ)
      const local = envelopeMatch(se, ce.slice(cs, cs + Math.round(win * HZ)), Math.round((coarse + cs / HZ - 2) * HZ), Math.round((coarse + cs / HZ + 2) * HZ))
      const ss = local.lag / HZ, cameraStart = cs / HZ
      const aw = screen.slice(Math.round(ss * sr), Math.round((ss + win) * sr)), bw = camera.slice(Math.round(cameraStart * sr), Math.round((cameraStart + win) * sr))
      if (ss < 0 || aw.length !== bw.length || local.score < 0.4) continue
      const fine = refine(aw, bw, Math.round(sr * 0.15))
      if (fine.strength < 5) continue
      anchors.push({ camera: cameraStart + win / 2, screen: ss + win / 2 + fine.lag / sr, score: Math.min(1, local.score) })
    }
  }
  const result = fitSync(anchors, coarse, sd, cd)
  // A repeated take or periodic sound can match at multiple offsets; do not silently pick the wrong occurrence.
  if (match.margin < 0.01) { result.reliable = false; result.confidence *= 0.5 }
  return result
}
return { audioEnvelope, envelopeMatch, fitSync, synchronize }
}
export const { audioEnvelope, envelopeMatch, fitSync, synchronize } = audioSyncEngine()

export async function syncMedia(project: string, screen: string, camera: string, signal?: AbortSignal): Promise<MediaSync> {
  const files = [screen, camera].map(f => join(project, f)), info = await Promise.all(files.map(probe))
  if (info.some(i => !i.hasAudio)) throw new Error('Automatic sync needs a common audio track in both recordings. Give a matching screen/camera moment for manual alignment.')
  if (info.some(i => i.duration > 7200)) throw new Error('Automatic demo sync supports recordings up to two hours each.')
  const stamps = await Promise.all(files.map(async f => { const s = await stat(f); return `${f}:${s.size}:${s.mtimeMs}` }))
  const dir = join(project, '.cache', 'sync'), cached = join(dir, createHash('sha256').update(stamps.join('|') + ':v3-stream-timestamps').digest('hex') + '.json')
  try { return JSON.parse(await readFile(cached, 'utf8')) } catch { /* analyze */ }
  const audio = await Promise.all(files.map(file => new Promise<Float32Array>((ok, fail) => execFile(FFMPEG,
    ['-v', 'error', '-i', file, '-vn', '-af', `highpass=f=100,lowpass=f=3400,aresample=${SR}:async=1:first_pts=0`, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-'],
    { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, signal }, (err, stdout, stderr) => {
      if (err) return fail(new Error(`Audio extraction failed: ${stderr.toString().slice(-1000) || err.message}`))
      const x = new Float32Array(stdout.length / 4)
      for (let i = 0; i < x.length; i++) x[i] = stdout.readFloatLE(i * 4)
      ok(x)
    }))))
  // FFT work is CPU-bound: keep Electron responsive, and make Stop terminate calculation immediately.
  const result = await new Promise<MediaSync>((ok, fail) => {
    signal?.throwIfAborted()
    const code = `const { parentPort, workerData } = require('node:worker_threads');
      parentPort.postMessage((${audioSyncEngine.toString()})().synchronize(new Float32Array(workerData[0]), new Float32Array(workerData[1])));`
    const worker = new Worker(code, { eval: true, workerData: audio.map(a => a.buffer), transferList: audio.map(a => a.buffer as ArrayBuffer) })
    const abort = () => { worker.terminate(); fail(signal?.reason || new Error('Sync stopped.')) }
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('message', result => { signal?.removeEventListener('abort', abort); ok(result) })
    worker.once('error', err => { signal?.removeEventListener('abort', abort); fail(err) })
    worker.once('exit', code => { signal?.removeEventListener('abort', abort); if (code !== 0) fail(new Error('Audio sync worker stopped.')) })
  })
  await mkdir(dir, { recursive: true }); await writeFile(cached, JSON.stringify(result))
  return result
}
