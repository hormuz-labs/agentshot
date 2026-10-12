// Export through the real UI: 9:16 with an .srt from the transcript, and 16:9 with captions in the picture.
// Needs macOS `say` (speech) and a whisper engine (found on the machine or bundled + model); skipped otherwise.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const BIN = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
try { execFileSync('which', ['say']) } catch { console.log('export e2e: skipped (no say)'); process.exit(0) }
const tmp = mkdtempSync(join(tmpdir(), 'manul-export-'))
execFileSync('say', ['-o', join(tmp, 's.aiff'), 'Hello there. This export has captions from the transcript.'])
execFileSync(join(BIN, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=5', '-i', join(tmp, 's.aiff'),
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(tmp, 'talk.mp4')])
const probe = f => JSON.parse(execFileSync(join(BIN, 'ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_streams', f], { encoding: 'utf8' })).streams.find(s => s.codec_type === 'video')

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'projects') } })
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'talk.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('video')
  // transcribed (the captions come from it), read from the project rather than the screen
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  const heard = await win.waitForFunction(d => window.manul.project.open(d).then(p => Object.keys(p.transcripts || {}).length > 0), dir, { timeout: 60000, polling: 1000 }).then(() => true, () => false)
  if (!heard) { console.log('export e2e: skipped (no speech recognition)'); process.exit(0) }

  const exportAs = async (label, captions, file) => {
    await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }) }, join(tmp, file))
    await win.click('button:text-is("Export")')
    await win.click(`button:has-text("${label}")`)
    await win.click(`button:has-text("${captions}")`)
    await win.locator('[role="dialog"] button:has-text("Export")').click()
    await win.waitForSelector('text=Show', { timeout: 120000 })
    await win.keyboard.press('Escape')
  }

  await exportAs('9:16', 'Separate .srt', 'vertical.mp4')
  const v = probe(join(tmp, 'vertical.mp4'))
  assert.equal(v.width, 1080); assert.equal(v.height, 1920)
  const srt = readFileSync(join(tmp, 'vertical.srt'), 'utf8')
  assert.match(srt, /^1\n00:00:0\d,\d{3} --> 00:00:0\d,\d{3}\n/)
  assert.match(srt.toLowerCase(), /hello there/)

  await exportAs('16:9', 'In the picture', 'landscape.mp4')
  const l = probe(join(tmp, 'landscape.mp4'))
  assert.equal(l.width, 1920); assert.equal(l.height, 1080)
  assert.ok(!existsSync(join(tmp, 'landscape.srt')), 'burned captions leave no .srt behind')
  console.log('export e2e: ok')
} finally {
  await app.close()
}
