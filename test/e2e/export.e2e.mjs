// Export through the real UI: 9:16 with an .srt from the transcript, and 16:9 with captions in the picture.
// Recorded speech and its reference transcript keep this independent of local speech engines.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary, loadRecordedTranscript, recordedTranscriptEnv, speechFixture } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'manul-export-'))
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-i', speechFixture,
  '-t', '5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'talk.mp4')])
const words = JSON.parse(readFileSync(speechFixture.replace(/\.flac$/, '.reference.json'), 'utf8')).words.filter(w => w.e <= 5)
const probe = f => JSON.parse(execFileSync(bundledBinary('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', f], { encoding: 'utf8' })).streams.find(s => s.codec_type === 'video')

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: recordedTranscriptEnv(tmp) })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => [f]) }, join(tmp, 'talk.mp4'))
  await win.click('[data-tour="import"]')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  await loadRecordedTranscript(win, words)

  const exportAs = async (label, captions, file) => {
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }) }, join(tmp, file))
    await win.getByRole('button', { name: 'Export', exact: true }).click()
    const dialog = win.getByRole('dialog')
    await dialog.getByRole('button', { name: new RegExp(label) }).click()
    await dialog.getByRole('button', { name: captions, exact: true }).click()
    await dialog.getByRole('button', { name: 'Export', exact: true }).click()
    await dialog.getByRole('button', { name: 'Show', exact: true }).waitFor({ timeout: 120000 }).catch(async e => {
      throw new Error(`${e.message}\nExport dialog: ${await dialog.innerText()}`)
    })
    await dialog.locator('button:has(svg.lucide-x)').click()
    await dialog.waitFor({ state: 'detached' })
  }

  await exportAs('9:16', 'Separate .srt', 'vertical.mp4')
  const v = probe(join(tmp, 'vertical.mp4'))
  assert.equal(v.width, 1080); assert.equal(v.height, 1920)
  const srt = readFileSync(join(tmp, 'vertical.srt'), 'utf8')
  assert.match(srt, /^1\n00:00:0\d,\d{3} --> 00:00:0\d,\d{3}\n/)
  assert.match(srt.toLowerCase(), /welcome back/)

  await exportAs('16:9', 'In the picture', 'landscape.mp4')
  const l = probe(join(tmp, 'landscape.mp4'))
  assert.equal(l.width, 1920); assert.equal(l.height, 1080)
  assert.ok(!existsSync(join(tmp, 'landscape.srt')), 'burned captions leave no .srt behind')
  const frame = file => execFileSync(bundledBinary('ffmpeg'), ['-loglevel', 'error', '-ss', '2.7', '-i', file, '-frames:v', '1',
    '-vf', 'crop=iw:ih/4:0:ih*3/4,scale=320:45', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'])
  execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-i', join(tmp, 'talk.mp4'), '-vf', 'scale=1920:1080',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-an', join(tmp, 'no-captions.mp4')])
  const burned = frame(join(tmp, 'landscape.mp4')), plain = frame(join(tmp, 'no-captions.mp4'))
  assert.equal(burned.length, plain.length)
  assert.ok(burned.reduce((sum, value, i) => sum + Math.abs(value - plain[i]), 0) / burned.length > 1, 'burned captions change the lower picture')
  console.log('export e2e: ok')
} finally {
  await app.close()
}
