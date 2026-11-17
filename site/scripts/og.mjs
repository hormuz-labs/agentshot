#!/usr/bin/env node
// Share cards: the 1200 × 630 picture shown when a page is linked in a chat or a feed, one per page that asks for one.
// Reads the built site, so it always matches what the pages say: every page whose og:image is /og/<name>.jpg gets
// public/og/<name>.jpg drawn from its own headline. Run after a build, then build again so dist carries the pictures.
//   npm run build && node scripts/og.mjs            draw the cards that are missing or whose headline changed
//   node scripts/og.mjs --check                     exit 1 if a page asks for a card that isn't drawn or is out of date
import { chromium } from 'playwright-core'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const site = join(import.meta.dirname, '..')
const dist = join(site, 'dist')
const out = join(site, 'public', 'og')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, '’').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim()
const attr = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '’')

/** One built page → the card it asks for, or null: { name, eyebrow, title, accent }. */
export function card(html, path) {
  const image = html.match(/<meta property="og:image" content="https:\/\/agentshot\.si\/og\/([a-z0-9-]+)\.jpg"/)?.[1]
  if (!image) return null
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? ''
  // a headline in two halves ("Cut the ums. <span class="grad">Keep the person.</span>") keeps its second half in colour
  const grad = h1.match(/<span class="(?:grad|cuts)"[^>]*>([\s\S]*?)<\/span>/)
  const title = text(grad ? h1.replace(grad[0], '') : h1)
  const eyebrow = path.startsWith('/compare/') ? 'Compare' : path.startsWith('/guides/') ? 'Guide' : path.startsWith('/examples/') ? 'Motion examples' : 'AgentShot'
  return { name: image, eyebrow, title, accent: grad ? text(grad[1]) : '' }
}

/** Every card the built site asks for, one per name (several pages may share a card). */
export function cards(root = dist) {
  const found = new Map()
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'index.html') {
        const path = full.slice(root.length).replace(/index\.html$/, '')
        const c = card(readFileSync(full, 'utf8'), path)
        if (c && (!found.has(c.name) || path.length < found.get(c.name).path.length)) found.set(c.name, { ...c, path })
      }
    }
  }
  walk(root)
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// what a card was drawn from, kept beside the pictures so a changed headline redraws its card and nothing else does
export const stamp = c => createHash('sha256').update(JSON.stringify([c.eyebrow, c.title, c.accent, TEMPLATE_VERSION])).digest('hex').slice(0, 16)
const TEMPLATE_VERSION = 3

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')
// inlined: a page set from a string may not load files from disk
const font = `data:font/woff2;base64,${readFileSync(join(site, 'node_modules/@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2')).toString('base64')}`
const icon = `data:image/png;base64,${readFileSync(join(site, 'public', 'icon.png')).toString('base64')}`
export const page = c => `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: Archivo; src: url(${font}); font-weight: 100 900; font-stretch: 62% 125%; }
  * { box-sizing: border-box; margin: 0; }
  body { width: 1200px; height: 630px; padding: 64px 72px; display: flex; flex-direction: column; background: #0d0c11; color: #f6f3ec; font-family: Archivo, sans-serif; overflow: hidden;
    background-image: radial-gradient(700px 420px at 100% 0, #7b61ff38, transparent 70%), radial-gradient(520px 360px at 0 100%, #ff4fb01f, transparent 70%); }
  .brand { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 800; letter-spacing: -.02em; }
  .brand img { width: 60px; height: 60px; }
  .brand span { margin-left: auto; padding: 8px 18px; border: 1.5px solid #f6f3ec33; border-radius: 999px; font-size: 20px; font-weight: 600; letter-spacing: 0; color: #f6f3ecb3; }
  h1 { margin-top: auto; font-weight: 800; line-height: 1.02; letter-spacing: -.035em; text-wrap: balance; }
  h1 b { display: block; font-weight: 800; background: linear-gradient(100deg, #7b61ff, #ff4fb0 38%, #ff5a36 68%, #ffe01a); -webkit-background-clip: text; color: transparent; padding-bottom: .08em; }
  p { margin-top: 28px; font-size: 24px; font-weight: 500; color: #f6f3ecb3; }
  p i { font-style: normal; color: #ffe01a; }
</style><body>
  <div class="brand"><img src="${icon}" alt="">AgentShot<span>${esc(c.eyebrow)}</span></div>
  <h1 id="h">${esc(c.title)}${c.accent ? `<b>${esc(c.accent)}</b>` : ''}</h1>
  <p>The open-source video editor you talk to · <i>agentshot.si</i></p>
<script>
  // the largest headline that fits: long comparison titles shrink, short ones stay big
  document.fonts.ready.then(() => {
    const h = document.getElementById('h'); let size = 96
    do { size -= 4; h.style.fontSize = size + 'px' } while (h.offsetHeight > 340 && size > 44)
    document.body.dataset.ready = '1'
  })
</script>`

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!existsSync(dist)) { console.error('build the site first: npm run build'); process.exit(1) }
  const wanted = cards()
  const stampsFile = join(out, 'cards.json')
  const stamps = existsSync(stampsFile) ? JSON.parse(readFileSync(stampsFile, 'utf8')) : {}
  const stale = wanted.filter(c => stamps[c.name] !== stamp(c) || !existsSync(join(out, `${c.name}.jpg`)))
  if (process.argv.includes('--check')) {
    if (stale.length) { console.error(`share cards out of date: ${stale.map(c => c.name).join(', ')}\nrun: npm run build && node scripts/og.mjs`); process.exit(1) }
    console.log(`${wanted.length} share cards are up to date`)
  } else {
    mkdirSync(out, { recursive: true })
    if (stale.length) {
      const browser = await chromium.launch({ executablePath: CHROME })
      const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } })
      for (const c of stale) {
        await tab.setContent(page(c), { waitUntil: 'load' })
        await tab.waitForSelector('body[data-ready]')
        await tab.screenshot({ path: join(out, `${c.name}.jpg`), type: 'jpeg', quality: 86 })
      }
      await browser.close()
    }
    writeFileSync(stampsFile, JSON.stringify(Object.fromEntries(wanted.map(c => [c.name, stamp(c)])), null, 1) + '\n')
    console.log(`drew ${stale.length} of ${wanted.length} share cards`)
  }
}
