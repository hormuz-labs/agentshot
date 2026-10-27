// The packaged app (dist/), not the dev build: everything that moves into the bundle must still be found —
// ffmpeg/ffprobe in Resources/bin, the clip runtime and fonts in Resources/lib, bundled skills, captions.
// Run: npm run package:dir && node test/e2e/packaged.e2e.mjs
import { _electron as electron } from 'playwright-core'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const exe = process.env.MANUL_PACKAGED_EXE || (process.platform === 'darwin'
  ? join(root, 'dist', `mac-${process.arch}`, 'AgentShot.app', 'Contents', 'MacOS', 'AgentShot')
  : process.platform === 'win32' ? join(root, 'dist', 'win-unpacked', 'AgentShot.exe')
  : join(root, 'dist', process.arch === 'arm64' ? 'linux-arm64-unpacked' : 'linux-unpacked', 'manul'))
assert.ok(existsSync(exe), `Packaged executable missing: ${exe}; run npm run package:dir`)
const suffix = process.platform === 'win32' ? '.exe' : ''
const bundle = process.platform === 'darwin' ? join(exe, '..', '..', 'Resources') : join(exe, '..', 'resources')
const BIN = join(bundle, 'bin')
for (const tool of ['ffmpeg', 'ffprobe', 'whisper-cli', 'bsk']) assert.ok(existsSync(join(BIN, tool + suffix)), `Bundled ${tool} missing`)
if (process.platform === 'win32') assert.ok(existsSync(join(BIN, 'vcruntime140.dll')), 'Bundled BrowserSkill VC runtime missing')
for (const tool of ['whisper-cli', 'bsk']) execFileSync(join(BIN, tool + suffix), ['--version'], { timeout: 30000, windowsHide: true })
for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'bsk-ext/manifest.json', 'lib/fonts/Inter-Regular.ttf'])
  assert.ok(existsSync(join(bundle, file)), `Bundled resource missing: ${file}`)
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-pkg-'))
execFileSync(join(BIN, 'ffmpeg' + suffix), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3', '-f', 'lavfi', '-i', 'sine=duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(tmp, 'src.mp4')])

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${join(tmp, 'ud')}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'projects'), MANUL_UPDATE_CHECK_ONLY: '1' } })
try {
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true)
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  // bundled tools answer from Resources/bin
  const tools = await win.evaluate(() => window.agentshot.tools.bundled())
  assert.deepEqual(tools.map(t => t.name).sort(), ['ffmpeg', 'ffprobe'])
  for (const t of tools) { assert.ok(t.ok, `${t.name} works`); assert.match(t.path.replaceAll('\\', '/'), /Contents\/Resources\/bin\/|resources\/bin\//) }
  // import (ffprobe + thumbnail)
  const p = await win.evaluate(f => window.agentshot.project.create(f), join(tmp, 'src.mp4'))
  assert.equal(p.media['media/src.mp4'].width, 640)
  // a motion clip renders with the bundled runtime and GSAP
  cpSync(join(root, 'test', 'fixtures', 'clips', 'slide'), join(p.dir, 'clips', 'slide'), { recursive: true })
  const r = await win.evaluate(dir => window.agentshot.clips.render(dir, 'slide'), p.dir)
  assert.equal(r.frames, 60)
  // bundled skills are listed
  const skills = await win.evaluate(() => window.agentshot.skills.state())
  assert.ok(skills.skills.some(k => k.id === 'motion-design' && /Contents\/Resources\/skills\/|resources\/skills\//.test(k.path.replaceAll('\\', '/'))), 'bundled skills found, read from the app')
  // export with the bundled fonts (captions .srt, even if empty without speech)
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: f }) }, join(tmp, 'out.mp4'))
  const ex = await win.evaluate(dir => window.agentshot.export.run(dir, { preset: 'square', captions: 'none' }), p.dir)
  assert.ok(existsSync(ex.file))
  // the updater is on for this kind of install and checking never crashes the app (the feed may not exist yet)
  const up = await win.evaluate(() => window.agentshot.updates.state())
  if (process.platform === 'darwin' || process.platform === 'win32') assert.equal(up.mode, 'self')
  const after = await win.evaluate(() => window.agentshot.updates.check())
  assert.ok((up.mode === 'self' ? ['none', 'error', 'downloading', 'ready', 'checking'] : ['idle']).includes(after.status), after.status)
  console.log('update check:', after.status, after.error ? after.error.split('\n')[0].slice(0, 100) : '')
  console.log('packaged e2e: ok')
} finally {
  await app.close()
}
