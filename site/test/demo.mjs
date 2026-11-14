// Clicks through the hero demo in real Chrome and screenshots each stage: node test/demo.mjs [url] [outdir]
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://localhost:4321/'
const out = process.argv[3] || '/tmp/manul-site-shots'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const { mkdirSync } = await import('node:fs'); mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required'] })
const errors = []
for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 2, isMobile: name === 'phone', hasTouch: name === 'phone' })
  page.on('pageerror', e => errors.push(`${name}: ${e.message}`))
  page.on('console', m => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`) })
  await page.goto(url, { waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${out}/${name}-0-fold.png` })
  const demo = page.locator('#demo')
  await demo.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -20))
  await page.screenshot({ path: `${out}/${name}-1-demo.png` })
  // 1: punch in, drawing the box by hand
  await page.click('.ask[data-edit=zoom]')
  await page.waitForSelector('#hint:not([hidden])', { timeout: 8000 })
  const b = await page.locator('#stage').boundingBox()
  await page.mouse.move(b.x + b.width * 0.22, b.y + b.height * 0.24)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width * 0.41, b.y + b.height * 0.58, { steps: 8 })
  await page.screenshot({ path: `${out}/${name}-2-box.png` })
  await page.mouse.up()
  await page.waitForSelector('#decide:not([hidden])', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/${name}-3-compare.png` })
  // the demo wears the app's own look (dark panels, caption yellow), and its Before / After labels are plain:
  // the page's .tag would put braces around them
  const look = await page.evaluate(() => {
    const css = (sel, pseudo) => getComputedStyle(document.querySelector(sel), pseudo)
    const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (r * 299 + g * 587 + b * 114) / 1000 }
    return {
      panel: lum(css('#demo .chat').backgroundColor), text: lum(css('#demo .chat').color),
      exportBg: css('#demo .export').backgroundColor, keepBg: css('#keep').backgroundColor,
      braces: [...document.querySelectorAll('#split span')].map(s => getComputedStyle(s, '::before').content).filter(c => c !== 'none'),
    }
  })
  if (look.panel > 60 || look.text < 200) errors.push(`${name}: the demo isn't dark like the app (panel ${look.panel}, text ${look.text})`)
  for (const k of ['exportBg', 'keepBg']) if (look[k] !== 'rgb(255, 224, 26)') errors.push(`${name}: ${k} is ${look[k]}, not the app's yellow`)
  if (look.braces.length) errors.push(`${name}: Before / After labels carry the page's braces (${look.braces.join(' ')})`)
  await page.click('#keep')
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${out}/${name}-4-kept.png` })
  // 2: short, then send it back
  await page.click('.ask[data-edit=short]')
  await page.waitForSelector('#decide:not([hidden])', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/${name}-5-short.png` })
  await page.click('#back')
  // 3: cinema
  await page.click('.ask[data-edit=cinema]')
  await page.waitForSelector('#decide:not([hidden])', { timeout: 15000 })
  await page.waitForTimeout(600)
  await page.screenshot({ path: `${out}/${name}-6-cinema.png` })
  await page.screenshot({ path: `${out}/${name}-full.png`, fullPage: true, timeout: 120000 })
  await page.close()
}
await browser.close()
console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no errors')
