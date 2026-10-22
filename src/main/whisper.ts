// Speech-to-text. Uses whisper.cpp when it is already on this computer (found automatically, or paths the user set),
// otherwise faster-whisper that Manul downloads. One transcription at a time, so a long file never freezes the machine.
import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { promisify } from 'node:util'
import { getConfig, setConfig } from './config'
import { asJob, type JobHandle } from './jobs'
import { FFMPEG, probe, WHISPER_CLI } from './media'
import { isInstalled, scriptPath, venvPython, WHISPER_MODEL, whisperEnv, whisperModelPath, whisperLargeModelPath } from './tools'
import type { Segment, Transcript, WhisperConfig, WhisperStatus, Word } from '../shared/types'
import { dtwFlags, dtwLag, envelope, readWav, snapSegments, whisperCppWords } from './wordtimes'

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
  for (const name of BIN_NAMES) {
    try { (await run('which', ['-a', name])).stdout.split('\n').filter(Boolean).forEach(p => out.add(p.trim())) } catch { /* not on PATH */ }
    for (const d of BIN_DIRS) if (existsSync(join(d, name))) out.add(join(d, name))
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
export const bundledReady = () => bundledBinary() && isInstalled('whisper-model') && existsSync(whisperModelPath())
const bundled = () => ({ engine: 'bundled' as const, binary: WHISPER_CLI, model: whisperModelPath(), label: 'whisper.cpp · base (bundled)' })
/** The tool to offer when no engine is ready: the model for the bundled whisper.cpp, else the Python engine. */
export const toolToInstall = () => (bundledBinary() ? 'whisper-model' : 'whisper')
const system = (binary: string, model: string) => ({ engine: 'system' as const, binary, model, label: `whisper.cpp · ${basename(model).replace(/^ggml-|\.bin$/g, '')}` })
const managed = () => ({ engine: 'managed' as const, label: `faster-whisper · ${WHISPER_MODEL} (downloaded by Manul)` })

export async function whisperStatus(find: Finders = FIND): Promise<WhisperStatus> {
  const binaries = await find.binaries()
  return { config: getConfig().whisper, active: await resolveEngine(find), found: { binaries, models: find.models(binaries) },
    managedInstalled: isInstalled('whisper'), bundledBinary: bundledBinary(), bundledReady: bundledReady() }
}

/** The user picked paths (custom), asked to re-detect (auto), or chose the downloaded engine. */
export async function setWhisper(c: Partial<WhisperConfig> & { mode: WhisperConfig['mode'] }, find: Finders = FIND) {
  if (c.mode === 'auto') setConfig({ whisper: undefined })
  else setConfig({ whisper: { engine: c.engine || 'system', mode: 'custom', binary: c.binary, model: c.model } })
  return whisperStatus(find)
}

// ---------------------------------------------------------------- transcription (queued: one at a time)
let queue: Promise<unknown> = Promise.resolve()

export function transcribe(file: string, outJson: string, title: string, project?: string, engine?: WhisperStatus['active']): Promise<Transcript> {
  const next = queue.then(() => asJob(title, 'transcribe', j => runTranscribe(file, outJson, j, engine), { project, doneTitle: title.replace(/^Transcribing/, 'Transcribed') }))
  queue = next.catch(() => {})
  return next
}

const largeExports = new Map<string, Promise<Transcript>>()
export const LARGE_EXPORT_LABEL = 'whisper.cpp · large-v3 (export)'

/** Separate cache: export upgrades never reuse Base text or replace editing transcripts and their word timings. */
export async function exportTranscript(file: string, outJson: string, title: string, project?: string): Promise<Transcript | null> {
  if (!isInstalled('whisper-large-v3')) return null
  try {
    const cached = JSON.parse(await readFile(outJson, 'utf8')) as Transcript
    if (cached.model === LARGE_EXPORT_LABEL || cached.model === 'no audio track') return cached
  } catch { /* not transcribed with Large-v3 yet */ }
  const busy = largeExports.get(outJson)
  if (busy) return busy
  const task = (async () => {
    const cfg = getConfig().whisper
    const binary = bundledBinary() ? WHISPER_CLI : cfg?.binary && existsSync(cfg.binary) ? cfg.binary : (await findBinaries())[0]
    if (!binary) throw new Error('Whisper Large-v3 needs whisper.cpp. Set its binary in Settings → Speech recognition.')
    return transcribe(file, outJson, title, project, { engine: 'system', binary, model: whisperLargeModelPath(), label: LARGE_EXPORT_LABEL })
  })().finally(() => largeExports.delete(outJson))
  largeExports.set(outJson, task)
  return task
}

async function runTranscribe(file: string, outJson: string, j: JobHandle, selected?: WhisperStatus['active']): Promise<Transcript> {
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
  await run(FFMPEG, ['-y', '-loglevel', 'error', '-i', file, '-vn', '-af', 'aresample=16000:async=1:first_pts=0', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav])
  try {
    if (engine.engine === 'system' || engine.engine === 'bundled') {
      // one word per segment (-ml 1 -sow); DTW token times for word starts where the build and model support it
      const tmp = wav.replace(/\.wav$/, '')
      const english = /\.en(\b|[.-])/.test(basename(engine.model!))
      const dtw = await dtwFlags(engine.binary!, engine.model!)
      await proc(engine.binary!, ['-m', engine.model!, '-f', wav, '-ojf', '-of', tmp, '-ml', '1', '-sow', '-pp', '-np', '-t', '4',
        '-l', english ? 'en' : 'auto', '--prompt', FILLER_PROMPT, ...dtw], undefined, line => {
        const m = /progress\s*=\s*(\d+)%/.exec(line)
        if (m) j.progress(Number(m[1]) / 100, `${engine.label}`)
      })
      const raw = JSON.parse(await readFile(`${tmp}.json`, 'utf8'))
      await rm(`${tmp}.json`, { force: true })
      segments = groupWords(whisperCppWords(raw, dtw.length ? dtwLag(engine.model!) : null))
      language = raw.result?.language || (english ? 'en' : 'auto')
    } else {
      const tmp = `${outJson}.tmp`
      await proc(venvPython('whisper'), [scriptPath('transcribe.py'), wav, '--out', tmp, '--model', WHISPER_MODEL], whisperEnv(), line => {
        const m = /^PROGRESS ([\d.]+)/.exec(line)
        if (m) j.progress(Number(m[1]), engine.label)
      })
      const raw = JSON.parse(await readFile(tmp, 'utf8')) as { language: string; segments: Segment[] }
      await rm(tmp, { force: true })
      segments = raw.segments
      language = raw.language
    }
    // every word's start and end become cut points in the quiet around it (see wordtimes.ts)
    j.progress(null, 'Placing word boundaries')
    const { sr, x } = readWav(await readFile(wav))
    segments = snapSegments(segments, envelope(x, sr))
  } finally {
    await rm(wav, { force: true })
  }

  const t: Transcript = { media: basename(file), language, model: engine.label, segments, createdAt: Date.now() }
  await writeFile(outJson, JSON.stringify(t))
  return t
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
    const p = spawn(cmd, args, { env: env || process.env })
    let err = ''
    const feed = (d: Buffer) => { const s = String(d); err = (err + s).slice(-4000); s.split(/\r|\n/).forEach(onLine) }
    p.stderr.on('data', feed)
    p.stdout.on('data', feed)
    p.on('error', fail)
    p.on('close', code => (code === 0 ? ok() : fail(new Error(`Transcription failed: ${err.slice(-1500)}`))))
  })
}

/** Project-relative transcript path for a media file. */
export const transcriptPathFor = (mediaRel: string) => join('transcripts', `${basename(mediaRel, extname(mediaRel))}.json`)
