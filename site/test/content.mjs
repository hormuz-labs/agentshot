// Guides and motion examples: search metadata, credit, links and layout in real Chrome.
// node test/content.mjs [url]
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const url = process.argv[2] || 'http://localhost:4321/'
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
const examples = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'data', 'examples.json'), 'utf8'))
const guides = ['how-to-remove-filler-words-from-video', 'how-to-make-a-product-demo-video', 'how-to-turn-a-podcast-into-shorts', 'how-to-add-captions-to-a-video', 'how-to-make-motion-graphics-with-ai', 'how-to-edit-video-with-ai']
const browser = await chromium.launch({ executablePath: CHROME })
const errors = []
const check = (ok, what) => { if (!ok) errors.push(what) }
const open = async (path, opts = {}) => {
  const page = await browser.newPage({ reducedMotion: 'reduce', ...opts })
  page.on('pageerror', e => errors.push(`${path}: ${e.message}`))
  // the example pages point at videos and posters on a bucket; the page itself is what's under test
  await page.route(/storage\.googleapis\.com/, route => route.abort())
  const response = await page.goto(new URL(path, url).href, { waitUntil: 'domcontentloaded' })
  check(response?.status() === 200, `${path} is not served`)
  return page
}
const schemas = page => page.locator('script[type="application/ld+json"]').evaluateAll(nodes => nodes.map(n => JSON.parse(n.textContent)))
// what every indexable page needs, whatever it is about
const basics = async (page, path) => {
  const description = await page.locator('meta[name="description"]').getAttribute('content')
  check(description.length >= 110 && description.length <= 190, `${path} description is ${description.length} characters`)
  check(await page.locator('h1').count() === 1, `${path} needs one main heading`)
  check(await page.locator('link[rel="canonical"]').getAttribute('href') === `https://agentshot.si${path}`, `${path} has an incorrect canonical`)
  check(await page.locator('meta[name="robots"][content*="noindex"]').count() === 0, `${path} is excluded from search`)
  check((await schemas(page)).some(s => s['@type'] === 'BreadcrumbList'), `${path} has no breadcrumb schema`)
  check(await page.locator('[data-hero-cta] a[href="/#get"], [data-hero-cta] a[href^="/guides/"]').count() >= 1, `${path} has no action to take`)
}

try {
  // Guides: the whole article and its structured data are there without scripts.
  const hub = await open('/guides/', { javaScriptEnabled: false })
  await basics(hub, '/guides/')
  for (const slug of guides) check(await hub.locator(`.guide-cards a[href="/guides/${slug}/"]`).count() === 1, `the guides page does not link ${slug}`)
  await hub.close()
  for (const slug of guides) {
    const path = `/guides/${slug}/`
    const page = await open(path, { javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
    await basics(page, path)
    check(/^How to /.test(await page.title()), `${path} title does not start with the question`)
    const all = await schemas(page)
    const howto = all.find(s => s['@type'] === 'HowTo')
    const steps = await page.locator('.steps li h3').allTextContents()
    check(steps.length >= 5 && howto?.step.length === steps.length && steps.every((t, i) => t === howto.step[i].name), `${path} HowTo schema differs from its visible steps`)
    check(all.find(s => s['@type'] === 'Article')?.author?.name === 'Hormuz Labs', `${path} has no attributed article schema`)
    const faq = all.find(s => s['@type'] === 'FAQPage')
    const answers = await page.locator('.questions details').evaluateAll(nodes => nodes.map(n => ({ q: n.querySelector('summary').textContent, a: n.querySelector('p').textContent })))
    check(answers.length >= 3 && answers.every((f, i) => f.q === faq?.mainEntity[i]?.name && f.a === faq?.mainEntity[i]?.acceptedAnswer?.text), `${path} FAQ schema differs from its visible questions`)
    check((await page.locator('article').innerText()).split(/\s+/).length >= 450, `${path} is too thin to be a guide`)
    check(await page.locator('.others a').count() === guides.length - 1, `${path} does not link the other guides`)
    const next = await page.locator('.short .actions a.ghost').getAttribute('href')
    check((await page.request.get(new URL(next.split('#')[0], url).href)).status() === 200, `${path} leads to a page that does not exist: ${next}`)
    await page.close()
  }
  // each job page leads back to its guide
  for (const [job, guide] of [['remove-filler-words', guides[0]], ['ai-product-demo-video', guides[1]], ['long-video-to-shorts', guides[2]], ['ai-motion-graphics', guides[4]]]) {
    const page = await open(`/${job}/`, { javaScriptEnabled: false })
    check(await page.locator(`.learn a[href="/guides/${guide}/"]`).count() === 1, `/${job}/ does not link its guide`)
    await page.close()
  }

  // The gallery: every example with a prompt is listed once, and every tag has its page.
  const gallery = await open('/examples/', { javaScriptEnabled: false })
  await basics(gallery, '/examples/')
  const listed = await gallery.locator('.example-cards a').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')))
  check(listed.length === examples.length && new Set(listed).size === examples.length, `the gallery lists ${listed.length} examples, not ${examples.length}`)
  check((await gallery.title()).startsWith(`${examples.length} `), 'the gallery title does not count its examples')
  check(await gallery.locator('.example-cards img:not([loading="lazy"])').count() === 6, 'the gallery should load its first six posters at once and the rest as they scroll in')
  const tags = await gallery.locator('.example-tags a[href^="/examples/tag/"]').evaluateAll(nodes => nodes.map(a => a.getAttribute('href')))
  check(tags.length === new Set(examples.flatMap(e => e.tags)).size, 'the gallery does not link every tag')
  await gallery.close()
  for (const path of tags) {
    const page = await open(path, { javaScriptEnabled: false })
    await basics(page, path)
    const n = await page.locator('.example-cards a').count()
    check(n > 0 && (await page.title()).includes(`${n} `), `${path} title does not match its ${n} examples`)
    check(await page.locator('.example-tags a[aria-current="page"]').count() === 1, `${path} does not mark itself in the tags`)
    await page.close()
  }

  // Example pages: a sample across the gallery, including the longest prompt, a vertical video and a repeated title.
  const longest = examples.reduce((a, b) => (b.prompt.length > a.prompt.length ? b : a))
  const repeated = examples.find(e => examples.filter(o => o.title === e.title).length > 1)
  const sample = [...new Set([examples[0], examples[Math.floor(examples.length / 2)], examples.at(-1), longest, examples.find(e => e.height > e.width), repeated, examples.find(e => !e.tags.length)].filter(Boolean))]
  for (const e of sample) {
    const path = `/examples/${e.id}/`
    const page = await open(path, { javaScriptEnabled: false, viewport: { width: 1440, height: 1000 } })
    await basics(page, path)
    check((await page.title()).includes(e.title) && (await page.title()).includes(`@${e.handle}`), `${path} title does not name the example and its maker`)
    check(await page.locator('pre').textContent() === e.prompt, `${path} does not show the prompt as published`)
    // credit: the maker is named and their original post linked, wherever the example is shown
    check(await page.locator(`header a[href="${e.post}"]`).count() === 1 && (await page.locator('header .by').textContent()).includes(`@${e.handle}`), `${path} does not credit its maker`)
    check(await page.locator(`figcaption a[href="${e.source}"]`).count() === 1, `${path} does not link where it was collected`)
    const video = (await schemas(page)).find(s => s['@type'] === 'VideoObject')
    check(video?.contentUrl.endsWith(`/${e.id}.mp4`) && video.creator.name === e.name && video.uploadDate === e.date, `${path} video schema is wrong`)
    check(await page.locator('meta[property="og:image"]').getAttribute('content') === video?.thumbnailUrl, `${path} is not shared with its own poster`)
    check(await page.locator('video').getAttribute('preload') === 'none', `${path} downloads its video before it is played`)
    check(await page.locator('.more .example-cards a').count() === 6, `${path} does not lead to other examples`)
    await page.close()
  }
  // titles must stay unique even where makers reused a title
  const titles = new Set()
  for (const e of examples.filter(e => e.title === repeated?.title)) {
    const page = await open(`/examples/${e.id}/`, { javaScriptEnabled: false })
    titles.add(await page.title())
    await page.close()
  }
  check(!repeated || titles.size === examples.filter(e => e.title === repeated.title).length, 'examples that share a title share a page title')

  // Discovery: every new page is in the sitemap and the footer leads to both sections.
  const home = await open('/', { javaScriptEnabled: false })
  const sitemap = await (await home.request.get(new URL('/sitemap.xml', url).href)).text()
  const want = ['/guides/', '/examples/', ...guides.map(g => `/guides/${g}/`), ...tags, ...examples.map(e => `/examples/${e.id}/`)]
  const missing = want.filter(path => !sitemap.includes(`<loc>https://agentshot.si${path}</loc>`))
  check(!missing.length, `sitemap is missing ${missing.length} pages, such as ${missing[0]}`)
  check(await home.locator('footer a[href="/guides/"]').count() === 1 && await home.locator('footer a[href="/examples/"]').count() === 1, 'the footer does not link guides and examples')
  const llms = await (await home.request.get(new URL('/llms.txt', url).href)).text()
  for (const g of guides) check(llms.includes(`/guides/${g}/`), `llms.txt is missing the guide ${g}`)
  check(llms.includes('https://agentshot.si/examples/'), 'llms.txt is missing the examples')
  await home.close()

  // Layout: no sideways scrolling, the prompt stays inside its box, and the copy button works.
  for (const width of [320, 390, 768, 1440]) {
    for (const path of ['/guides/', `/guides/${guides[0]}/`, '/examples/', tags[0], `/examples/${longest.id}/`]) {
      const mobile = width < 600
      const page = await open(path, { viewport: { width, height: 900 }, ...(mobile ? { isMobile: true, hasTouch: true, userAgent: PHONE } : {}) })
      await page.waitForLoadState('load')
      const wide = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      check(wide <= 0, `${path} at ${width}px scrolls sideways by ${wide}px`)
      await page.close()
    }
  }
  const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
  const page = await ctx.newPage()
  await page.route(/storage\.googleapis\.com/, route => route.abort())
  await page.goto(new URL(`/examples/${examples[0].id}/`, url).href)
  await page.locator('[data-copy]').click()
  check(await page.evaluate(() => navigator.clipboard.readText()) === examples[0].prompt, 'the copy button does not copy the prompt')
  await ctx.close()
} finally {
  await browser.close()
}
console.log(errors.length ? `ERRORS\n${errors.join('\n')}` : `no errors: ${guides.length} guides, the gallery, its tags, sampled examples, sitemap and four sizes`)
process.exitCode = errors.length ? 1 : 0
