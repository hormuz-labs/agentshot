// Job pages (product demos, filler words, Shorts, motion graphics): search metadata, links and layout in real Chrome.
// node test/jobs.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const browser = await chromium.launch({ executablePath: CHROME })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }
// each page and the words people search for, which must appear in its title, heading or description
const jobs = {
  'ai-product-demo-video': /product demo video/i,
  'remove-filler-words': /filler words/i,
  'long-video-to-shorts': /shorts/i,
  'ai-motion-graphics': /motion graphics/i,
}
const paths = Object.keys(jobs).map(slug => `/${slug}/`)
const open = async (path, opts = {}) => {
  const page = await browser.newPage({ reducedMotion: 'reduce', ...opts })
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  const response = await page.goto(new URL(path, url).href, { waitUntil: 'domcontentloaded' })
  check(response?.status() === 200, `${path} is not served`)
  return page
}

try {
  // The content search engines read must be there without scripts.
  for (const [slug, words] of Object.entries(jobs)) {
    const path = `/${slug}/`
    const page = await open(path, { javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
    const title = await page.title()
    const description = await page.locator('meta[name="description"]').getAttribute('content')
    check(words.test(title), `${path} title does not carry its search words: ${title}`)
    check(words.test(description), `${path} description does not carry its search words`)
    check(description.length >= 120 && description.length <= 180, `${path} description is ${description.length} characters, not 120–180`)
    check(await page.locator('h1').count() === 1, `${path} needs one main heading`)
    check(await page.locator('link[rel="canonical"]').getAttribute('href') === `https://agentshot.si${path}`, `${path} has an incorrect canonical`)
    check(await page.locator('meta[name="robots"][content*="noindex"]').count() === 0, `${path} is excluded from search`)
    const schemas = await page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n => JSON.parse(n.textContent)))
    check(schemas.some(s => s['@type'] === 'BreadcrumbList'), `${path} has no breadcrumb schema`)
    check(schemas.some(s => s['@type'] === 'WebPage' && s.url === `https://agentshot.si${path}`), `${path} has no page schema`)
    const faq = schemas.find(s => s['@type'] === 'FAQPage')
    const answers = await page.locator('.questions details').evaluateAll(nodes => nodes.map(n => ({ q: n.querySelector('summary').textContent, a: n.querySelector('p').textContent })))
    check(answers.length >= 4 && answers.every((f, i) => f.q === faq?.mainEntity[i]?.name && f.a === faq?.mainEntity[i]?.acceptedAnswer?.text), `${path} FAQ schema differs from its visible questions`)
    check(await page.locator('.steps li').count() === 4, `${path} does not show its four steps`)
    check((await page.locator('.skill a').getAttribute('href')).startsWith('https://github.com/hormuz-labs/agentshot/'), `${path} does not link its craft skill`)
    // the other job pages and at least one comparison, so no page is a dead end
    for (const other of paths.filter(p => p !== path)) check(await page.locator(`.others a[href="${other}"]`).count() === 1, `${path} does not link ${other}`)
    check(await page.locator('.related .comparison-cards a[href^="/compare/"]').count() >= 1, `${path} links no comparison`)
    for (const other of paths) check(await page.locator(`footer a[href="${other}"]`).count() === 1, `${path} footer does not link ${other}`)
    await page.close()
  }

  // The landing page leads into each job page, and its title carries the search term.
  const home = await open('/', { javaScriptEnabled: false })
  check(/AI video editor/.test(await home.title()), 'the landing page title does not say “AI video editor”')
  for (const path of paths) check(await home.locator(`.job a.job-more[href="${path}"]`).count() === 1, `the landing page does not link ${path} from its job`)
  const sitemap = await (await home.request.get(new URL('/sitemap.xml', url).href)).text()
  const llms = await (await home.request.get(new URL('/llms.txt', url).href)).text()
  for (const path of paths) {
    check(sitemap.includes(`<loc>https://agentshot.si${path}</loc>`), `sitemap is missing ${path}`)
    check(llms.includes(`https://agentshot.si${path}`), `llms.txt is missing ${path}`)
  }
  await home.close()

  // No sideways scrolling from a small phone to a wide desktop, and the clip stays inside its column.
  for (const width of [320, 390, 768, 1440]) {
    for (const path of paths) {
      const mobile = width < 600
      const page = await open(path, { viewport: { width, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, userAgent: PHONE } : {}) })
      await page.waitForLoadState('load')
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check(wide <= 0, `${path} at ${width}px scrolls sideways by ${wide}px`)
      check(await page.locator('[data-hero-cta] .btn').first().isVisible(), `${path} at ${width}px has no visible action`)
      await page.close()
    }
  }
} finally {
  await browser.close()
}
console.log(errors.length ? `ERRORS\n${errors.join('\n')}` : 'no errors: job pages, metadata, links, sitemap and four sizes')
process.exitCode = errors.length ? 1 : 0
