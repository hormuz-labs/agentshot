import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { speakerDetectionReady } from '../src/main/speakers'

it('checks the native runner and both models before attempting background speaker detection', () => {
  const dir = mkdtempSync(join(tmpdir(), 'manul-speaker-ready-'))
  try {
    const binary = join(dir, 'manul-speakers'), models = join(dir, 'models')
    mkdirSync(models)
    expect(speakerDetectionReady(binary, models)).toBe(false)
    writeFileSync(binary, 'runner')
    writeFileSync(join(models, 'speaker-segmentation.onnx'), 'model')
    expect(speakerDetectionReady(binary, models)).toBe(false)
    writeFileSync(join(models, 'speaker-embedding.onnx'), 'model')
    expect(speakerDetectionReady(binary, models)).toBe(true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
