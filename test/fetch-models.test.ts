import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODELS, fetchOne } from '../scripts/fetch-models.mjs'

const folders: string[] = []
const fixture = () => { const dir = mkdtempSync(join(tmpdir(), 'agentshot-model-test-')); folders.push(dir); return dir }
const sha = (value: string) => createHash('sha256').update(value).digest('hex')
afterEach(() => { vi.unstubAllGlobals(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }) })

it('pins the verified upstream speaker embedding replacement', () => {
  expect(MODELS['speaker-embedding.onnx'].sha256).toBe('53cab20ba8f2eb2f6e2d89ecc18e88ef3222169b61b4419cbc13666744a4574b')
})

it('replaces an outdated cached model only after verifying the new download', async () => {
  const dir = fixture(), target = join(dir, 'model.onnx')
  writeFileSync(target, 'old model')
  const download = vi.fn(async () => new Response('new model'))
  vi.stubGlobal('fetch', download)
  const model = { url: 'https://models.test/model.onnx', sha256: sha('new model') }
  await fetchOne('model.onnx', model, dir)
  expect(readFileSync(target, 'utf8')).toBe('new model')
  await fetchOne('model.onnx', model, dir)
  expect(download).toHaveBeenCalledTimes(1)
})

it('rejects checksum drift without installing it or overwriting an existing model', async () => {
  const dir = fixture(), target = join(dir, 'model.onnx')
  vi.stubGlobal('fetch', vi.fn(async () => new Response('unexpected bytes')))
  const model = { url: 'https://models.test/model.onnx', sha256: sha('expected model') }
  await expect(fetchOne('model.onnx', model, dir)).rejects.toThrow('checksum mismatch')
  expect(existsSync(target)).toBe(false)
  writeFileSync(target, 'old model')
  await expect(fetchOne('model.onnx', model, dir)).rejects.toThrow('checksum mismatch')
  expect(readFileSync(target, 'utf8')).toBe('old model')
})
