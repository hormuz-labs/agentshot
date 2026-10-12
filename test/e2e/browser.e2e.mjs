// Manul's own browser, driven by bsk: the bundled extension connects to Manul's private daemon (own home, own port),
// the agent's bsk session opens a tab in the Browser panel, reads and clicks a page, and the user's own Chrome bsk
// never sees Manul. Settings → Browser switches the agent to the user's Chrome and back.
import { _electron as electron } from 'playwright-core'
import { dismissOnboarding, dismissSettingsOnboarding } from './onboarding.mjs'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = join(import.meta.dirname, '..', '..')
const bin = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
const tmp = mkdtempSync('/tmp/mb-') // short: the daemon's socket path must stay under macOS's limit
const ud = join(tmp, 'ud'), home = join(ud, 'bsk')
const bsk = async (...args) => {
  const { stdout } = await run(join(bin, 'bsk'), [...args, '--json'], { env: { ...process.env, BSK_HOME: home, BSK_AUTO_START: '0' }, timeout: 60_000 })
  try { return JSON.parse(stdout) } catch { return stdout }
}
const until = async (what, fn, ms = 20_000) => {
  const end = Date.now() + ms
  for (;;) {
    try { const v = await fn(); if (v) return v } catch { /* not yet */ }
    if (Date.now() > end) throw new Error(`timed out: ${what}`)
    await new Promise(r => setTimeout(r, 250))
  }
}

// a page for the agent to read and click
const page = `<!doctype html><title>Manul test page</title><h1>Hello from the test page</h1>
<button onclick="document.querySelector('h1').textContent='Clicked by the agent'">Press me</button>`
const srv = createServer((_q, r) => { r.setHeader('content-type', 'text/html'); r.end(page) }).listen(0, '127.0.0.1')
await new Promise(r => srv.once('listening', r))
const url = `http://127.0.0.1:${srv.address().port}/`

execFileSync(join(bin, 'ffmpeg'), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=gray:s=320x240:d=3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', join(tmp, 'film.mp4')])
const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${ud}`], env: { ...process.env, MANUL_PROJECTS: join(tmp, 'p') } })
let session
try {
  const win = await app.firstWindow()
  await win.waitForSelector('text=What are we making?')
  await dismissOnboarding(win)
  await app.evaluate(({ ipcMain }, f) => { ipcMain.removeHandler('project:pick'); ipcMain.handle('project:pick', () => f) }, join(tmp, 'film.mp4'))
  await win.click('text=Drop a video here')
  await win.locator('button:has(svg.lucide-arrow-up)').click()
  await win.waitForSelector('[data-project-title="film"]')

  // 1. the private daemon: Manul's home, not bsk's default port, and the extension inside Manul connected to it
  const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'))
  assert.notEqual(info.ws_port, 52800, "Manul's daemon is not on bsk's default port")
  const browsers = await until('Manul browser connects', async () => { const b = await bsk('browsers'); return b.length ? b : null })
  assert.equal(browsers.length, 1, 'exactly one browser on the private daemon')
  assert.equal(browsers[0].label, 'Manul')

  // 2. the user's own bsk (if it is running) never sees Manul
  if (existsSync(join(homedir(), '.bsk', 'daemon.json'))) {
    const user = await run(join(bin, 'bsk'), ['browsers', '--json'], { env: { ...process.env, BSK_HOME: join(homedir(), '.bsk'), BSK_AUTO_START: '0', BSK_BROWSER_WAIT_MS: '0' }, timeout: 10_000 })
      .then(r => JSON.parse(r.stdout)).catch(() => [])
    assert.ok(!user.some(b => b.label === 'Manul'), "the user's own bsk daemon does not list Manul")
    console.log(`  user's own bsk lists ${user.length} browser(s), none of them Manul`)
  } else console.log("  (no user bsk daemon running here: skipped the cross-check)")

  // 3. an agent session opens a tab in the Browser panel, reads the page and clicks
  session = (await bsk('session', 'start', '--name', 'e2e')).session_id
  assert.ok(session, 'session started')
  await win.waitForSelector('[data-testid="browser-panel"]:not(.hidden)', { timeout: 10_000 })
  await bsk('navigate', url, '--session', session)
  const seen = (await bsk('observe', '--session', session)).text
  assert.match(seen, /Hello from the test page/)
  const ref = /(@e\d+) button "Press me"/.exec(seen)
  assert.ok(ref, 'the button has a ref')
  await bsk('click', ref[1], '--session', session)
  assert.match((await bsk('observe', '--session', session)).text, /Clicked by the agent/)
  await win.waitForSelector('[data-testid="browser-panel"] [data-agent-tab]', { timeout: 5000 }) // the agent's tab, marked
  const shown = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible()).contentView.children.filter(v => v.getVisible()).length)
  assert.equal(await shown(), 1, 'the page is on screen')
  // no duplicate tabs: the address bar is the current tab; only the other tabs get pills
  assert.match(await win.locator('[data-testid="browser-address"]').innerText(), /Manul test page/)
  assert.equal(await win.locator('[data-testid="browser-tab"]').count(), 0, 'one tab: no pills')
  await win.evaluate(() => window.manul.browser.newTab())
  await until('second tab', async () => (await win.locator('[data-testid="browser-tab"]').count()) === 1, 10_000)
  assert.match(await win.locator('[data-testid="browser-tab"]').innerText(), /Manul test page/, 'the other tab is the pill')
  await win.locator('[data-testid="browser-tab"]').click() // back to the agent's tab
  await until('back on one pill for the new tab', async () => /Manul test page/.test(await win.locator('[data-testid="browser-address"]').innerText().catch(() => '')), 10_000)
  await win.evaluate(async () => { const st = await window.manul.browser.state(); for (const t of st.tabs) if (t.id !== st.active) await window.manul.browser.close(t.id) })
  await until('pill gone', async () => (await win.locator('[data-testid="browser-tab"]').count()) === 0, 5000)
  await win.screenshot({ path: join(tmp, 'browser.png') })
  // the page itself is a native view over the panel: capture it to prove it draws the clicked page
  const png = await app.evaluate(async ({ BrowserWindow }) => {
    const v = BrowserWindow.getAllWindows().find(w => w.isVisible()).contentView.children.find(c => c.getVisible())
    return (await v.webContents.capturePage()).toPNG().toString('base64')
  })
  writeFileSync(join(tmp, 'page.png'), Buffer.from(png, 'base64'))
  assert.ok(png.length > 2000, 'the page view rendered')
  console.log(`  screenshots: ${join(tmp, 'browser.png')}, ${join(tmp, 'page.png')}`)

  // 4. a dialog over the panel hides the native page; closing it brings the page back
  await app.evaluate(({ Menu }) => { const f = it => { for (const i of it) { if (i.label === 'Settings…') return i; const s = i.submenu && f(i.submenu.items); if (s) return s } }; f(Menu.getApplicationMenu().items).click() })
  await win.waitForSelector('text=Settings')
  await dismissSettingsOnboarding(win)
  await until('page hidden under the dialog', async () => (await shown()) === 0, 3000)

  // 5. Settings → Browser: switch the agent to the user's Chrome and back
  await win.click('nav >> text=Browser')
  await win.waitForSelector('[data-testid="browser-mode-manul"][aria-checked="true"]')
  await win.click('[data-testid="browser-mode-chrome"]')
  await win.waitForSelector('[data-testid="browser-mode-chrome"][aria-checked="true"]')
  await win.waitForSelector('[data-testid="chrome-bsk-status"]')
  assert.equal(JSON.parse(readFileSync(join(ud, 'config.json'), 'utf8')).browser.mode, 'chrome')
  await win.click('[data-testid="browser-mode-manul"]')
  await win.waitForSelector('[data-testid="browser-mode-manul"][aria-checked="true"]')
  assert.equal(JSON.parse(readFileSync(join(ud, 'config.json'), 'utf8')).browser.mode, 'manul')
  await win.keyboard.press('Escape')
  await until('page back after the dialog', async () => (await shown()) === 1, 3000)

  await bsk('session', 'stop', session)
  session = null
} finally {
  if (session) await bsk('session', 'stop', session).catch(() => {})
  const pid = (() => { try { return JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8')).pid } catch { return null } })()
  await app.close()
  srv.close()
  if (pid) {
    await until('daemon stops with the app', async () => { try { process.kill(pid, 0); return false } catch { return true } }, 8000)
  }
}
console.log('browser e2e: ok')
