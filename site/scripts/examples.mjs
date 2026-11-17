#!/usr/bin/env node
// The site's copy of the motion gallery: resources/motion-gallery/catalog.json trimmed to what the example pages show.
// The site builds on its own (see Dockerfile), so it cannot import the app's catalogue; run this when the catalogue changes.
//   node site/scripts/examples.mjs            write site/src/data/examples.json
//   node site/scripts/examples.mjs --check    exit 1 if that file is out of date
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..', '..')
const out = join(root, 'site', 'src', 'data', 'examples.json')

/** Catalogue entries → the fields a page needs; entries with no published prompt have nothing to read and get no page. */
export const trim = entries => entries
  .filter(e => e.prompt && e.video && e.creator?.handle)
  .map(e => ({
    id: e.id, title: e.title, name: e.creator.name, handle: e.creator.handle, post: e.post, source: e.source,
    tags: e.tags ?? [], width: e.width, height: e.height, date: e.date, duration: e.duration, prompt: e.prompt.trim(),
  }))

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = JSON.stringify(trim(JSON.parse(readFileSync(join(root, 'resources', 'motion-gallery', 'catalog.json'), 'utf8')).entries), null, 1) + '\n'
  if (process.argv.includes('--check')) {
    let now = ''
    try { now = readFileSync(out, 'utf8') } catch {}
    if (now !== next) { console.error('site/src/data/examples.json is out of date: run node site/scripts/examples.mjs'); process.exit(1) }
    console.log('examples.json is up to date')
  } else {
    writeFileSync(out, next)
    console.log(`wrote ${JSON.parse(next).length} examples`)
  }
}
