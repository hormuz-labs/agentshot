// Comparison content, crawlability and responsive layout in real Chrome.
// node test/compare.mjs [url]; optional SHOTS directory for design screenshots.
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const url = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const browser = await chromium.launch({ executablePath: CHROME })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }
const routes = ['scarlet', 'descript', 'veed', 'kapwing', 'opus-clip', 'capcut', 'premiere-pro', 'submagic', 'captions', 'runway'].map(slug => `/compare/${slug}/`)
const paths = ['/compare/', ...routes]
const open = async (path, opts = {}) => {
  const page = await browser.newPage({ reducedMotion: 'reduce', ...opts })
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  const response = await page.goto(new URL(path, url).href, { waitUntil: 'networkidle' })
  check(response?.status() === 200, `${path} is not served`)
  await page.evaluate(() => document.fonts.ready)
  return page
}

try {
  // Static pages must carry the actual article, citations, FAQ and metadata without scripts.
  for (const path of paths) {
    const page = await open(path, { javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
    check(await page.locator('h1').count() === 1, `${path} needs one main heading`)
    check(await page.locator('h1').isVisible(), `${path} hides its heading without JavaScript`)
    check(await page.locator('link[rel="canonical"]').getAttribute('href') === `https://agentshot.si${path}`, `${path} has an incorrect canonical`)
    check((await page.locator('meta[name="description"]').getAttribute('content')).length > 80, `${path} needs a useful description`)
    check(await page.locator('meta[name="robots"][content*="noindex"]').count() === 0, `${path} is excluded from search`)
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n => JSON.parse(n.textContent)))
    check(schemas.some(s => s['@type'] === 'BreadcrumbList'), `${path} has no breadcrumb schema`)
    const broken = await page.locator('main a[href^="#"]').evaluateAll(nodes => nodes.filter(a => !document.getElementById(a.getAttribute('href').slice(1))).map(a => a.getAttribute('href')))
    check(!broken.length, `${path} has broken anchors: ${broken.join(', ')}`)
    if (path === '/compare/') {
      check(schemas.some(s => s['@type'] === 'CollectionPage' && s.mainEntity.itemListElement.length === routes.length), 'the hub schema is missing comparison routes')
      for (const route of routes) check(await page.locator(`.comparison-cards a[href="${route}"]`).count() === 1, `the hub is missing ${route}`)
    } else {
      const article = schemas.find(s => s['@type'] === 'Article')
      const faq = schemas.find(s => s['@type'] === 'FAQPage')
      check(article?.author?.name === 'Hormuz Labs' && article.citation.length >= 8, `${path} needs attributed, sourced article schema`)
      check(article?.mainEntityOfPage === `https://agentshot.si${path}`, `${path} article schema points elsewhere`)
      const answers = await page.locator('.questions details').evaluateAll(nodes => nodes.map(n => ({ q: n.querySelector('summary').textContent, a: n.querySelector('p').textContent })))
      check(answers.length >= 4 && faq?.mainEntity.length === answers.length, `${path} FAQ schema does not match its visible questions`)
      check(answers.every((f, i) => f.q === faq?.mainEntity[i]?.name && f.a === faq?.mainEntity[i]?.acceptedAnswer?.text), `${path} FAQ schema differs from the article`)
      check(await page.locator('tbody tr').count() >= 6, `${path} has no substantive feature comparison`)
      check(await page.locator('.row-refs a').count() >= 12, `${path} comparison rows are not cited`)
      const citations = await page.locator('.sources li > a').evaluateAll(nodes => nodes.map(n => n.href))
      check(citations.every(href => href.startsWith('https://')), `${path} has an invalid source URL`)
      if (path.includes('scarlet')) check(citations.filter(href => href.includes('Forward-Future/scarlet')).every(href => href.includes('52e200ffddee70e16c7db53ed809921a8e5d8bf6')), 'Scarlet citations are not pinned')
      await page.locator('.questions summary').first().click()
      check(await page.locator('.questions details[open] p').first().isVisible(), `${path} FAQ does not open without JavaScript`)
    }
    await page.close()
  }

  // Discovery files include every comparison, without triggering installer or 404 indexing.
  const page = await open('/compare/')
  const sitemap = await (await page.request.get(new URL('/sitemap.xml', url).href)).text()
  const locations = await page.evaluate(xml => [...new DOMParser().parseFromString(xml, 'application/xml').querySelectorAll('loc')].map(n => n.textContent), sitemap)
  for (const path of paths) check(locations.includes(`https://agentshot.si${path}`), `sitemap is missing ${path}`)
  check(locations.includes('https://agentshot.si/'), 'sitemap is missing the landing page')
  check(!locations.some(href => /\/download\/|\/404/.test(href)), 'sitemap indexes installer or 404 pages')
  check(new Set(locations).size === locations.length, 'sitemap has duplicate URLs')
  const robots = await (await page.request.get(new URL('/robots.txt', url).href)).text()
  check(robots.includes('Sitemap: https://agentshot.si/sitemap.xml'), 'robots.txt does not advertise the sitemap')
  const llms = await (await page.request.get(new URL('/llms.txt', url).href)).text()
  for (const path of paths) check(llms.includes(path), `llms.txt is missing ${path}`)
  await page.close()

  // Small phones get readable stacked rows; tablets retain a contained, keyboard-scrollable table.
  for (const width of [320, 390, 600, 768, 1024, 1440, 1920]) {
    for (const path of paths) {
      const mobile = width <= 600
      const page = await open(path, { viewport: { width, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, userAgent: PHONE } : {}) })
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check(wide <= 0, `${path} at ${width}px scrolls sideways by ${wide}px`)
      const clipped = await page.locator('.comparison-cards a').evaluateAll(nodes => nodes.flatMap(n => [...n.children].filter(child => child.scrollWidth > child.clientWidth + 1).map(child => child.textContent)))
      check(!clipped.length, `${path} at ${width}px clips card text: ${clipped.join(', ')}`)
      check(await page.locator('.top nav a[href="/compare/"]').isVisible(), `${path} at ${width}px has no visible Compare navigation`)
      if (mobile) {
        check(await page.locator('[data-hero-cta]').isVisible(), `${path} at ${width}px has no hero action`)
        await page.locator('.try-editor').scrollIntoViewIfNeeded()
        await page.waitForFunction(() => !document.querySelector('#dock').hidden, null, { timeout: 2000 }).catch(() => {})
        check(await page.locator('#dock').isVisible(), `${path} at ${width}px has no phone handoff`)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await page.waitForTimeout(100)
        check(await page.locator('.foot').evaluate(foot => foot.getBoundingClientRect().bottom <= document.querySelector('#dock').getBoundingClientRect().top + 1), `${path} at ${width}px has a footer hidden behind the phone dock`)
      }
      if (path !== '/compare/') {
        const scroll = page.locator('.table-scroll')
        const sizes = await scroll.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }))
        if (mobile) {
          check(sizes.scroll <= sizes.width, `${path} at ${width}px still requires horizontal table scrolling`)
          check(await page.locator('td .cell-label').first().isVisible(), `${path} at ${width}px has unlabeled stacked cells`)
          check(await page.locator('table').getAttribute('role') === 'table', `${path} does not preserve table semantics`)
        } else if (width === 768) {
          check(sizes.scroll > sizes.width, `${path} has no contained table overflow on a narrow tablet`)
          await scroll.focus()
          await page.keyboard.press('ArrowRight')
          await page.waitForTimeout(150)
          check(await scroll.evaluate(el => el.scrollLeft > 0), `${path} table cannot be scrolled by keyboard`)
        }
      }
      if (process.env.SHOTS && [390, 1440].includes(width) && ['/compare/', '/compare/scarlet/'].includes(path)) {
        await mkdir(process.env.SHOTS, { recursive: true })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: join(process.env.SHOTS, `${path.includes('scarlet') ? 'scarlet' : 'hub'}-${width}.png`), fullPage: true })
      }
      await page.close()
    }
  }

  // Reduced-motion users and a no-script phone can still read the page and operate FAQs.
  const phone = await open('/compare/scarlet/', { javaScriptEnabled: false, viewport: { width: 320, height: 760 } })
  check(await phone.locator('td .cell-label').first().isVisible(), 'no-script phone loses its cell labels')
  check(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no-script phone scrolls sideways')
  await phone.close()

  // The site's smooth-scrolling enhancement must not break section links or nested table scrolling.
  const motion = await open('/compare/scarlet/', { reducedMotion: 'no-preference', viewport: { width: 768, height: 1024 } })
  await motion.locator('.hero-actions a[href="#differences"]').click()
  await motion.waitForFunction(() => Math.abs(document.querySelector('#differences').getBoundingClientRect().top - 76) < 10, null, { timeout: 5000 }).catch(() => errors.push('smooth scrolling does not land at the comparison section'))
  check(new URL(motion.url()).hash === '#differences', 'smooth scrolling loses the section URL')
  await motion.locator('.table-scroll').focus()
  await motion.keyboard.press('ArrowRight')
  await motion.waitForTimeout(150)
  check(await motion.locator('.table-scroll').evaluate(el => el.scrollLeft > 0), 'motion enhancement prevents keyboard table scrolling')
  await motion.close()
} finally {
  await browser.close()
}
console.log(errors.length ? `ERRORS\n${errors.join('\n')}` : 'no errors: comparisons, metadata, citations, FAQs and seven responsive sizes')
process.exitCode = errors.length ? 1 : 0
