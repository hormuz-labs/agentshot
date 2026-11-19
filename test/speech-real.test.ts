// Opt-in real-engine/resume benchmark. Uses separate processes for seed and completion.
// MANUL_SPEECH_FILE, MANUL_SPEECH_BINARY, MANUL_SPEECH_MODEL, MANUL_SPEECH_CACHE; phase=seed|resume.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { expect, it } from 'vitest'
import { setConfig } from '../src/main/config'
import { transcribe, transcribeRange, transcriptCurrent } from '../src/main/whisper'
import { wordsInRange } from '../src/main/transcript-chunks'

it.skipIf(!process.env.MANUL_SPEECH_FILE)('transcribes real audio, resumes saved checkpoints and replays without inference', async () => {
  const file = resolve(process.env.MANUL_SPEECH_FILE!)
  const dir = resolve(process.env.MANUL_SPEECH_CACHE!)
  const seed = process.env.MANUL_SPEECH_PHASE === 'seed'
  await mkdir(dir, { recursive: true })
  setConfig({ whisper: { mode: 'custom', engine: 'system', binary: resolve(process.env.MANUL_SPEECH_BINARY!), model: resolve(process.env.MANUL_SPEECH_MODEL!) } })
  const cache = join(dir, '.cache', 'transcript-chunks')
  const before = await readdir(cache, { recursive: true }).catch(() => [])
  const saved = await Promise.all(before.filter(f => f.endsWith('.json')).map(async f => [f, await readFile(join(cache, f), 'utf8')] as const))
  const started = performance.now()
  const t = seed
    ? await transcribeRange(file, cache, { t0: 0, t1: 120 }, 'Benchmark seed', dir)
    : await transcribe(file, join(dir, 'transcript.json'), 'Benchmark resume', dir)
  const elapsed = (performance.now() - started) / 1000
  for (const [f, text] of saved) expect(await readFile(join(cache, f), 'utf8')).toBe(text)
  expect(await transcriptCurrent(t, file)).toBe(true)
  const replayStart = performance.now()
  const replay = await transcribeRange(file, cache, { t0: 0, t1: 120 }, 'Replay', dir)
  const replaySeconds = (performance.now() - replayStart) / 1000
  expect(replay.segments).toEqual(wordsInRange(t.segments, { t0: 0, t1: 120 }))
  const result = { phase: seed ? 'seed' : 'resume', seconds: elapsed, replaySeconds, reusedCheckpoints: saved.length,
    checkpoints: (await readdir(cache, { recursive: true })).filter(f => f.endsWith('.json')).length,
    words: t.segments.reduce((n, s) => n + s.words.length, 0) }
  await writeFile(join(dir, `${result.phase}.json`), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}, 3_600_000)
