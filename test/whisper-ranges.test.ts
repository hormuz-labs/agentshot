import { EventEmitter } from 'node:events'
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ extract: vi.fn(), listen: vi.fn() }))
vi.mock('node:child_process', async original => {
  const actual = await original<typeof import('node:child_process')>()
  return { ...actual, execFile: Object.assign(vi.fn(), { [promisify.custom]: mocks.extract }), spawn: mocks.listen }
})
vi.mock('../src/main/media', () => ({ FFMPEG: 'ffmpeg', WHISPER_CLI: '', probe: async () => ({ hasAudio: true, duration: 180 }) }))
vi.mock('node:os', async original => ({ ...await original<typeof import('node:os')>(), availableParallelism: () => 12 }))
vi.mock('../src/main/wordtimes', () => ({
  dtwFlags: async () => [], dtwLag: () => null, envelope: () => [], readWav: () => ({ sr: 16000, x: [] }),
  snapSegments: (s: unknown) => s,
  whisperCppWords: () => [{ w: 'Hello.', s: 3, e: 3.5 }],
}))
const root = mkdtempSync(join(tmpdir(), 'agentshot-ranges-'))
const file = join(root, 'video.mp4'), model = join(root, 'model.bin'), cache = join(root, '.cache', 'transcript-chunks')
const saved = () => readdirSync(cache, { recursive: true }).filter(f => String(f).endsWith('.json'))
writeFileSync(file, 'original media')
writeFileSync(model, 'model')
const { setConfig } = await import('../src/main/config')
const { transcribe, transcribeRange, offsetSegments, transcriptCurrent } = await import('../src/main/whisper')
const engine = { engine: 'system' as const, binary: process.execPath, model, label: 'test' }

function setup() {
  setConfig({ whisper: { mode: 'custom', engine: 'system', binary: process.execPath, model } })
  mocks.extract.mockImplementation(async (_: string, args: string[]) => { writeFileSync(args.at(-1)!, 'wav'); return { stdout: '', stderr: '' } })
  mocks.listen.mockImplementation((_cmd: string, args: string[]) => {
    const p = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
    queueMicrotask(() => {
      writeFileSync(args[args.indexOf('-of') + 1] + '.json', JSON.stringify({ result: { language: 'en' }, transcription: [] }))
      p.emit('close', 0)
    })
    return p
  })
}
afterEach(() => { setConfig({ whisper: undefined, speechPerformance: undefined }); vi.resetAllMocks(); rmSync(cache, { recursive: true, force: true }) })
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('bounded transcription', () => {
  it('seeks before decoding, extracts only the padded excerpt, and restores source word times', async () => {
    setup()
    const t = await transcribeRange(file, cache, { t0: 60, t1: 80 }, 'Transcribing excerpt')
    const args = mocks.extract.mock.calls[0][1]
    expect(args.slice(0, 10)).toEqual(['-y', '-loglevel', 'error', '-ss', '58', '-i', file, '-t', '64', '-vn'])
    expect(t.segments[0]).toMatchObject({ s: 61, e: 61.5, words: [{ w: 'Hello.', s: 61, e: 61.5 }] })
    expect(saved()).toHaveLength(1)
  })

  it('coalesces concurrent requests and replays from disk; source changes invalidate the cache', async () => {
    setup()
    const request = () => transcribeRange(file, cache, { t0: 0, t1: 10 }, 'Transcribing excerpt')
    const [a, b] = await Promise.all([request(), request()])
    expect(a.segments).toEqual(b.segments)
    expect((await request()).segments).toEqual(a.segments)
    expect(mocks.extract).toHaveBeenCalledTimes(1)
    writeFileSync(file, 'changed and longer media')
    await request()
    expect(mocks.extract).toHaveBeenCalledTimes(2)
    expect(mocks.extract.mock.calls[0][1]).toContain('62')
  })

  it('rejects invalid bounds before starting subprocesses', async () => {
    for (const range of [{ t0: -1, t1: 2 }, { t0: 2, t1: 2 }, { t0: 0, t1: Infinity }, { t0: NaN, t1: 10 }]) {
      await expect(transcribeRange(file, cache, range, 'Invalid')).rejects.toThrow('Invalid transcription range')
    }
    expect(mocks.extract).not.toHaveBeenCalled()
  })

  it('invalidates complete transcripts after model or decoding settings change', async () => {
    setup()
    const t = await transcribe(file, join(root, 'full.json'), 'Index')
    expect(await transcriptCurrent(t, file)).toBe(true)
    setConfig({ speechPerformance: { beam: 1 } })
    expect(await transcriptCurrent(t, file)).toBe(false)
    setConfig({ speechPerformance: undefined })
    writeFileSync(model, 'replaced model')
    expect(await transcriptCurrent(t, file)).toBe(false)
  })

  it('cleans failed extraction and permits retry', async () => {
    setup()
    mocks.extract.mockImplementationOnce(async (_: string, args: string[]) => { writeFileSync(args.at(-1)!, 'partial'); throw new Error('Decode failed') })
    await expect(transcribeRange(file, cache, { t0: 0, t1: 5 }, 'Transcribing excerpt')).rejects.toThrow('Decode failed')
    expect(saved()).toEqual([])
    await transcribeRange(file, cache, { t0: 0, t1: 5 }, 'Transcribing excerpt')
    expect(saved()).toHaveLength(1)
  })

  it('does not publish text if the source changes while listening', async () => {
    setup()
    mocks.extract.mockImplementationOnce(async (_: string, args: string[]) => {
      writeFileSync(args.at(-1)!, 'wav')
      writeFileSync(file, 'changed during extraction')
      return { stdout: '', stderr: '' }
    })
    await expect(transcribeRange(file, cache, { t0: 0, t1: 5 }, 'Transcribing excerpt')).rejects.toThrow('Media changed')
    expect(saved()).toEqual([])
  })

  it('serves a short excerpt while a whole-file job is still waiting', async () => {
    setup()
    const extract = mocks.extract.getMockImplementation()!
    let release!: () => void
    let started!: () => void
    const ready = new Promise<void>(r => { started = r })
    const gate = new Promise<void>(r => { release = r })
    mocks.extract.mockImplementationOnce(async (...args) => { started(); await gate; return extract(...args) })
    const full = transcribe(file, join(root, 'full.json'), 'Transcribing whole file', undefined, engine)
    await ready
    try {
      const excerpt = await transcribeRange(file, cache, { t0: 60, t1: 80 }, 'Transcribing excerpt')
      expect(excerpt.segments).toHaveLength(1)
    } finally { release(); await full }
  })

  it('offsets without mutating the engine result', () => {
    const segments = [{ s: 1, e: 2, text: 'hi', words: [{ w: 'hi', s: 1, e: 2, p: 0.9 }] }]
    expect(offsetSegments(segments, 20)[0].words[0]).toEqual({ w: 'hi', s: 21, e: 22, p: 0.9 })
    expect(segments[0].s).toBe(1)
  })
})
