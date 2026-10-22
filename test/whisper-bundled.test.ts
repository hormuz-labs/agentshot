// Manul's bundled whisper.cpp + the on-demand model.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), 'manul-tools-'))
const { setConfig } = await import('../src/main/config')
const { FFMPEG, WHISPER_CLI } = await import('../src/main/media')
const Tools = await import('../src/main/tools')
const { resolveEngine, toolToInstall, transcribe } = await import('../src/main/whisper')
const none = { binaries: async () => [], models: () => [] }
const built = existsSync(WHISPER_CLI)

describe.skipIf(!built)('bundled whisper-cli', () => {
  it.skipIf(process.platform !== 'darwin')('is self-contained (system libraries only)', () => {
    const libs = execFileSync('otool', ['-L', WHISPER_CLI], { encoding: 'utf8' }).split('\n').slice(1).map(l => l.trim().split(' ')[0]).filter(Boolean)
    for (const l of libs) expect(l).toMatch(/^(\/usr\/lib\/|\/System\/Library\/)/)
  })

  it('runs', () => {
    expect(execFileSync(WHISPER_CLI, ['--help'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) + '').toBeDefined()
  })
})

describe('engine choice with the bundled engine', () => {
  afterEach(async () => { setConfig({ whisper: undefined }); await Tools.remove('whisper-model').catch(() => {}) })

  it.skipIf(!built)('needs the model before the bundled engine can run', async () => {
    expect(await resolveEngine(none)).toBeNull()
    expect(Tools.isInstalled('uv')).toBe(false)
    expect(Tools.isInstalled('whisper')).toBe(false)
    expect(toolToInstall()).toBe('whisper-model')
    expect(Tools.plan('whisper-model').map(d => d.id)).toEqual(['whisper-model'])
  })

  it.skipIf(!built)('uses bundled whisper.cpp once the model is downloaded', async () => {
    mkdirSync(join(process.env.MANUL_TOOLS!, 'whisper-model'), { recursive: true })
    writeFileSync(join(process.env.MANUL_TOOLS!, 'whisper-model', '.installed.json'), '{"version":"base"}')
    expect(await resolveEngine(none)).toBeNull() // marked installed but the model file is missing: not usable
    writeFileSync(Tools.whisperModelPath(), '')
    expect(await resolveEngine(none)).toMatchObject({ engine: 'bundled', binary: WHISPER_CLI, model: Tools.whisperModelPath() })
    expect(Tools.isInstalled('uv')).toBe(false)
    expect(Tools.isInstalled('whisper')).toBe(false)
  })

  it.skipIf(!built)('still prefers whisper.cpp already on the computer', async () => {
    mkdirSync(join(process.env.MANUL_TOOLS!, 'whisper-model'), { recursive: true })
    writeFileSync(join(process.env.MANUL_TOOLS!, 'whisper-model', '.installed.json'), '{}')
    const model = join(process.env.MANUL_TOOLS!, 'x.bin')
    const sys = { binaries: async () => [WHISPER_CLI], models: () => [model] }
    writeFileSync(model, '')
    expect((await resolveEngine(sys))?.engine).toBe('system')
  })

  it('the model download is pinned and small', () => {
    const d = Tools.plan('whisper-model')[0]
    expect(d.sizeMB).toBeLessThan(200)
    expect(Tools.WHISPER_MODEL_SHA256).toMatch(/^[0-9a-f]{64}$/)
  })
})

// Real transcription with the bundled binary; borrows a ggml base model already on this machine instead of downloading.
const localModel = [process.env.MANUL_TEST_WHISPER_MODEL, join(homedir(), '.cache/whisper-cpp/ggml-base.en.bin'), join(homedir(), '.cache/whisper-cpp/ggml-base.bin')].find((p): p is string => !!p && existsSync(p))

describe.skipIf(!built || !localModel)('transcription with the bundled whisper-cli', () => {
  afterEach(async () => { setConfig({ whisper: undefined }); await Tools.remove('whisper-model') })
  it('transcribes speech on the bundled engine', async () => {
    mkdirSync(join(process.env.MANUL_TOOLS!, 'whisper-model'), { recursive: true })
    copyFileSync(localModel!, Tools.whisperModelPath())
    writeFileSync(join(process.env.MANUL_TOOLS!, 'whisper-model', '.installed.json'), '{}')
    setConfig({ whisper: { engine: 'bundled', mode: 'custom' } })
    const dir = mkdtempSync(join(tmpdir(), 'manul-stt-'))
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(import.meta.dirname, 'fixtures', 'speech', 'narration-music.flac'), '-t', '14', join(dir, 's.wav')])
    const t = await transcribe(join(dir, 's.wav'), join(dir, 's.json'), 'Transcribing s.wav')
    expect(t.model).toMatch(/bundled/)
    expect(t.segments.map(s => s.text).join(' ').toLowerCase()).toMatch(/welcome back/)
  }, 60_000)
})
