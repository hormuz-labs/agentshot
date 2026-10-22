// Native CLI regression: real model, UTF-8 argv/model loading, narrow input/output APIs, no runtime imports.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, createReadStream, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download } from './archive.mjs'

export const MODEL = {
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
  sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
}

export async function smokeWhisperPaths({ bin = join(import.meta.dirname, '..', 'resources', 'bin', 'win32-x64'), model = process.env.MANUL_TEST_WHISPER_MODEL, allowDownload = false } = {}) {
  if (!model && !allowDownload) throw new Error('Set MANUL_TEST_WHISPER_MODEL to the pinned multilingual ggml-base.bin, or explicitly allow its download')
  const tmp = mkdtempSync(join(tmpdir(), 'manul whisper '))
  try {
    // Non-ASCII profile, app-data/model, media and output paths, with literal [] and spaces.
    const profile = join(tmp, '\u017dana \u7528\u6237 [profile]')
    const modelDir = join(profile, 'AppData', 'Roaming', 'Manul', 'tools', 'whisper-model [base]')
    const project = join(profile, 'Videos', '\u0444\u0438\u043b\u044c\u043c [edit]')
    mkdirSync(modelDir, { recursive: true })
    mkdirSync(project, { recursive: true })
    const installed = join(modelDir, 'ggml-base.bin')
    if (model) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(model)) hash.update(chunk)
      assert.equal(hash.digest('hex'), MODEL.sha256, 'Use the pinned multilingual base model, not base.en or a quantized model')
      copyFileSync(model, installed)
    } else {
      writeFileSync(installed, await download(MODEL.url, MODEL.sha256))
    }
    writeFileSync(join(modelDir, '.installed.json'), JSON.stringify({ version: 'ggml-base', at: Date.now() }))
    const input = join(project, '\u97f3\u58f0 [input].wav')
    const output = join(project, '\u017e\u00e9 [transcript]')
    execFileSync(join(bin, 'ffmpeg.exe'), ['-y', '-loglevel', 'error', '-i', join(import.meta.dirname, '..', 'test', 'fixtures', 'speech', 'narration-music.flac'),
      '-t', '14', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', input], { timeout: 30000, windowsHide: true, stdio: 'pipe' })
    execFileSync(join(bin, 'whisper-cli.exe'), ['-m', installed, '-f', input, '-of', output, '-ojf', '-osrt', '-otxt', '-ng', '-l', 'en', '-t', '4'],
      { timeout: 300000, windowsHide: true, encoding: 'utf8', stdio: 'pipe' })
    const json = JSON.parse(readFileSync(`${output}.json`, 'utf8'))
    assert.equal(json.params.model, installed, 'CLI argv must preserve the exact Unicode model path')
    assert.match(json.transcription.map(s => s.text).join(' '), /welcome back/i)
    assert.match(readFileSync(`${output}.txt`, 'utf8'), /welcome back/i)
    assert.match(readFileSync(`${output}.srt`, 'utf8'), /welcome back/i)
    console.log('whisper-cli real-model transcription: Unicode/space/[] model, input and JSON/TXT/SRT output paths ok')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32') throw new Error('Windows path acceptance requires native Windows')
  await smokeWhisperPaths({ allowDownload: process.argv.includes('--download-model') })
}
