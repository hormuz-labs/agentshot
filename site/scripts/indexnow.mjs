#!/usr/bin/env node
// Tell Bing (and the other IndexNow search engines) which pages exist the moment a deploy finishes, instead of
// waiting for them to crawl the sitemap. The key is public by design: the engines fetch /<key>.txt to check that
// whoever sent the list also controls the site.
//   node scripts/indexnow.mjs            send every URL in dist/sitemap.xml
//   node scripts/indexnow.mjs --dry      print what would be sent
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const HOST = 'agentshot.si'
export const KEY = 'e3aae683668832afd81328c6cf8dba34'

/** sitemap.xml → the request body IndexNow expects. Only this site's own URLs are sent. */
export function payload(sitemap) {
  const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => u.startsWith(`https://${HOST}/`))
  return { host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const body = payload(readFileSync(join(import.meta.dirname, '..', 'dist', 'sitemap.xml'), 'utf8'))
  if (!body.urlList.length) { console.error('no URLs in dist/sitemap.xml'); process.exit(1) }
  if (process.argv.includes('--dry')) { console.log(`would send ${body.urlList.length} URLs, key at ${body.keyLocation}`); process.exit(0) }
  const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) })
  // 200 = accepted, 202 = accepted, key not checked yet
  if (res.status !== 200 && res.status !== 202) { console.error(`IndexNow refused the list: ${res.status} ${await res.text()}`); process.exit(1) }
  console.log(`sent ${body.urlList.length} URLs to IndexNow (${res.status})`)
}
