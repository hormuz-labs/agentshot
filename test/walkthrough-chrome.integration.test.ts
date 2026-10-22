// A take in a separate Chromium, reached the way Manul reaches the user's Chrome: the DevToolsActivePort file that
// Chrome's remote debugging writes, then the tab carrying the take's mark. Uses a throwaway Chromium with its own
// profile (Playwright's, or MANUL_CHROMIUM); skipped when there is none.
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromeCdp, parsePortFile, TAKE_ATTR } from '../src/main/cdp'
import { probe } from '../src/main/media'
import { Recorder, ScreencastCapture } from '../src/main/take'

function chromium(): string | null {
  if (process.env.MANUL_CHROMIUM) return process.env.MANUL_CHROMIUM
  const cache = join(homedir(), 'Library/Caches/ms-playwright')
  if (!existsSync(cache)) return null
  for (const d of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    const app = join(cache, d, 'chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing')
    if (existsSync(app)) return app
  }
  return null
}
const bin = chromium()

describe.skipIf(!bin)('a walkthrough take in Chrome, over its remote debugging', () => {
  let chrome: ChildProcess, site: Server, profile: string
  beforeAll(async () => {
    site = createServer((_q, r) => {
      r.setHeader('content-type', 'text/html')
      r.end(`<!doctype html><script>document.documentElement.setAttribute('${TAKE_ATTR}', 'nonce-1')</script>
<style>body{margin:40px;font:18px sans-serif}li{padding:20px 0}</style><input id=q style="font:inherit"> <button id=b onclick="this.textContent='Done'">Go</button>
<ul>${Array.from({ length: 80 }, (_, i) => `<li>Row ${i}</li>`).join('')}</ul>`)
    }).listen(0, '127.0.0.1')
    await new Promise(r => site.once('listening', r))
    profile = mkdtempSync(join(tmpdir(), 'manul-chrome-'))
    chrome = spawn(bin!, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1400,900',
      `http://127.0.0.1:${(site.address() as { port: number }).port}/`], { stdio: 'ignore' })
    for (let i = 0; i < 100 && !existsSync(join(profile, 'DevToolsActivePort')); i++) await new Promise(r => setTimeout(r, 100))
  })
  afterAll(async () => {
    if (chrome && chrome.exitCode == null) await new Promise(r => { chrome.once('exit', r); chrome.kill() })
    site?.close()
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
  })

  it('finds the marked tab and records clicks, typing and a scroll', async () => {
    const file = join(profile, 'DevToolsActivePort')
    expect(existsSync(file)).toBe(true)
    let cdp
    for (let i = 0; i < 60 && !cdp; i++) { // a cold Chromium may still be loading the page and its mark
      try { cdp = await chromeCdp('nonce-1', { files: [file], timeoutMs: 5000 }) } catch { await new Promise(r => setTimeout(r, 500)) }
    }
    expect(cdp).toBeTruthy()
    await expect(chromeCdp('not-there', { files: [file], timeoutMs: 5000 })).rejects.toThrow()
    const dir = mkdtempSync(join(tmpdir(), 'manul-chrome-take-'))
    try {
      const r = new Recorder({ capture: new ScreencastCapture(cdp!), dir, rel: 'walkthroughs/c1', id: 'c1', browser: 'chrome' })
      await r.start()
      r.step('Search')
      const at = async (sel: string) => (await cdp!.send('Runtime.evaluate', { expression: `(() => { const b = document.querySelector('${sel}').getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })()`, returnByValue: true })).result.value
      const [qx, qy] = await at('#q')
      for (const type of ['mousePressed', 'mouseReleased']) await cdp!.send('Input.dispatchMouseEvent', { type, x: qx, y: qy, button: 'left', clickCount: 1 })
      await r.type('manul', { cps: 20 })
      r.step('Go')
      const [bx, by] = await at('#b')
      for (const type of ['mousePressed', 'mouseReleased']) await cdp!.send('Input.dispatchMouseEvent', { type, x: bx, y: by, button: 'left', clickCount: 1 })
      await r.scroll(800)
      await new Promise(res => setTimeout(res, 300))
      const take = await r.stop()
      const kinds = new Set(take.events.map(e => e.k))
      for (const k of ['down', 'click', 'input', 'wheel', 'scroll']) expect(kinds, k).toContain(k)
      expect(take.steps.map(s => s.title)).toEqual(['Search', 'Go'])
      expect(take.browser).toBe('chrome')
      const info = await probe(join(dir, 'take.mp4'))
      expect([info.width, info.height]).toEqual([2560, 1440])
      expect(info.duration).toBeGreaterThan(1)
      expect(parsePortFile('9222\n/devtools/browser/abc')).toEqual({ port: 9222, path: '/devtools/browser/abc' })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 90_000)
})
