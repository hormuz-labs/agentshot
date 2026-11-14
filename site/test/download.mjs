// The download pages, in real Chrome: node test/download.mjs [url]
//   every installer link on the landing page goes to that installer's own page, the page starts the right file from
//   GitHub by itself (with scripts off too), and offers the same file as a link. GitHub is never really asked: every
//   request to it is answered here, so running this downloads nothing and adds nothing to the counts.
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ executablePath: CHROME })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }

const RELEASES = 'https://github.com/hormuz-labs/agentshot/releases/'
const V = String.raw`\d+\.\d+\.\d+`
// each page's name, and the file it must hand over
const FILES = {
  mac: /^latest\/download\/AgentShot-arm64\.dmg$/,
  'mac-intel': /^latest\/download\/AgentShot-x64\.dmg$/,
  windows: /^latest\/download\/AgentShot-windows-x64-Setup\.exe$/,
  deb: new RegExp(`^download/v(${V})/manul_\\1_amd64\\.deb$`),
  'deb-arm': new RegExp(`^download/v(${V})/manul_\\1_arm64\\.deb$`),
  appimage: new RegExp(`^download/v(${V})/manul_\\1_x86_64\\.AppImage$`),
  'appimage-arm': new RegExp(`^download/v(${V})/manul_\\1_arm64\\.AppImage$`),
}
const open = async (opts = {}) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts })
  const asked = []
  await context.route('https://github.com/**', route => {
    asked.push(route.request().url())
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename="installer"' }, body: 'not a real installer' })
  })
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(`page error: ${e.message}`))
  return { context, page, asked }
}

// 1. the landing page: every way to an installer goes through its page, none straight to GitHub
{
  const { context, page } = await open()
  await page.goto(url, { waitUntil: 'networkidle' })
  const links = await page.evaluate(() => [...document.querySelectorAll('a')].map(a => ({ href: a.getAttribute('href') || '', intel: a.dataset.intel || '', rel: a.rel })))
  const straight = links.filter(l => /github\.com\/.*\/releases\/.*download\//.test(l.href))
  check(straight.length === 0, `the landing page links straight to an installer: ${straight.map(l => l.href).join(', ')}`)
  for (const name of Object.keys(FILES)) {
    const to = links.filter(l => l.href === `/download/${name}/`)
    check(to.length > 0, `nothing on the landing page leads to /download/${name}/`)
    check(to.every(l => /nofollow/.test(l.rel)), `a link to /download/${name}/ can be followed by a crawler, which would start a download`)
  }
  const intel = links.filter(l => l.intel)
  check(intel.length >= 2 && intel.every(l => l.intel === '/download/mac-intel/' && l.href === '/download/mac/'), 'the Mac buttons do not carry the Intel build\'s page for Intel Macs')
  // and a click really lands there
  await page.locator('#get a.get[href="/download/windows/"]').click()
  await page.waitForURL('**/download/windows/', { timeout: 8000 }).catch(() => errors.push('the Windows button does not open the Windows download page'))
  await context.close()
}

// 2. each page: the right file, started by the page itself, offered again as a link, and kept out of search
for (const [name, file] of Object.entries(FILES)) {
  const { context, page, asked } = await open()
  const started = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
  const res = await page.goto(new URL(`/download/${name}/`, url).href)
  check(res?.status() === 200, `/download/${name}/ is not served`)
  const refresh = await page.locator('meta[http-equiv="refresh"]').getAttribute('content').catch(() => null)
  const target = (refresh || '').replace(/^\d+; url=/, '')
  check(/^1; url=/.test(refresh || '') && target.startsWith(RELEASES) && file.test(target.slice(RELEASES.length)), `/download/${name}/ starts ${target || 'nothing'}`)
  check(await page.locator('a[data-file]').getAttribute('href') === target, `/download/${name}/ offers a different file as its link than the one it starts`)
  check(await page.locator('meta[name="robots"]').getAttribute('content') === 'noindex', `/download/${name}/ can be listed by search engines`)
  check(await page.locator('main a[href="https://github.com/hormuz-labs/agentshot"]', { hasText: 'Star' }).count() === 1, `/download/${name}/ has no link to star the repository`)
  check(await page.locator('.steps li').count() === 3, `/download/${name}/ does not give its three steps`)
  const dl = await started
  check(dl && dl.url() === target, `/download/${name}/ did not start its download by itself`)
  if (dl) await dl.cancel().catch(() => {})
  check(asked.length === 1 && asked[0] === target, `/download/${name}/ asked GitHub for ${asked.length} things: ${asked.join(', ')}`)
  check(new URL(page.url()).pathname === `/download/${name}/`, `/download/${name}/ left its own page when the download started`)
  await context.close()
}

// 3. with scripts off the download still starts: it is the page's own refresh
{
  const { context, page } = await open({ javaScriptEnabled: false })
  const started = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
  await page.goto(new URL('/download/mac/', url).href)
  const dl = await started
  check(!!dl && /AgentShot-arm64\.dmg$/.test(dl.url()), 'with scripts off, the Mac download does not start')
  if (dl) await dl.cancel().catch(() => {})
  await context.close()
}

// 4. a phone: nothing pushes a download page sideways, long file names included
for (const name of ['mac', 'appimage-arm']) {
  const { context, page } = await open({ viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true })
  await page.goto(new URL(`/download/${name}/`, url).href)
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check(wide <= 0, `at 320 wide /download/${name}/ scrolls sideways by ${wide}px`)
  await context.close()
}

await browser.close()
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors')
process.exitCode = errors.length ? 1 : 0
