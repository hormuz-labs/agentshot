// Speech-to-text. Automatic mode prefers bundled GPU-capable whisper.cpp; custom native and downloaded
// Python engines remain available. Shared checkpoints bound decoding and survive restarts.
import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { accessSync, constants, existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { availableParallelism, homedir } from 'node:os'
import { basename, delimiter, dirname, extname, join, posix } from 'node:path'
import { promisify } from 'node:util'
import { getConfig, setConfig } from './config'
import { asJob, onJobs, type JobHandle } from './jobs'
import { FFMPEG, probe, WHISPER_CLI } from './media'
import { activeWhisperModel, isInstalled, scriptPath, venvPython, WHISPER_MODEL, whisperEnv, whisperLargeModelPath } from './tools'
import type { Segment, Transcript, WhisperConfig, WhisperStatus, Word } from '../shared/types'
import { dtwFlags, dtwLag, envelope, readWav, snapSegments, whisperCppWords } from './wordtimes'
import { envPath } from './paths'
import { atomicTranscript, fileRevision, TranscriptChunks, validRange, validTranscript, type TranscriptRange } from './transcript-chunks'
import { TranscriptionQueue } from './transcription-queue'
import { transcriptProfile } from './transcript-profile'
import { backendCandidates, speechBackend, speechProfile, cpuThreads, withSpeechAccelerator } from './whisper-hardware'
export type { TranscriptRange } from './transcript-chunks'

const run = promisify(execFile)

// Prompting with disfluencies makes Whisper keep them ("um", "uh") instead of cleaning them up.
const FILLER_PROMPT = "Umm, let me think, like, hmm... Okay, uh, here's what I'm, you know, thinking."

// ---------------------------------------------------------------- discovery
const BIN_NAMES = ['whisper-cli', 'whisper-cpp']
const BIN_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', join(homedir(), '.local/bin'), join(homedir(), 'bin')]
const MODEL_DIRS = [
  join(homedir(), '.cache/whisper-cpp'), join(homedir(), '.cache/whisper'), join(homedir(), '.local/share/whisper-cpp'),
  '/opt/homebrew/share/whisper-cpp', '/usr/local/share/whisper-cpp', '/usr/share/whisper-cpp', join(homedir(), 'models'),
]
// Light models first: base is accurate enough for editing and never ties up the machine.
const MODEL_RANK = ['base.en', 'base', 'small.en', 'small', 'tiny.en', 'tiny', 'medium.en', 'medium', 'large-v3-turbo', 'large']

export async function findBinaries(): Promise<string[]> {
  const out = new Set<string>()
  const dirs = [...envPath().split(delimiter).filter(Boolean).map(d => d.replace(/^"|"$/g, '')), ...BIN_DIRS]
  for (const base of BIN_NAMES) {
    const name = process.platform === 'win32' ? `${base}.exe` : base
    for (const d of dirs) {
      const path = join(d, name)
      try {
        if (!statSync(path).isFile()) continue
        if (process.platform !== 'win32') accessSync(path, constants.X_OK)
        out.add(path)
      } catch { /* not installed or executable */ }
    }
  }
  return [...out]
}

export function findModels(near: string[] = [], base: string[] = MODEL_DIRS): string[] {
  const dirs = [...base, ...near.map(b => join(dirname(b), '../share/whisper-cpp')), ...near.map(b => join(dirname(b), 'models'))]
  const out = new Set<string>()
  for (const d of dirs) {
    try {
      for (const f of readdirSync(d)) {
        if (/^ggml-.*\.bin$/.test(f) && !f.includes('for-tests') && statSync(join(d, f)).size > 10e6) out.add(join(d, f))
      }
    } catch { /* missing folder */ }
  }
  const rank = (p: string) => { const n = basename(p).replace(/^ggml-|\.bin$/g, ''); const i = MODEL_RANK.findIndex(r => n === r || n.startsWith(r + '-q')); return i < 0 ? 99 : i }
  return [...out].sort((a, b) => rank(a) - rank(b))
}

type Finders = { binaries: () => Promise<string[]>; models: (near: string[]) => string[] }
const FIND: Finders = { binaries: findBinaries, models: near => findModels(near) }

/** The engine to use now. Saves what auto-detection found, so the next run doesn't search again. */
export async function resolveEngine(find: Finders = FIND): Promise<WhisperStatus['active']> {
  const cfg = getConfig().whisper
  const usable = (c?: WhisperConfig) => c?.engine === 'system' && !!c.binary && !!c.model && existsSync(c.binary) && existsSync(c.model)
  const fallback = () => (bundledReady() ? bundled() : isInstalled('whisper') ? managed() : null)
  // Automatic configurations follow the native bundled engine when it becomes available (Metal/Vulkan).
  if (cfg?.mode !== 'custom' && bundledReady()) return bundled()
  if (cfg?.engine === 'managed' && isInstalled('whisper')) return managed()
  if (cfg?.engine === 'bundled' && bundledReady()) return bundled()
  if (usable(cfg)) return system(cfg!.binary!, cfg!.model!)
  if (cfg?.mode === 'custom' && cfg.engine === 'system') return fallback() // the user's paths are gone: never re-detect over them
  const bins = await find.binaries()
  const models = find.models(bins)
  if (bins[0] && models[0]) {
    setConfig({ whisper: { engine: 'system', mode: 'auto', binary: bins[0], model: models[0] } })
    return system(bins[0], models[0])
  }
  return fallback()
}
export const bundledBinary = () => existsSync(WHISPER_CLI)
export const bundledReady = () => bundledBinary() && isInstalled('whisper-model') && existsSync(activeWhisperModel())
const bundled = () => ({ engine: 'bundled' as const, binary: WHISPER_CLI, model: activeWhisperModel(), label: 'whisper.cpp · base (bundled)' })
/** The tool to offer when no engine is ready: the model for the bundled whisper.cpp, else the Python engine. */
export const toolToInstall = () => (bundledBinary() ? 'whisper-model' : 'whisper')
const system = (binary: string, model: string) => ({ engine: 'system' as const, binary, model, label: `whisper.cpp · ${basename(model).replace(/^ggml-|\.bin$/g, '')}` })
const managed = () => ({ engine: 'managed' as const, label: `faster-whisper · ${WHISPER_MODEL} (downloaded by AgentShot)` })

export async function whisperStatus(find: Finders = FIND): Promise<WhisperStatus> {
  const binaries = await find.binaries()
  return { config: getConfig().whisper, performance: getConfig().speechPerformance, active: await resolveEngine(find), found: { binaries, models: find.models(binaries) },
    managedInstalled: isInstalled('whisper'), bundledBinary: bundledBinary(), bundledReady: bundledReady() }
}

/** The user picked paths (custom), asked to re-detect (auto), or chose the downloaded engine. */
export async function setWhisper(c: Partial<WhisperConfig> & { mode: WhisperConfig['mode'] }, find: Finders = FIND) {
  if (c.mode === 'auto') setConfig({ whisper: undefined })
  else setConfig({ whisper: { engine: c.engine || 'system', mode: 'custom', binary: c.binary, model: c.model } })
  return whisperStatus(find)
}

// ---------------------------------------------------------------- resumable source-clock transcription
const chunks = new TranscriptChunks(new TranscriptionQueue(availableParallelism() >= 8 ? 2 : 1))
const stopping = new AbortController()
export function stopTranscription() { chunks.queue.close(); stopping.abort() }
onJobs(jobs => chunks.queue.setRendering(jobs.some(j => j.kind === 'render' && j.status === 'running')))
const demanded = new Set<string>()
export function prioritizeTranscription(file: string) { demanded.add(file); chunks.demand(file) }
const cacheFor = (file: string, project?: string) => join(project || dirname(file), '.cache', 'transcript-chunks')
let managedCpuOnly = false

export async function profileFor(engine: NonNullable<WhisperStatus['active']>, settings = speechProfile()) {
  const inputs = engine.binary ? [engine.model!, ...backendCandidates(engine.binary)] : [venvPython('whisper'), scriptPath('transcribe.py')]
  return transcriptProfile(engine, inputs, settings, WHISPER_MODEL)
}

/** Finished transcripts obey the same identity rules as their checkpoints. */
export async function transcriptCurrent(t: Transcript, file: string, selected?: WhisperStatus['active']) {
  if (!validTranscript(t) || !t.revision || t.revision !== await fileRevision(file)) return false
  if (t.model === 'no audio track') return true
  const engine = selected || await resolveEngine()
  return !!engine && t.profile === await profileFor(engine)
}

async function listen(file: string, cache: string, j: JobHandle, project?: string, range?: TranscriptRange, selected?: WhisperStatus['active'], background = false, settings = speechProfile()): Promise<Transcript> {
  if (range && !validRange(range)) throw new Error('Invalid transcription range.')
  const info = await probe(file)
  if (!info.hasAudio) return { media: basename(file), language: 'none', model: 'no audio track', segments: [], createdAt: Date.now(), revision: await fileRevision(file).catch(() => undefined) }
  const engine = selected || await resolveEngine()
  if (!engine) throw new Error('No speech recognition installed.')
  const threads = cpuThreads()
  const modelRevision = engine.model ? await fileRevision(engine.model) : WHISPER_MODEL
  const profile = await profileFor(engine, settings)
  await mkdir(cache, { recursive: true })
  let completed = 0
  return chunks.read({ file, cache, duration: info.duration, profile, range, background,
    progress: (done, total) => { completed = done; j.progress(done / total, `${Math.round(done)} / ${Math.round(total)}s saved · resumes after restart`) },
    run: async span => {
      const tmp = join(cache, `.${randomUUID()}.json`)
      try {
        const progress: JobHandle = { ...j, progress: (_p, detail) => j.progress(completed / (range ? range.t1 - range.t0 : info.duration), `${detail || engine.label} · ${Math.floor(span.t0)}–${Math.ceil(span.t1)}s`) }
        if (engine.model && await fileRevision(engine.model) !== modelRevision) throw new Error('Speech model changed. Please retry.')
        const result = await runTranscribe(file, tmp, progress, engine, span, threads, settings)
        if (engine.model && await fileRevision(engine.model) !== modelRevision) throw new Error('Speech model changed. Please retry.')
        return result
      } finally { await rm(tmp, { force: true }) }
    },
  })
}

export async function transcribeRange(file: string, _cacheDir: string, range: TranscriptRange, title: string, project?: string, background = false): Promise<Transcript> {
  if (!validRange(range)) throw new Error('Invalid transcription range.')
  return asJob(title, 'transcribe', j => listen(file, cacheFor(file, project), j, project, range, undefined, background), { project })
}

export function transcribe(file: string, outJson: string, title: string, project?: string, engine?: WhisperStatus['active'], background = false, settings = speechProfile()): Promise<Transcript> {
  return asJob(title, 'transcribe', async j => {
    try {
      const t = await listen(file, cacheFor(file, project), j, project, undefined, engine, background && !demanded.has(file), settings)
      await mkdir(dirname(outJson), { recursive: true })
      await atomicTranscript(outJson, t)
      return t
    } finally { demanded.delete(file) }
  }, { project, doneTitle: title.replace(/^Transcribing/, 'Transcribed') })
}

const largeExports = new Map<string, Promise<Transcript>>()
export const LARGE_EXPORT_LABEL = 'whisper.cpp · large-v3 (export)'

/** Separate cache: export upgrades never reuse Base text or replace editing transcripts and their word timings. */
export async function exportTranscript(file: string, outJson: string, title: string, project?: string): Promise<Transcript | null> {
  if (!isInstalled('whisper-large-v3')) return null
  const cfg = getConfig().whisper
  const binary = bundledBinary() ? WHISPER_CLI : cfg?.binary && existsSync(cfg.binary) ? cfg.binary : (await findBinaries())[0]
  if (!binary) throw new Error('Whisper Large-v3 needs whisper.cpp. Set its binary in Settings → Speech recognition.')
  const engine = { engine: 'system' as const, binary, model: whisperLargeModelPath(), label: LARGE_EXPORT_LABEL }
  const settings = speechProfile()
  const key = JSON.stringify([outJson, await profileFor(engine, settings), await fileRevision(file).catch(() => undefined)])
  const busy = largeExports.get(key)
  if (busy) return busy
  const task = (async () => {
    try {
      const cached = JSON.parse(await readFile(outJson, 'utf8')) as Transcript
      if ((cached.model === LARGE_EXPORT_LABEL || cached.model === 'no audio track') && await transcriptCurrent(cached, file, engine)) return cached
    } catch { /* stale, legacy or corrupt export cache */ }
    return transcribe(file, outJson, title, project, engine, false, settings)
  })().finally(() => largeExports.delete(key))
  largeExports.set(key, task)
  return task
}

async function runTranscribe(file: string, outJson: string, j: JobHandle, selected?: WhisperStatus['active'], range?: TranscriptRange, threads = 4, settings = speechProfile()): Promise<Transcript> {
  await mkdir(dirname(outJson), { recursive: true })
  // nothing to hear: an empty transcript, no engine needed
  if (!(await probe(file).then(i => i.hasAudio, () => true))) {
    const t: Transcript = { media: basename(file), language: 'none', model: 'no audio track', segments: [], createdAt: Date.now() }
    await writeFile(outJson, JSON.stringify(t))
    return t
  }
  const engine = selected || await resolveEngine()
  if (!engine) throw new Error('No speech recognition installed.')
  await mkdir(dirname(outJson), { recursive: true })
  let segments: Segment[], language: string

  // 16 kHz mono WAV: what whisper.cpp reads, and what word boundaries are checked against
  const wav = join(dirname(outJson), `.${basename(outJson, '.json')}.wav`)
  j.progress(null, 'Extracting audio')
  try {
    await run(FFMPEG, ['-y', '-loglevel', 'error', ...(range ? ['-ss', String(range.t0)] : []), '-i', file,
      ...(range ? ['-t', String(range.t1 - range.t0)] : []), '-vn', '-af', 'aresample=16000:async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav], { windowsHide: true, signal: stopping.signal })
    if (engine.engine === 'system' || engine.engine === 'bundled') {
      // one word per segment (-ml 1 -sow); DTW token times for word starts where the build and model support it
      const tmp = wav.replace(/\.wav$/, '')
      const english = /\.en(\b|[.-])/.test(basename(engine.model!))
      await speechBackend(engine.binary!, async args => {
        const dtw = await dtwFlags(args.binary, engine.model!)
        await rm(`${tmp}.json`, { force: true })
        let usedGpu = false
        await proc(args.binary, [...args.flags, '-m', engine.model!, '-f', wav, '-ojf', '-of', tmp, '-ml', '1', '-sow', '-pp', '-t', String(threads),
        '-l', english ? 'en' : 'auto', '--prompt', FILLER_PROMPT, ...dtw], undefined, line => {
        const m = /progress\s*=\s*(\d+)%/.exec(line)
        if (/using (?:CUDA\d*|Vulkan\d*|Metal) backend/i.test(line)) usedGpu = true
        if (args.binary !== engine.binary && /whisper_backend_init_gpu: (?:no GPU found|failed to initialize)/.test(line)) {
          throw new Error('GPU backend unavailable; trying the next backend.')
        }
        if (m) j.progress(Number(m[1]) / 100, `${engine.label}`)
        })
        if (args.binary !== engine.binary && !usedGpu) throw new Error('GPU sibling used CPU; trying the next GPU backend.')
        const raw = JSON.parse(await readFile(`${tmp}.json`, 'utf8'))
        segments = groupWords(whisperCppWords(raw, dtw.length ? dtwLag(engine.model!) : null))
        language = raw.result?.language || (english ? 'en' : 'auto')
      }, settings.device, engine.model)
    } else {
      const tmp = `${outJson}.tmp`
      const listen = (device: 'auto' | 'cpu') => proc(venvPython('whisper'), [scriptPath('transcribe.py'), wav, '--out', tmp, '--model', WHISPER_MODEL, '--threads', String(threads),
        '--beam-size', String(settings.beam), '--device', device, ...(settings.vad ? ['--vad'] : [])], whisperEnv(), line => {
        if (device === 'auto' && line.startsWith('BACKEND cpu')) managedCpuOnly = true
        const m = /^PROGRESS ([\d.]+)/.exec(line)
        if (m) j.progress(Number(m[1]), engine.label)
      })
      const runManaged = async () => {
        const device = managedCpuOnly ? 'cpu' : settings.device
        try { await listen(device) }
        catch (e) {
          // Missing CUDA shared libraries can terminate Python before its exception handler runs.
          if (device === 'cpu' || stopping.signal.aborted) throw e
          managedCpuOnly = true
          await listen('cpu')
        }
      }
      if (settings.device === 'cpu' || managedCpuOnly) await runManaged()
      else await withSpeechAccelerator(runManaged)
      const raw = JSON.parse(await readFile(tmp, 'utf8')) as { language: string; segments: Segment[] }
      await rm(tmp, { force: true })
      segments = raw.segments
      language = raw.language
    }
    // every word's start and end become cut points in the quiet around it (see wordtimes.ts)
    j.progress(null, 'Placing word boundaries')
    const { sr, x } = readWav(await readFile(wav))
    segments = snapSegments(segments!, envelope(x, sr))
    if (range) segments = offsetSegments(segments, range.t0)
  } finally {
    await rm(wav, { force: true })
    await rm(`${outJson}.tmp`, { force: true })
    await rm(wav.replace(/\.wav$/, '.json'), { force: true })
  }

  const t: Transcript = { media: basename(file), language: language!, model: engine.label, segments, createdAt: Date.now() }
  await writeFile(outJson, JSON.stringify(t))
  return t
}

/** Engines and boundary snapping use excerpt-local time; callers always receive source-file time. */
export function offsetSegments(segments: Segment[], offset: number): Segment[] {
  return segments.map(s => ({ ...s, s: s.s + offset, e: s.e + offset,
    words: s.words.map(w => ({ ...w, s: w.s + offset, e: w.e + offset })) }))
}

/** Words → sentence-like segments: break after . ? ! or a pause, and keep segments short enough to read. */
export function groupWords(words: Word[]): Segment[] {
  const out: Segment[] = []
  let cur: Word[] = []
  const flush = () => { if (cur.length) out.push({ s: cur[0].s, e: cur[cur.length - 1].e, text: cur.map(w => w.w).join(' '), words: cur }); cur = [] }
  words.forEach((w, i) => {
    const prev = words[i - 1]
    if (cur.length && (/[.?!]["')\]]?$/.test(prev.w) || w.s - prev.e > 0.8 || cur.length >= 24)) flush()
    cur.push(w)
  })
  flush()
  return out
}

function proc(cmd: string, args: string[], env: NodeJS.ProcessEnv | undefined, onLine: (l: string) => void) {
  return new Promise<void>((ok, fail) => {
    const p = spawn(cmd, args, { env: env || process.env, windowsHide: true, signal: stopping.signal })
    let err = '', lineError: unknown
    for (const stream of [p.stderr, p.stdout]) {
      let pending = ''
      const report = (line: string) => {
        try { onLine(line) }
        catch (e) { lineError = e; p.kill() }
      }
      stream.on('data', (d: Buffer) => {
        const s = String(d); err = (err + s).slice(-4000)
        const lines = (pending + s).split(/\r|\n/)
        pending = lines.pop()!
        lines.forEach(report)
      })
      stream.on('end', () => { if (pending) report(pending) })
    }
    p.on('error', fail)
    p.on('close', code => (lineError ? fail(lineError) : code === 0 ? ok() : fail(new Error(`Transcription failed: ${err.slice(-1500)}`))))
  })
}

/** Project-relative transcript path for a media file. */
export const transcriptPathFor = (mediaRel: string) => posix.join('transcripts', `${basename(mediaRel, extname(mediaRel))}-${createHash('sha256').update(mediaRel).digest('hex').slice(0, 12)}.json`)
