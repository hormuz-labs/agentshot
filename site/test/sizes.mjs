// Loads the page at 18 screen sizes (small phone to 2560 wide) and reports anything wider than the screen: node test/sizes.mjs [url]
import { chromium } from 'playwright-core'
const url = process.argv[2] || 'http://localhost:4321/'
const b = await chromium.launch({ executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const sizes = [[320,568],[360,740],[375,667],[390,844],[414,896],[430,932],[600,960],[768,1024],[820,1180],[1024,768],[1024,1366],[1180,820],[1280,800],[1366,768],[1440,900],[1680,1050],[1920,1080],[2560,1440]]
for (const [w, h] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 768, hasTouch: w < 1024 })
  await p.goto(url, { waitUntil: 'networkidle' })
  const r = await p.evaluate(() => {
    const W = document.documentElement.clientWidth, bad = []
    for (const el of document.querySelectorAll('body *')) {
      const s = getComputedStyle(el); if (s.display === 'none' || s.position === 'fixed') continue
      const b = el.getBoundingClientRect(); if (!b.width) continue
      if (b.right > W + 1 || b.left < -1) {
        // ignore things inside a horizontal scroller
        let q = el.parentElement, scroll = false
        while (q) { const o = getComputedStyle(q).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' && q !== document.body) { scroll = true; break } q = q.parentElement }
        if (!scroll) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${Math.round(b.left)}..${Math.round(b.right)}`)
      }
    }
    // text smaller than 12px
    const tiny = [...document.querySelectorAll('p,span,a,button,li,q,summary,small,code')].filter(e => e.offsetParent && e.childNodes.length && parseFloat(getComputedStyle(e).fontSize) < 11.5).map(e => e.className || e.tagName).slice(0, 4)
    return { W, scrollW: document.documentElement.scrollWidth, bad: bad.slice(0, 6), tiny }
  })
  console.log(`${w}x${h}`, r.scrollW > r.W ? `OVERFLOW ${r.scrollW}` : 'ok', r.bad.length ? r.bad.join(' | ') : '', r.tiny.length ? 'tiny:' + r.tiny.join(',') : '')
  await p.close()
}
await b.close()
