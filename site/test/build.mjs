// The built site and the scripts that feed it, checked without a browser: share cards, the example catalogue,
// and the list sent to search engines. Run after `npm run build`.
// node test/build.mjs
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { card, cards, stamp } from '../scripts/og.mjs'
import { trim } from '../scripts/examples.mjs'
import { HOST, KEY, payload } from '../scripts/indexnow.mjs'

const site = join(import.meta.dirname, '..')
const dist = join(site, 'dist')
assert.ok(existsSync(dist), 'build the site first: npm run build')

// --- share cards -------------------------------------------------------------------------------------------------
// a headline in two halves keeps its second half as the accent, and entities come out as text
assert.deepEqual(card('<meta property="og:image" content="https://agentshot.si/og/remove-filler-words.jpg"><h1 data-x>Cut the ums. <span class="grad" data-x>Keep &amp; the person.</span></h1>', '/remove-filler-words/'),
  { name: 'remove-filler-words', eyebrow: 'AgentShot', title: 'Cut the ums.', accent: 'Keep & the person.' })
assert.equal(card('<meta property="og:image" content="https://agentshot.si/og/compare-veed.jpg"><h1>AgentShot vs VEED</h1>', '/compare/veed/').eyebrow, 'Compare')
assert.equal(card('<meta property="og:image" content="https://agentshot.si/og/x.jpg"><h1>How to</h1>', '/guides/x/').eyebrow, 'Guide')
// pages on the default card, or sharing an example's poster, ask for nothing
assert.equal(card('<meta property="og:image" content="https://agentshot.si/og.jpg"><h1>Home</h1>', '/'), null)
assert.equal(card('<meta property="og:image" content="https://storage.googleapis.com/manul-gallery/v1/posters/a.jpg"><h1>A</h1>', '/examples/a/'), null)
// a changed headline changes the stamp, so only that card is redrawn
assert.notEqual(stamp({ eyebrow: 'Guide', title: 'A', accent: '' }), stamp({ eyebrow: 'Guide', title: 'B', accent: '' }))

const wanted = cards(dist)
assert.ok(wanted.length >= 25, `only ${wanted.length} pages ask for a share card`)
const stamps = JSON.parse(readFileSync(join(site, 'public', 'og', 'cards.json'), 'utf8'))
for (const c of wanted) {
  assert.ok(c.title, `${c.path} has no headline for its card`)
  assert.equal(stamps[c.name], stamp(c), `the share card for ${c.path} is out of date: run node scripts/og.mjs`)
  const file = join(dist, 'og', `${c.name}.jpg`)
  assert.ok(existsSync(file) && statSync(file).size > 15_000, `${c.path} asks for /og/${c.name}.jpg, which is missing or empty`)
  // JPEG, 1200 × 630: the size every network expects
  const bytes = readFileSync(file)
  assert.deepEqual([bytes[0], bytes[1]], [0xff, 0xd8], `${c.name}.jpg is not a JPEG`)
  const sof = bytes.indexOf(Buffer.from([0xff, 0xc0]))
  assert.deepEqual([bytes.readUInt16BE(sof + 7), bytes.readUInt16BE(sof + 5)], [1200, 630], `${c.name}.jpg is not 1200 × 630`)
}
// no card is left behind for a page that no longer exists
const drawn = readdirSync(join(site, 'public', 'og')).filter(f => f.endsWith('.jpg')).map(f => f.slice(0, -4))
assert.deepEqual(drawn.filter(n => !wanted.some(c => c.name === n)), [], 'public/og holds cards no page asks for')

// every page's share picture is a real file on this site, or an example's poster on the bucket
const pages = []
const walk = dir => { for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(join(dir, e.name)) : e.name === 'index.html' && pages.push(join(dir, e.name)) }
walk(dist)
for (const file of pages) {
  const image = readFileSync(file, 'utf8').match(/<meta property="og:image" content="([^"]+)"/)?.[1]
  assert.ok(image, `${file} has no share picture`)
  if (image.startsWith('https://agentshot.si/')) assert.ok(existsSync(join(dist, new URL(image).pathname)), `${file} shares ${image}, which is not in the build`)
  else assert.match(image, /^https:\/\/storage\.googleapis\.com\/manul-gallery\/v1\/posters\/[a-z0-9-]+\.jpg$/, `${file} shares an unexpected picture: ${image}`)
}

// --- the example catalogue ---------------------------------------------------------------------------------------
const entry = { id: 'a-1', title: 'T', creator: { name: 'N', handle: 'h', url: 'u' }, post: 'p', source: 's', tags: ['Music'], width: 1920, height: 1080, date: '2026-01-01', duration: 15.1, prompt: '  go  ', video: 'media/a-1.mp4', bytes: 1, remote: {} }
assert.deepEqual(trim([entry]), [{ id: 'a-1', title: 'T', name: 'N', handle: 'h', post: 'p', source: 's', tags: ['Music'], width: 1920, height: 1080, date: '2026-01-01', duration: 15.1, prompt: 'go' }])
// nothing to read, nothing to play, or nobody to credit: no page
assert.deepEqual(trim([{ ...entry, prompt: '' }, { ...entry, video: null }, { ...entry, creator: {} }]), [])
// the site's copy matches the app's catalogue
const catalogue = JSON.parse(readFileSync(join(site, '..', 'resources', 'motion-gallery', 'catalog.json'), 'utf8')).entries
const examples = JSON.parse(readFileSync(join(site, 'src', 'data', 'examples.json'), 'utf8'))
assert.deepEqual(examples, trim(catalogue), 'site/src/data/examples.json is out of date: run node site/scripts/examples.mjs')
assert.equal(new Set(examples.map(e => e.id)).size, examples.length, 'two examples share an id')
for (const e of examples) {
  assert.match(e.id, /^[a-z0-9-]+$/, `${e.id} cannot be a URL`)
  assert.ok(e.post.startsWith('https://') && e.source.startsWith('https://'), `${e.id} has no link to credit`)
  assert.ok(existsSync(join(dist, 'examples', e.id, 'index.html')), `${e.id} has no page`)
}

// --- the list sent to search engines -----------------------------------------------------------------------------
const body = payload('<urlset><url><loc>https://agentshot.si/</loc></url><url><loc>https://elsewhere.example/x</loc></url><url><loc>https://agentshot.si/pricing/</loc></url></urlset>')
assert.deepEqual(body, { host: 'agentshot.si', key: KEY, keyLocation: `https://agentshot.si/${KEY}.txt`, urlList: ['https://agentshot.si/', 'https://agentshot.si/pricing/'] })
assert.match(KEY, /^[a-f0-9]{32}$/)
assert.equal(HOST, 'agentshot.si')
// the engines check the key by fetching it from the site, so it must be published and say exactly the key
assert.equal(readFileSync(join(dist, `${KEY}.txt`), 'utf8'), KEY, 'the IndexNow key file is not published or does not match')
const live = payload(readFileSync(join(dist, 'sitemap.xml'), 'utf8')).urlList
assert.equal(new Set(live).size, live.length, 'the sitemap repeats a URL')
assert.ok(live.length === pages.length - readdirSync(join(dist, 'download')).length, `the sitemap lists ${live.length} URLs for ${pages.length} pages`)
assert.ok(!live.some(u => /\/download\/|\/404/.test(u)), 'the sitemap lists installer or 404 pages')

console.log(`no errors: ${wanted.length} share cards, ${examples.length} examples in step with the catalogue, ${live.length} URLs for search engines`)
