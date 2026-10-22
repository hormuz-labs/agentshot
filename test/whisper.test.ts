import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { getConfig, setConfig } from '../src/main/config'
import { findBinaries, findModels, groupWords, resolveEngine, setWhisper } from '../src/main/whisper'

const w = (word: string, s: number, e: number) => ({ w: word, s, e })

describe('groupWords', () => {
  it('breaks after sentence punctuation', () => {
    const segs = groupWords([w('Hello', 0, 0.4), w('there.', 0.4, 0.8), w('Um', 0.9, 1.1), w('okay?', 1.1, 1.5), w('Yes', 1.6, 1.9)])
    expect(segs.map(s => s.text)).toEqual(['Hello there.', 'Um okay?', 'Yes'])
    expect(segs[1]).toMatchObject({ s: 0.9, e: 1.5 })
  })
  it('breaks on a pause longer than 0.8 s', () => {
    expect(groupWords([w('a', 0, 0.2), w('b', 0.3, 0.5), w('c', 1.4, 1.6)]).map(s => s.text)).toEqual(['a b', 'c'])
  })
  it('keeps segments to 24 words', () => {
    const words = Array.from({ length: 50 }, (_, i) => w(`w${i}`, i * 0.3, i * 0.3 + 0.2))
    expect(groupWords(words).map(s => s.words.length)).toEqual([24, 24, 2])
  })
  it('handles no words', () => expect(groupWords([])).toEqual([]))
})

describe('whisper.cpp discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'manul-whisper-'))
  const bin = join(root, 'bin', 'whisper-cli')
  const model = (dir: string, name: string, mb = 20) => {
    mkdirSync(dir, { recursive: true })
    const f = join(dir, `ggml-${name}.bin`)
    writeFileSync(f, '')
    truncateSync(f, mb * 1e6) // sparse: big enough to count as a model, costs no disk
    return f
  }
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(bin, '#!/bin/sh\n')
  const models = join(root, 'bin', 'models')
  const large = model(models, 'large-v3-turbo')
  const base = model(models, 'base.en')
  const small = model(models, 'small')
  model(models, 'for-tests-tiny')
  model(models, 'broken', 1)

  it('ranks light models first and skips test and tiny files', () => {
    expect(findModels([bin], [])).toEqual([base, small, large])
  })

  afterEach(() => setConfig({ whisper: undefined }))

  it('auto-detects, uses the best model and saves the paths', async () => {
    const active = await resolveEngine({ binaries: async () => [bin], models: near => findModels(near, []) })
    expect(active).toMatchObject({ engine: 'system', binary: bin, model: base })
    expect(getConfig().whisper).toEqual({ engine: 'system', mode: 'auto', binary: bin, model: base })
  })

  it('keeps the user\'s custom paths', async () => {
    await setWhisper({ mode: 'custom', engine: 'system', binary: bin, model: small })
    const active = await resolveEngine({ binaries: async () => [bin], models: () => [base] })
    expect(active).toMatchObject({ engine: 'system', model: small })
  })

  it('does not silently replace custom paths that disappeared', async () => {
    setConfig({ whisper: { engine: 'system', mode: 'custom', binary: join(root, 'gone'), model: small } })
    expect(await resolveEngine({ binaries: async () => [bin], models: () => [base] })).toBeNull()
  })

  it('re-detects when auto paths disappeared', async () => {
    setConfig({ whisper: { engine: 'system', mode: 'auto', binary: join(root, 'gone'), model: small } })
    expect(await resolveEngine({ binaries: async () => [bin], models: () => [base] })).toMatchObject({ binary: bin, model: base })
  })

  it('reports nothing when no engine is found or installed', async () => {
    expect(await resolveEngine({ binaries: async () => [], models: () => [] })).toBeNull()
  })

  it('"Detect again" drops custom paths and saves what it finds', async () => {
    setConfig({ whisper: { engine: 'system', mode: 'custom', binary: bin, model: small } })
    const st = await setWhisper({ mode: 'auto' }, { binaries: async () => [bin], models: () => [base] })
    expect(st.active).toMatchObject({ model: base })
    expect(getConfig().whisper).toEqual({ engine: 'system', mode: 'auto', binary: bin, model: base })
  })

  afterAll(() => rmSync(root, { recursive: true, force: true }))
})

describe('Windows whisper discovery', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

  it('finds .exe files through Path without executing which or requiring a shell', async () => {
    const root = mkdtempSync(join(tmpdir(), 'manul whisper-'))
    const bin = join(root, 'whisper-cli.exe')
    writeFileSync(bin, 'not an executable')
    mkdirSync(join(root, 'whisper-cpp.exe')) // a directory is not a binary
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.stubEnv('PATH', undefined)
    vi.stubEnv('Path', root)
    try { expect(await findBinaries()).toEqual([bin]) } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
