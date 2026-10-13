#!/usr/bin/env node
// The motion gallery on the start screen: every example from prompt-motion.com, with the prompt (or skill) that made it,
// its tags, and who made it. Videos come from the creator's own post on X (yt-dlp), falling back to prompt-motion's copy;
// each keeps its credit and source link.
//
//   node scripts/fetch-motion-gallery.mjs            catalogue only → resources/motion-gallery/catalog.json
//   node scripts/fetch-motion-gallery.mjs --media    also the videos (→ media/, git-ignored) and posters (→ posters/, shipped)
import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const SITE = 'https://prompt-motion.com'
const root = join(import.meta.dirname, '..')
const out = join(root, 'resources', 'motion-gallery')
const mediaDir = join(out, 'media')
const FFMPEG = join(root, 'resources/bin', `${process.platform}-${process.arch}`, 'ffmpeg')
const withMedia = process.argv.includes('--media')

const unescape = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&#x2F;/g, '/').replace(/&amp;/g, '&')
const text = html => unescape(html.replace(/<br\s*\/?>/g, '\n').replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ''))

async function get(url, tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'Manul gallery fetch' } })
      if (!r.ok) throw new Error(`${r.status} ${url}`)
      return await r.text()
    } catch (e) { if (i >= tries) throw e; await new Promise(r => setTimeout(r, 1000 * i)) }
  }
}

/** One entry page → what the gallery needs. */
function parse(slug, html) {
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])
  const prompt = html.match(/<div id="entry-prompt"[^>]*>(.*?)<\/div>/s)
  const post = html.match(/href="(https:\/\/(?:x|twitter)\.com\/[^/"]+\/status\/\d+)"/)
  const tags = [...html.matchAll(/href="\/tags\/[^"]+">([^<]+)<\/a>/g)].map(m => unescape(m[1]))
  const skill = [...html.matchAll(/href="(https:\/\/github\.com\/[^"]+)"/g)].map(m => m[1])
  return {
    id: slug,
    title: unescape(ld.name),
    creator: { name: unescape(ld.creator?.name || ''), handle: (ld.creator?.url || '').split('/').pop(), url: ld.creator?.url },
    post: post?.[1],
    source: ld.url,
    kind: prompt ? 'prompt' : 'skill',
    prompt: prompt ? text(prompt[1]).trim() : undefined,
    skill: skill[0],
    tags: [...new Set(tags)],
    width: ld.width, height: ld.height,
    date: ld.uploadDate,
    remote: { video: ld.contentUrl, poster: ld.thumbnailUrl?.[0] },
  }
}

async function pool(items, n, fn) {
  const results = []
  let next = 0
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i) } }))
  return results
}

/** The video from the creator's post (yt-dlp), else prompt-motion's copy; then a poster and the length from ffmpeg. */
async function fetchMedia(e) {
  const video = join(mediaDir, `${e.id}.mp4`), poster = join(out, 'posters', `${e.id}.jpg`)
  mkdirSync(join(out, 'posters'), { recursive: true })
  if (!existsSync(video)) {
    let from = 'x'
    try {
      if (!e.post) throw new Error('no post')
      await run('yt-dlp', ['-q', '--no-warnings', '--no-playlist', '-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', video, e.post], { timeout: 180_000 })
      if (!existsSync(video)) throw new Error('nothing downloaded')
    } catch {
      from = 'prompt-motion'
      const r = await fetch(e.remote.video)
      if (!r.ok) throw new Error(`${e.id}: no video (${r.status})`)
      writeFileSync(video, Buffer.from(await r.arrayBuffer()))
    }
    e.videoFrom = from
  }
  const probe = await run(FFMPEG, ['-hide_banner', '-i', video], { timeout: 30_000 }).catch(err => err)
  const d = /Duration: (\d+):(\d+):([\d.]+)/.exec(String(probe.stderr))
  e.duration = d ? Math.round((+d[1] * 3600 + +d[2] * 60 + +d[3]) * 10) / 10 : undefined
  e.sound = /Audio:/.test(String(probe.stderr))
  if (!existsSync(poster)) await run(FFMPEG, ['-y', '-loglevel', 'error', '-ss', String(Math.min(2, (e.duration || 2) / 3)), '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', poster])
  e.video = `media/${e.id}.mp4`
  e.poster = `posters/${e.id}.jpg`
  e.bytes = statSync(video).size
}

const home = await get(SITE + '/')
const slugs = [...new Set([...home.matchAll(/href="\/([a-z0-9-]+-[0-9a-f]{6})"/g)].map(m => m[1]))]
console.log(`${slugs.length} entries`)
mkdirSync(out, { recursive: true })
const old = existsSync(join(out, 'catalog.json')) ? JSON.parse(readFileSync(join(out, 'catalog.json'), 'utf8')).entries : []
const failed = []
const entries = (await pool(slugs, 6, async slug => {
  try {
    const e = { ...old.find(o => o.id === slug), ...parse(slug, await get(`${SITE}/${slug}`)) }
    if (withMedia) { mkdirSync(mediaDir, { recursive: true }); await fetchMedia(e) }
    process.stdout.write('.')
    return e
  } catch (err) { failed.push(`${slug}: ${err.message}`); return null }
})).filter(Boolean)
console.log()
writeFileSync(join(out, 'catalog.json'), JSON.stringify({
  source: SITE, curator: 'https://x.com/p4nthera_', fetchedAt: new Date().toISOString(),
  note: 'Made by the creators named on each entry; prompts as they published them. Credit them and link the post wherever an example is shown.',
  entries,
}, null, 1))
console.log(`${entries.length} saved${failed.length ? `, ${failed.length} failed:\n  ${failed.join('\n  ')}` : ''}`)
