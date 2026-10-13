// The motion gallery: examples from prompt-motion.com with the prompt (or skill) behind each, their tags and their
// makers (scripts/fetch-motion-gallery.mjs). The start screen shows them; using one gives a motion project the example's
// prompt as its brief and its video as the reference. The app carries the catalogue and posters (manul://gallery/…);
// videos stream from Manul's bucket (scripts/publish-motion-gallery.mjs), or come from resources/motion-gallery/media/
// when a developer has fetched them.
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GalleryExample } from '../shared/types'

export const GALLERY = app.isPackaged ? join(process.resourcesPath, 'motion-gallery') : join(import.meta.dirname, '../../resources/motion-gallery')
/** Where the videos stream from: <base>/<id>.mp4. The renderer's CSP (src/renderer/index.html, media-src) allows its origin. */
export const VIDEO_BASE = process.env.MANUL_GALLERY_URL || 'https://storage.googleapis.com/manul-gallery/v1'

type Raw = Omit<GalleryExample, 'tags'> & { tags: string[]; video?: string; poster?: string }

/** The same slugs as prompt-motion's tag pages (/tags/kinetic-type). */
export const tagSlug = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

let cache: { at: number; list: GalleryExample[] } | null = null

/** Every example whose video and poster are here, newest first. */
export function examples(): GalleryExample[] {
  const file = join(GALLERY, 'catalog.json')
  if (!existsSync(file)) return []
  if (cache && Date.now() - cache.at < 10_000) return cache.list
  const raw = JSON.parse(readFileSync(file, 'utf8')).entries as Raw[]
  const list = raw
    .filter(e => existsSync(join(GALLERY, 'posters', `${e.id}.jpg`)))
    .map(e => ({
      id: e.id, title: e.title, creator: e.creator, post: e.post, source: e.source, kind: e.kind, prompt: e.prompt, skill: e.skill,
      tags: e.tags.map(name => ({ name, slug: tagSlug(name) })), width: e.width, height: e.height, date: e.date,
      duration: e.duration, sound: e.sound,
      video: existsSync(localVideo(e.id)) ? `manul://gallery/media/${e.id}.mp4` : `${VIDEO_BASE}/${e.id}.mp4`,
      poster: `manul://gallery/posters/${e.id}.jpg`,
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  cache = { at: Date.now(), list }
  return list
}

export const example = (id: string) => examples().find(e => e.id === id)

const localVideo = (id: string) => join(GALLERY, 'media', `${id}.mp4`)

/** The example's video on disk, to copy into a project as its reference: a developer's local copy, else downloaded once
 *  from the bucket into Manul's cache. */
export async function exampleVideo(id: string) {
  if (existsSync(localVideo(id))) return localVideo(id)
  const dir = join(app.getPath('userData'), 'gallery-cache')
  const file = join(dir, `${id}.mp4`)
  if (existsSync(file)) return file
  mkdirSync(dir, { recursive: true })
  const r = await fetch(`${VIDEO_BASE}/${id}.mp4`)
  if (!r.ok) throw new Error(`Couldn't download the example's video (${r.status}). Check your connection and try again.`)
  writeFileSync(`${file}.part`, Buffer.from(await r.arrayBuffer()))
  renameSync(`${file}.part`, file)
  return file
}
