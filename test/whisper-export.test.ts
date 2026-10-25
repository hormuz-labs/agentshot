import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { listJobs, onJobs } from '../src/main/jobs'

vi.mock('../src/main/media', () => ({
  WHISPER_CLI: process.execPath,
  FFMPEG: process.execPath,
  probe: vi.fn(async () => ({ hasAudio: false })),
}))

process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), 'agentshot-export-tools-'))
const Tools = await import('../src/main/tools')
const { exportTranscript, LARGE_EXPORT_LABEL, resolveEngine } = await import('../src/main/whisper')
const { probe } = await import('../src/main/media')
const { setConfig } = await import('../src/main/config')
const dir = mkdtempSync(join(tmpdir(), 'agentshot-export-transcripts-'))
const cache = join(dir, 'film.large-v3.json')
const transcript = (model: string) => ({ media: 'film.mp4', language: 'en', model, segments: [], createdAt: 1 })
const installed = () => {
  const folder = join(process.env.MANUL_TOOLS!, 'whisper-large-v3')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, '.installed.json'), '{}')
  writeFileSync(Tools.whisperLargeModelPath(), '')
}

afterEach(async () => {
  await Tools.remove('whisper-large-v3')
  setConfig({ whisper: undefined })
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  rmSync(cache, { force: true })
})

describe('optional Large-v3 export captions', () => {
  it('falls back to normal transcription without downloading when the upgrade is absent', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(await exportTranscript('film.mp4', cache, 'Captions')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
  })

  it('reuses only the Large-v3 export cache and leaves the normal engine choice alone', async () => {
    installed()
    writeFileSync(cache, JSON.stringify(transcript(LARGE_EXPORT_LABEL)))
    expect(await exportTranscript('film.mp4', cache, 'Captions')).toEqual(transcript(LARGE_EXPORT_LABEL))
    expect(probe).not.toHaveBeenCalled()
    expect(await resolveEngine({ binaries: async () => [], models: () => [] })).toBeNull()
  })

  it('does not reuse Base output and coalesces simultaneous export transcription', async () => {
    installed()
    const base = join(dir, 'film.json')
    const raw = JSON.stringify(transcript('whisper.cpp · base (bundled)'))
    writeFileSync(base, raw)
    writeFileSync(cache, raw)
    const results = await Promise.all([
      exportTranscript('film.mp4', cache, 'Captions'),
      exportTranscript('film.mp4', cache, 'Captions'),
    ])
    expect(probe).toHaveBeenCalledTimes(1)
    expect(results[0]?.model).toBe('no audio track')
    expect(results[1]).toEqual(results[0])
    expect(readFileSync(base, 'utf8')).toBe(raw)
  })

  it('requires the actual model file, not just an install stamp', async () => {
    const folder = join(process.env.MANUL_TOOLS!, 'whisper-large-v3')
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, '.installed.json'), '{}')
    expect(Tools.isInstalled('whisper-large-v3')).toBe(false)
    expect(Tools.plan('whisper-large-v3').map(t => t.id)).toEqual(['whisper-large-v3'])
  })

  it('rejects an incorrect model checksum and removes partial downloads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not the model')))
    await expect(Tools.install('whisper-large-v3')).rejects.toThrow(/Checksum mismatch/)
    expect(Tools.isInstalled('whisper-large-v3')).toBe(false)
    expect(existsSync(Tools.whisperLargeModelPath())).toBe(false)
    expect(existsSync(`${Tools.whisperLargeModelPath()}.part`)).toBe(false)
  })

  it('cleans up interrupted downloads so a retry is possible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])) },
      pull(controller) { controller.error(new Error('Connection lost')) },
    }))))
    await expect(Tools.install('whisper-large-v3')).rejects.toThrow('Connection lost')
    expect(existsSync(`${Tools.whisperLargeModelPath()}.part`)).toBe(false)
    expect(Tools.plan('whisper-large-v3')).toHaveLength(1)
  })

  it('ignores a stale Large-v3 cache after the optional model is removed', async () => {
    writeFileSync(cache, JSON.stringify(transcript(LARGE_EXPORT_LABEL)))
    expect(await exportTranscript('film.mp4', cache, 'Captions')).toBeNull()
    expect(probe).not.toHaveBeenCalled()
  })

  it('reuses no-audio caches and rebuilds corrupt JSON rather than failing the export', async () => {
    installed()
    writeFileSync(cache, JSON.stringify(transcript('no audio track')))
    expect(await exportTranscript('film.mp4', cache, 'Captions')).toEqual(transcript('no audio track'))
    expect(probe).not.toHaveBeenCalled()
    writeFileSync(cache, '{broken JSON')
    expect((await exportTranscript('film.mp4', cache, 'Captions'))?.model).toBe('no audio track')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(JSON.parse(readFileSync(cache, 'utf8')).model).toBe('no audio track')
  })

  it('never overwrites custom editing engine settings when using the export upgrade', async () => {
    installed()
    const model = join(dir, 'ggml-custom.bin')
    writeFileSync(model, 'custom model')
    setConfig({ whisper: { mode: 'custom', engine: 'system', binary: process.execPath, model } })
    await exportTranscript('film.mp4', cache, 'Captions')
    expect(await resolveEngine()).toMatchObject({ engine: 'system', binary: process.execPath, model })
  })

  it.each([new Response('Unavailable', { status: 503 }), new Response(null)])('rejects failed or bodyless model downloads without installing', async response => {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    await expect(Tools.install('whisper-large-v3')).rejects.toThrow(/Download failed/)
    expect(Tools.isInstalled('whisper-large-v3')).toBe(false)
    expect(existsSync(`${Tools.whisperLargeModelPath()}.part`)).toBe(false)
  })

  it('coalesces concurrent installs, reports streaming progress, and allows retry after failure', async () => {
    const fetch = vi.fn(async () => new Response('fixture', { headers: { 'content-length': '7' } }))
    vi.stubGlobal('fetch', fetch)
    const progress: (number | null)[] = []
    const stop = onJobs(jobs => {
      const job = jobs.findLast(j => j.kind === 'install' && j.status === 'running')
      if (job?.detail?.startsWith('Downloading Whisper Large-v3')) progress.push(job.progress)
    })
    try {
      const first = Tools.install('whisper-large-v3')
      const second = Tools.install('whisper-large-v3')
      expect(second).toBe(first)
      const result = await Promise.allSettled([first, second])
      expect(result.map(r => r.status)).toEqual(['rejected', 'rejected'])
      expect(fetch).toHaveBeenCalledTimes(1)
      expect(progress).toContain(1)
      expect(listJobs().findLast(j => j.kind === 'install')).toMatchObject({ status: 'failed', detail: expect.stringContaining('Checksum mismatch') })
      await expect(Tools.install('whisper-large-v3')).rejects.toThrow(/Checksum mismatch/)
      expect(fetch).toHaveBeenCalledTimes(2)
    } finally { stop() }
  })

  it('does not fetch again for an installed optional model and lists its status separately from Base', async () => {
    installed()
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    expect(Tools.plan('whisper-large-v3')).toEqual([])
    await Tools.install('whisper-large-v3')
    expect(fetch).not.toHaveBeenCalled()
    expect(await Tools.listTools()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'whisper-large-v3', installed: true, sizeMB: 3096 }),
      expect.objectContaining({ id: 'whisper-model', installed: false }),
    ]))
  })
})
