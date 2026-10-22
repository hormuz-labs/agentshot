// Pointing the agent at something in the project from the message box: type @ and pick a file, a version of the film
// or a motion clip. It goes with the message like a file attached from the Files list (the agent gets its path and
// what it is), and "@name" stays in the text where it was said.
import type { FileKind, Project } from '../../../shared/types'
import { kindByName } from '../../../shared/file-kinds'
import { rank } from './commands'

export type Mention = {
  /** what's attached: the file's path, the version's render, or clips/<id> */
  id: string
  /** its name in the list and after the @ */
  title: string
  /** more words it can be found by */
  keywords?: string
  /** a line under the name */
  detail: string
  kind: FileKind | 'clip'
}

const versionsOf = (p: Project) => p.versions.filter(v => v.id !== p.proposal)

/** Everything in the project that can be mentioned: files, then versions (newest first), then motion clips. */
export function mentionables(p: Project): Mention[] {
  const files = Object.entries(p.files || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([rel, f]): Mention => ({ id: rel, title: rel.split('/').slice(1).join('/'), keywords: f.kind, detail: f.summary, kind: f.kind }))
  const versions = versionsOf(p).map((v, i): Mention => ({
    id: v.path, title: `v${i + 1} · ${v.title}`, keywords: 'version', kind: 'video',
    detail: v.id === p.current ? 'Version on screen' : `Version ${i + 1}`,
  })).filter(v => !p.files?.[v.id]).reverse()
  const clips = Object.values(p.clips || {}).map((c): Mention => ({
    id: `clips/${c.id}`, title: c.title, keywords: `clip ${c.id}`, kind: 'clip', detail: `Motion clip · ${Math.round(c.duration * 10) / 10} s${c.overlay ? ' · over the footage' : ''}`,
  }))
  return [...files, ...versions, ...clips]
}

/** The @word being typed at the caret: where its @ is and what follows it (null when the caret isn't in one). */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const m = /(?:^|\s)@([^\s@]*)$/.exec(text.slice(0, caret))
  return m ? { start: caret - m[1].length - 1, query: m[1] } : null
}

/** What matches the query, best first. */
export const matches = (items: Mention[], query: string) => rank(items, query)

/** The text with the @word at the caret replaced by the picked one's name, and where the caret goes after it. */
export function insertMention(text: string, at: { start: number; query: string }, m: Mention) {
  const before = text.slice(0, at.start), after = text.slice(at.start + 1 + at.query.length)
  const word = `@${m.title}${after.startsWith(' ') ? '' : ' '}`
  return { text: before + word + after, caret: before.length + word.length }
}

/** A chip's name and icon for something attached: a file by its name, a version as "v2 · title", a clip by title. */
export function refChip(p: Project, rel: string): { label: string; kind: FileKind | 'clip' } {
  if (p.files?.[rel]) return { label: rel.split('/').slice(1).join('/'), kind: p.files[rel].kind }
  const k = versionsOf(p).findIndex(v => v.path === rel)
  if (k >= 0) return { label: `v${k + 1} · ${versionsOf(p)[k].title}`, kind: 'video' }
  const c = /^clips\/([^/]+)$/.exec(rel)?.[1]
  if (c && p.clips?.[c]) return { label: p.clips[c].title, kind: 'clip' }
  return { label: rel.split('/').pop()!, kind: kindByName(rel) ?? 'other' }
}
