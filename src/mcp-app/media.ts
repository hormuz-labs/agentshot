// Where the editor page's files play from. The film panel asks for a file by its path in the project (as it asks the
// app for manul:// addresses); here that becomes either the file's address on the MCP server (AgentShot on this
// computer, or a hosted server), or, when the chat's frame won't load from there, a copy sent through MCP itself.
import { mediaUrl, relOf } from '../shared/editor-view'

/** A file's copy as data, a piece at a time (the editor_media tool). */
export type Fetch = (rel: string, offset: number) => Promise<{ mime: string; size: number; base64: string }>

export class MediaSource {
  /** Play from the server's address; false once the chat refused it. */
  direct = true
  private copies = new Map<string, string>()
  private asking = new Map<string, Promise<string>>()
  private failed = new Map<string, string>()
  private listeners = new Set<() => void>()

  constructor(private where: () => { dir: string; base: string }, private fetch: Fetch) {}

  /** What the panel plays for [path] (absolute, maybe with ?v=…): an address, a data copy, or '' while it arrives. */
  url = (path: string): string => {
    if (/^(data|blob|https?):/.test(path)) return path
    const { dir, base } = this.where()
    const rel = relOf(dir, path)
    if (!rel) return ''
    if (this.direct) return mediaUrl(base, rel)
    const copy = this.copies.get(rel)
    if (copy) return copy
    void this.copy(rel)
    return ''
  }

  /** Something new arrived (a copy, or the switch to copies): the panel draws again. */
  onChange(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  /** Why a file couldn't be had, for saying so. */
  problem(path: string) { const { dir } = this.where(); const rel = relOf(dir, path); return rel ? this.failed.get(rel) : undefined }

  /** The chat won't load from the address: send everything through MCP from now on. */
  refuse() {
    if (!this.direct) return
    this.direct = false
    this.listeners.forEach(fn => fn())
  }

  /** Whether the chat's frame plays [rel] from the address: a moment's try, before the panel shows. */
  async probe(rel: string, ms = 5000): Promise<boolean> {
    const { base } = this.where()
    const v = document.createElement('video')
    v.muted = true; v.preload = 'metadata'
    const ok = await new Promise<boolean>(done => {
      const t = setTimeout(() => done(false), ms)
      v.onloadedmetadata = () => { clearTimeout(t); done(true) }
      v.onerror = () => { clearTimeout(t); done(false) }
      v.src = mediaUrl(base, rel)
    })
    v.removeAttribute('src'); v.load()
    return ok
  }

  private copy(rel: string) {
    let going = this.asking.get(rel)
    if (going) return going
    going = (async () => {
      const parts: string[] = []
      let offset = 0, size = Infinity, mime = 'application/octet-stream'
      while (offset < size) {
        const piece = await this.fetch(rel, offset)
        const bytes = (piece.base64.length / 4) * 3 - (piece.base64.endsWith('==') ? 2 : piece.base64.endsWith('=') ? 1 : 0)
        mime = piece.mime; size = piece.size
        if (!bytes) break
        parts.push(piece.base64); offset += bytes
      }
      // the panel may add ?v=… to a clip's address: after the #, it can't spoil the data
      const url = `data:${mime};base64,${parts.join('')}#`
      this.copies.set(rel, url)
      this.failed.delete(rel)
      return url
    })()
    this.asking.set(rel, going)
    going.then(() => this.listeners.forEach(fn => fn()), e => { this.failed.set(rel, (e as Error).message); this.listeners.forEach(fn => fn()) })
      .finally(() => this.asking.delete(rel))
    return going
  }
}
