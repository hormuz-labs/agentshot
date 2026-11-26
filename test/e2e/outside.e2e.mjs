// Settings → Keys → "Edit from Claude Code or Codex", in the real app: switch it on, copy the setup, and edit an open
// project from a real MCP client the way Claude Code or Codex would. Then switch it off and find the door shut.
// Run: npm run build && node test/e2e/outside.e2e.mjs
import { _electron as electron } from 'playwright-core'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bundledBinary } from './helpers.mjs'

const root = join(import.meta.dirname, '..', '..')
const tmp = mkdtempSync(join(tmpdir(), 'agentshot-outside-'))
// a home of its own: nothing here may touch the real Claude Code's settings
const home = join(tmp, 'home')
mkdirSync(home, { recursive: true })
// the Claude app and Codex, as far as AgentShot can tell: their settings folders, with settings of their own in them
const claudeApp = process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'Claude') : join(home, '.config', 'Claude')
mkdirSync(claudeApp, { recursive: true }); mkdirSync(join(home, '.codex'))
writeFileSync(join(claudeApp, 'claude_desktop_config.json'), '{"theme":"dark"}')
writeFileSync(join(home, '.codex', 'config.toml'), 'model = "gpt-5"\n')
const hasLauncher = existsSync(bundledBinary('agentshot-mcp'))
const video = join(tmp, 'src.mp4'), extra = join(tmp, 'tone.wav')
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video])
execFileSync(bundledBinary('ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=1', extra])

const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(tmp, 'ud')}`, ...(process.platform === 'linux' ? ['--password-store=basic'] : [])],
  env: { ...process.env, HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: '', CODEX_HOME: '', MANUL_PROJECTS: join(tmp, 'projects') } })
const said = r => r.content.filter(b => b.type === 'text').map(b => b.text).join('\n')
try {
  if (process.platform === 'linux') await app.evaluate(({ safeStorage }) => safeStorage.setUsePlainTextEncryption(true))
  const win = await app.firstWindow()
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => {})
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  const p = await win.evaluate(f => window.agentshot.project.create(f), video)

  await app.evaluate(({ Menu }) => { const f = it => { for (const i of it) { if (i.label === 'Keys…') return i; const s = i.submenu && f(i.submenu.items); if (s) return s } }; f(Menu.getApplicationMenu().items).click() })
  await dismissSettingsOnboarding(win)
  const section = win.getByRole('region', { name: 'Edit from another agent' })
  const toggle = section.getByRole('switch', { name: 'Edit from Claude Code or Codex' })
  await toggle.waitFor()
  // off until asked for: nothing is listening, and there is nothing to copy
  assert.equal(await toggle.getAttribute('aria-checked'), 'false')
  assert.deepEqual(await win.evaluate(() => window.agentshot.outside.status()).then(s => [s.enabled, s.running]), [false, false])
  assert.equal(await section.getByRole('button', { name: 'Copy setup for other agents' }).count(), 0)

  await toggle.click()
  await section.getByRole('button', { name: 'Copy setup for other agents' }).click()
  await section.getByRole('button', { name: 'Copied' }).waitFor()
  // the agents that start a launcher get an entry of their own, with no password in it
  if (hasLauncher && process.platform !== 'win32') {
    await section.getByRole('button', { name: 'Add to the Claude app' }).click()
    await section.getByRole('button', { name: 'Added to the Claude app' }).waitFor()
    await section.getByRole('button', { name: 'Add to Codex' }).click()
    await section.getByRole('button', { name: 'Added to Codex' }).waitFor()
    const entry = JSON.parse(readFileSync(join(claudeApp, 'claude_desktop_config.json'), 'utf8'))
    assert.equal(entry.theme, 'dark')
    assert.equal(entry.mcpServers.agentshot.command, bundledBinary('agentshot-mcp'))
    assert.deepEqual(entry.mcpServers.agentshot.args.slice(-2), ['--from', 'Claude'])
    const toml = readFileSync(join(home, '.codex', 'config.toml'), 'utf8')
    assert.ok(toml.startsWith('model = "gpt-5"\n') && toml.includes('[mcp_servers.agentshot]') && toml.includes('"--from", "Codex"'), toml)
    await section.getByRole('button', { name: 'Copy setup for other agents' }).click()
    await section.getByRole('button', { name: 'Copied' }).waitFor()
  }
  await win.screenshot({ path: join(tmp, 'outside.png') })
  const setup = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText())).mcpServers.agentshot
  assert.match(setup.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
  // the password reaches the clipboard, never the window
  const token = setup.headers.Authorization.replace('Bearer ', '')
  assert.ok(token.length >= 40)
  assert.ok(!JSON.stringify(await win.evaluate(() => window.agentshot.outside.status())).includes(token))
  assert.ok(!(await win.content()).includes(token))

  assert.equal((await fetch(setup.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401)
  const client = new Client({ name: 'outside-e2e', version: '1' })
  await client.connect(new StreamableHTTPClientTransport(new URL(setup.url), { requestInit: { headers: setup.headers } }))
  const names = (await client.listTools()).tools.map(t => t.name)
  for (const n of ['projects', 'add_files', 'project_state', 'edit_timeline', 'transcript', 'propose_version']) assert.ok(names.includes(n), `offers ${n}: ${names}`)
  for (const n of ['bash', 'ask_user']) assert.ok(!names.includes(n), `does not offer ${n}`)

  assert.ok(said(await client.callTool({ name: 'projects', arguments: {} })).includes(p.dir))
  const state = said(await client.callTool({ name: 'project_state', arguments: {} }))
  assert.ok(state.includes('media/src.mp4'), state)
  const piece = (await win.evaluate(dir => window.agentshot.project.open(dir), p.dir)).timeline.items[0].id

  // an edit made from outside lands in the app's own project, at once
  const cut = await client.callTool({ name: 'edit_timeline', arguments: { edits: [{ op: 'trim', id: piece, out: 2 }] } })
  assert.ok(!cut.isError, said(cut))
  const after = await win.evaluate(dir => window.agentshot.project.open(dir), p.dir)
  assert.equal(after.timeline.items[0].out, 2)

  // a file from elsewhere on the computer
  const added = await client.callTool({ name: 'add_files', arguments: { path: extra } })
  assert.ok(said(added).includes('media/tone.wav'), said(added))
  assert.ok((await win.evaluate(dir => window.agentshot.project.open(dir), p.dir)).files['media/tone.wav'])

  // what an outside agent does is told to the window, with who it says it is
  await win.evaluate(() => { window.__seen = []; window.agentshot.outside.onActivity(a => window.__seen.push(a)) })

  // notes it keeps on a file come back with the project, and find the file again
  const noted = await client.callTool({ name: 'note_file', arguments: { path: 'media/src.mp4', notes: '0:00-0:04 plain blue card, steady tone' } })
  assert.equal(said(noted), 'Noted on media/src.mp4.')
  assert.ok(said(await client.callTool({ name: 'project_state', arguments: {} })).includes('0:00-0:04 plain blue card, steady tone'))
  const found = said(await client.callTool({ name: 'search_footage', arguments: { shows: 'blue card' } }))
  assert.ok(found.includes('media/src.mp4\n  your notes: 0:00-0:04 plain blue card'), found)
  const seen = await win.evaluate(() => window.__seen)
  assert.deepEqual(seen.map(a => [a.dir, a.tool]), [[p.dir, 'note_file'], [p.dir, 'project_state'], [p.dir, 'search_footage']])
  assert.ok(seen.every(a => typeof a.who === 'string' && a.who.length > 0))

  // an export brought to the level online video plays at
  const exported = await client.callTool({ name: 'export_video', arguments: { preset: 'original', captions: 'none', loudness: 'online' } })
  assert.ok(!exported.isError && /Exported .+\.mp4/.test(said(exported)), said(exported))

  // a mistake is an answer, not a dropped connection
  const bad = await client.callTool({ name: 'edit_timeline', arguments: { edits: [{ op: 'insert', at: 0, src: 'media/nope.mp4' }] } })
  assert.equal(bad.isError, true)
  assert.match(said(bad), /media\/nope\.mp4 is not in the project/)
  const other = await client.callTool({ name: 'project_state', arguments: { project: 'someone-else' } })
  assert.match(said(other), /No open project is called "someone-else"/)
  await client.close()

  await toggle.click()
  await win.waitForFunction(() => window.agentshot.outside.status().then(s => !s.enabled && !s.running))
  await assert.rejects(fetch(setup.url, { method: 'POST', headers: { ...setup.headers, 'content-type': 'application/json' }, body: '{}' }))
  // switched off, AgentShot is gone from the other agents' settings too, and theirs are as they were
  if (hasLauncher && process.platform !== 'win32') {
    await win.waitForFunction(() => !document.querySelector('[role=switch][aria-label="Edit from Claude Code or Codex"]')?.disabled)
    assert.deepEqual(JSON.parse(readFileSync(join(claudeApp, 'claude_desktop_config.json'), 'utf8')), { theme: 'dark' })
    assert.equal(readFileSync(join(home, '.codex', 'config.toml'), 'utf8'), 'model = "gpt-5"\n')
  }
  console.log('outside e2e ok:', join(tmp, 'outside.png'))
} finally {
  await app.close()
}
