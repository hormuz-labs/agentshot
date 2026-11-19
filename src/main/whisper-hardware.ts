import { existsSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'
import { getConfig } from './config'

/** Benchmark overrides are explicit, persisted preferences; quality defaults retain Base/beam 5. */
export function speechProfile() {
  const p = getConfig().speechPerformance
  return { beam: p?.beam === 1 ? 1 : 5, vad: p?.vad === true, device: p?.device || 'auto' }
}
export function cpuThreads() {
  const requested = getConfig().speechPerformance?.threads
  return Math.max(1, Math.min(availableParallelism(), requested || 4, 16))
}
const failed = new Set<string>()
const ready = new Map<string, string>()

/** GPU executables are optional siblings, leaving a baseline CPU binary usable even when the
 * Vulkan loader/CUDA libraries are absent. Initializing a real model is the capability probe. */
export function backendCandidates(binary: string, platform = process.platform, exists = existsSync) {
  const ext = extname(binary) === '.exe' ? '.exe' : ''
  // Only the standard baseline opts into sibling discovery; custom executables keep their identity.
  if (basename(binary) !== `whisper-cli${ext}`) return [binary]
  return [
    ...(platform === 'darwin' ? [binary] : ['cuda', 'vulkan'].map(b => join(dirname(binary), `whisper-cli-${b}${ext}`)).filter(exists)),
    binary,
  ].filter((v, i, a) => a.indexOf(v) === i)
}
let accelerator: Promise<unknown> = Promise.resolve()
export function withSpeechAccelerator<T>(run: () => Promise<T>): Promise<T> {
  const task = accelerator.then(run)
  accelerator = task.catch(() => {})
  return task
}
export async function speechBackend(binary: string, run: (o: { binary: string; flags: string[] }) => Promise<void>, device = speechProfile().device, model = '') {
  // One GPU model at a time bounds VRAM even when multiple CPU workers are available.
  if (device !== 'cpu') return withSpeechAccelerator(() => runBackend(binary, run, device, model))
  return runBackend(binary, run, device, model)
}
async function runBackend(binary: string, run: (o: { binary: string; flags: string[] }) => Promise<void>, device: string, model: string) {
  const cpu = device === 'cpu'
  const key = `${binary}:${model}`
  const candidates = cpu ? [] : backendCandidates(binary).filter(b => !failed.has(`${b}:${model}`))
  const selected = ready.get(key)
  if (selected && candidates.includes(selected)) candidates.splice(0, 0, ...candidates.splice(candidates.indexOf(selected), 1))
  for (const candidate of candidates) {
    try { await run({ binary: candidate, flags: [] }); ready.set(key, candidate); return }
    catch (e) {
      if (e instanceof Error && e.name === 'AbortError') throw e
      failed.add(`${candidate}:${model}`); console.warn('[speech] Accelerated engine failed; retrying with another backend:', e instanceof Error ? e.message.slice(-300) : String(e))
    }
  }
  await run({ binary, flags: ['-ng'] })
}
