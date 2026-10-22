import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/media', () => ({
  WHISPER_CLI: process.execPath,
  FFMPEG: process.execPath,
  probe: vi.fn(async () => ({ hasAudio: false })),
}))

process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), 'manul-export-tools-'))
const Tools = await import('../src/main/tools')
const { exportTranscript, LARGE_EXPORT_LABEL, resolveEngine } = await import('../src/main/whisper')
const { probe } = await import('../src/main/media')
const { setConfig } = await import('../src/main/config')
const dir = mkdtempSync(join(tmpdir(), 'manul-export-transcripts-'))
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
})
