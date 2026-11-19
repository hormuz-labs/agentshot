import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backendCandidates, speechBackend, withSpeechAccelerator } from '../src/main/whisper-hardware'
import { setConfig } from '../src/main/config'
import { gpuBuildFlags } from '../scripts/build-whisper-gpu.mjs'

afterEach(() => setConfig({ speechPerformance: undefined }))
describe('portable speech GPU selection', () => {
  it('uses the host GPU backends before CPU, keeping the working GPU for the next chunk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gpu-order-'))
    const ext = process.platform === 'win32' ? '.exe' : ''
    const binary = join(dir, `whisper-cli${ext}`)
    const cuda = join(dir, `whisper-cli-cuda${ext}`), vulkan = join(dir, `whisper-cli-vulkan${ext}`)
    for (const sibling of [cuda, vulkan]) writeFileSync(sibling, '')
    const run = vi.fn(async (o: { binary: string; flags: string[] }) => {
      if (o.binary === cuda) throw new Error('No CUDA device')
    })
    try {
      await speechBackend(binary, run, 'auto')
      expect(run.mock.calls.map(c => c[0].binary)).toEqual(process.platform === 'darwin' ? [binary] : [cuda, vulkan])
      run.mockClear()
      await speechBackend(binary, run, 'auto')
      expect(run).toHaveBeenCalledExactlyOnceWith({ binary: process.platform === 'darwin' ? binary : vulkan, flags: [] })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('offers CUDA and vendor-neutral Vulkan siblings on Linux and Windows, Metal in the Mac binary', () => {
    const path = (name: string) => join(tmpdir(), name)
    expect(backendCandidates(path('whisper-cli'), 'linux', () => true)).toEqual(['whisper-cli-cuda', 'whisper-cli-vulkan', 'whisper-cli'].map(path))
    expect(backendCandidates(path('whisper-cli.exe'), 'win32', () => true)).toEqual(['whisper-cli-cuda.exe', 'whisper-cli-vulkan.exe', 'whisper-cli.exe'].map(path))
    expect(backendCandidates(path('whisper-cli'), 'darwin', () => true)).toEqual([path('whisper-cli')])
  })
  it('retries a failed accelerated inference on CPU and remembers the failure', async () => {
    const run = vi.fn(async (o: { flags: string[] }) => { if (!o.flags.includes('-ng')) throw new Error('GPU out of memory') })
    await speechBackend('/missing/test-engine', run)
    expect(run.mock.calls.map(c => c[0].flags)).toEqual([[], ['-ng']])
    run.mockClear()
    await speechBackend('/missing/test-engine', run)
    expect(run.mock.calls.map(c => c[0].flags)).toEqual([['-ng']])
  })
  it('honors CPU-only and never retries cancellation as a GPU failure', async () => {
    setConfig({ speechPerformance: { device: 'cpu' } })
    const run = vi.fn(async () => {})
    await speechBackend('/custom/engine', run)
    expect(run).toHaveBeenCalledWith({ binary: '/custom/engine', flags: ['-ng'] })
    setConfig({ speechPerformance: { device: 'auto' } })
    const aborted = vi.fn(async () => { throw Object.assign(new Error('stop'), { name: 'AbortError' }) })
    await expect(speechBackend('/cancel/engine', aborted)).rejects.toThrow('stop')
    expect(aborted).toHaveBeenCalledTimes(1)
  })
  it('keeps backend builds portable and separate from baseline binaries', () => {
    expect(gpuBuildFlags('vulkan', true)).toContain('-DGGML_VULKAN=ON')
    expect(gpuBuildFlags('vulkan', true)).toContain('-DGGML_AVX2=OFF')
    expect(gpuBuildFlags('cuda', false)).toContain('-DGGML_CUDA=ON')
    expect(() => gpuBuildFlags('unknown')).toThrow()
  })
  it('shares the GPU slot between native and managed inference', async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(r => { release = r })
    const ready = new Promise<void>(r => { started = r })
    const managed = withSpeechAccelerator(async () => { started(); await gate })
    await ready
    const run = vi.fn(async () => {})
    const native = speechBackend('/shared/gpu', run)
    try { await Promise.resolve(); expect(run).not.toHaveBeenCalled() }
    finally { release(); await Promise.all([managed, native]) }
    expect(run).toHaveBeenCalledTimes(1)
  })
})
