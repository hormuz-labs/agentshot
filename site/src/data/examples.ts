// The motion gallery on the web: one page per example, with the prompt its maker published.
// examples.json is written by scripts/examples.mjs from the app's catalogue (resources/motion-gallery/catalog.json).
import examples from './examples.json'

export interface Example {
  id: string; title: string; name: string; handle: string; post: string; source: string
  tags: string[]; width: number; height: number; date: string; duration: number; prompt: string
}
export const EXAMPLES = examples as Example[]

// Videos and posters stream from AgentShot's bucket (scripts/publish-motion-gallery.mjs in the app's repo).
const MEDIA = 'https://storage.googleapis.com/manul-gallery/v1'
export const exampleVideo = (id: string) => `${MEDIA}/${id}.mp4`
export const examplePoster = (id: string) => `${MEDIA}/posters/${id}.jpg`
export const examplePath = (id: string) => `/examples/${id}/`

export const tagSlug = (tag: string) => tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')
export const tagPath = (tag: string) => `/examples/tag/${tagSlug(tag)}/`
/** Every tag with how many examples carry it, most used first. */
export const TAGS = [...new Set(EXAMPLES.flatMap(e => e.tags))]
  .map(tag => ({ tag, count: EXAMPLES.filter(e => e.tags.includes(tag)).length }))
  .sort((a, b) => b.count - a.count)
// what each tag is, in the words someone would search with
export const TAG_WORDS: Record<string, string> = {
  'Product UI': 'product and app interface animations', 'Kinetic type': 'kinetic typography', Music: 'motion videos cut to music',
  Shapes: 'shape and logo animations', Particles: 'particle animations', Charts: 'animated charts and data', Diagrams: 'animated diagrams and explainers',
  Characters: 'character animations', Photos: 'photo-based motion videos', Phone: 'phone and mobile app mockup animations', Code: 'code and terminal animations',
}
export const seconds = (s: number) => `${Math.round(s)}-second`
/** Up to `n` other examples sharing the most tags, so each page leads to its nearest neighbours. */
export const related = (e: Example, n = 6) => EXAMPLES
  .filter(o => o.id !== e.id)
  .map(o => ({ o, shared: o.tags.filter(t => e.tags.includes(t)).length }))
  .sort((a, b) => b.shared - a.shared)
  .slice(0, n).map(x => x.o)
