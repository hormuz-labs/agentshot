// Light and dark, in real Chrome: node test/theme.mjs [url]
//   the page follows the system until the visitor picks one with the header's button; the pick survives a reload,
//   the browser's bar colour follows, and a browser that refuses storage still gets a working page.
import { chromium } from 'playwright-core'
const base = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const browser = await chromium.launch({ executablePath: CHROME })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }

// any computed colour (rgb, oklab from color-mix…) as rgb(), by painting one pixel of it
const RGB = `window.__rgb = c => { const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 1, 1); const [r, g, b] = x.getImageData(0, 0, 1, 1).data; return \`rgb(\${r}, \${g}, \${b})\` }`
const state = page => page.evaluate(() => ({
  theme: document.documentElement.dataset.theme,
  bg: __rgb(getComputedStyle(document.body).backgroundColor),
  ink: __rgb(getComputedStyle(document.body).color),
  bar: document.querySelector('meta[name="theme-color"]').content,
  label: document.querySelector('[data-theme-toggle]').getAttribute('aria-label'),
  icon: [...document.querySelectorAll('[data-theme-toggle] svg')].filter(s => getComputedStyle(s).display !== 'none').map(s => s.getAttribute('class')).join(),
}))
// relative luminance contrast of two rgb() strings
const contrast = (a, b) => {
  const lum = c => { const [r, g, bl] = c.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4 }); return .2126 * r + .7152 * g + .0722 * bl }
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + .05) / (y + .05)
}
const open = async (scheme, opts = {}) => {
  const ctx = await browser.newContext({ colorScheme: scheme, reducedMotion: 'reduce', viewport: { width: 1280, height: 800 }, ...opts })
  await ctx.addInitScript(RGB)
  if (opts.blockStorage) await ctx.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError') } }))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`page error (${scheme}): ${e.message}`))
  await page.goto(base, { waitUntil: 'networkidle' })
  return { ctx, page }
}

// 1. with no choice made, the page takes the system's theme, and each reads well
for (const scheme of ['light', 'dark']) {
  const { ctx, page } = await open(scheme)
  const s = await state(page)
  check(s.theme === scheme, `a ${scheme} system got the ${s.theme} theme`)
  check(s.bar === (scheme === 'light' ? '#f6f3ec' : '#0d0c11'), `a ${scheme} system got the browser bar colour ${s.bar}`)
  check(contrast(s.bg, s.ink) >= 12, `body text in ${scheme} has contrast ${contrast(s.bg, s.ink).toFixed(1)}, expected 12 or more`)
  check(s.icon === (scheme === 'light' ? 'to-dark' : 'to-light'), `in ${scheme} the button shows ${s.icon}`)
  // accents used as words stay readable: the facts' figures and the job tab's label
  const figs = await page.$$eval('.facts b', bs => bs.map(b => __rgb(getComputedStyle(b).color)))
  for (const f of figs) check(contrast(s.bg, f) >= 3, `a figure in ${scheme} has contrast ${contrast(s.bg, f).toFixed(1)} on the page, expected 3 or more`)
  // in light, "Get cuts." becomes black on caption yellow instead of yellow on paper
  const cuts = await page.$eval('.cuts', e => ({ bg: __rgb(getComputedStyle(e).backgroundColor), ink: __rgb(getComputedStyle(e).color) }))
  if (scheme === 'light') check(contrast(cuts.bg, cuts.ink) >= 7, 'in light, the hero\'s "Get cuts." is not readable on its caption')
  else check(contrast(s.bg, cuts.ink) >= 7, 'in dark, the hero\'s "Get cuts." is not readable on the page')
  await ctx.close()
}

// 2. the button switches, the pick survives a reload, and a later change of system theme leaves it alone
{
  const { ctx, page } = await open('dark')
  await page.click('[data-theme-toggle]')
  let s = await state(page)
  check(s.theme === 'light' && s.bar === '#f6f3ec', `the button did not switch to light (got ${s.theme}, ${s.bar})`)
  check(s.label === 'Switch to dark theme', `after switching to light the button says "${s.label}"`)
  check(s.bg !== 'rgb(13, 12, 17)', 'the page background did not change with the theme')
  await page.reload({ waitUntil: 'networkidle' })
  check((await state(page)).theme === 'light', 'the pick of light did not survive a reload')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(100)
  check((await state(page)).theme === 'light', 'a change of system theme overrode the visitor\'s pick')
  await page.click('[data-theme-toggle]')
  check((await state(page)).theme === 'dark', 'the button did not switch back to dark')
  await ctx.close()
}

// 3. with no pick, a change of system theme is followed while the page is open
{
  const { ctx, page } = await open('dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 2000 })
    .catch(() => errors.push('with no pick, the page did not follow the system to light'))
  await ctx.close()
}

// 4. a browser that refuses storage still follows the system and the button still works for the visit
{
  const { ctx, page } = await open('light', { blockStorage: true })
  check((await state(page)).theme === 'light', 'with storage refused the page did not follow the system')
  await page.click('[data-theme-toggle]')
  check((await state(page)).theme === 'dark', 'with storage refused the button did not switch')
  await ctx.close()
}

// 5. every page carries the button and the theme (the shared layout)
for (const path of ['compare/', 'pricing/', 'privacy/']) {
  const { ctx, page } = await open('light')
  await page.goto(new URL(path, base).href, { waitUntil: 'networkidle' })
  const s = await state(page)
  check(s.theme === 'light' && s.bg !== 'rgb(13, 12, 17)', `/${path} did not take the light theme`)
  await ctx.close()
}

// 6. the button fits the header on the smallest phones: nothing overlaps and nothing scrolls sideways
for (const width of [320, 375]) {
  const { ctx, page } = await open('light', { viewport: { width, height: 760 }, isMobile: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
  const fits = await page.evaluate(() => {
    const r = [document.querySelector('.top .brand'), ...document.querySelectorAll('.top nav a'), document.querySelector('[data-theme-toggle]')].filter(e => e.offsetParent).map(e => e.getBoundingClientRect())
    return document.documentElement.scrollWidth <= innerWidth && r.every((x, i) => i === 0 || r[i - 1].right <= x.left + .5)
  })
  check(fits, `at ${width}px the header's items overlap or the page scrolls sideways`)
  await ctx.close()
}

// 7. without script there is nothing to switch, so there is no button
{
  const { ctx, page } = await open('light', { javaScriptEnabled: false })
  check(!(await page.isVisible('[data-theme-toggle]')), 'without script the theme button still shows')
  await ctx.close()
}

await browser.close()
if (errors.length) { console.error(`theme: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`); process.exit(1) }
console.log('theme: ok')
