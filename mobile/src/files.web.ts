// files.ts for the browser build (a preview of the app on the Mac): a picked file stays in memory as the Blob the
// browser gave, nothing survives a reload, and there is no share sheet.
import type { Source } from './mac'
import type { Kept, Picked } from './files'

export type { Kept, Picked } from './files'
export const APP_GROUP = ''

const blobs = new Map<string, Blob>()

export function keep(p: Picked): Kept {
  if (!p.file) throw new Error('This browser did not hand over the file.')
  const uri = `blob:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  blobs.set(uri, p.file)
  return { uri, name: p.name, size: p.file.size }
}

export function sourceOf(k: Kept): Source & { close(): void } {
  return {
    name: k.name,
    size: k.size,
    async read(offset, length) {
      const blob = blobs.get(k.uri)
      if (!blob) return new Uint8Array()
      return new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
    },
    close() {},
  }
}

export function discard(k: Kept) { blobs.delete(k.uri) }
export const loadQueue = <T>(): T[] => []
export function saveQueue(_items: unknown[]) {}
export const takeShared = (): Kept[] => []
export const canShare = () => false
