// Footage on the phone, on its way to the Mac. What waits to be sent is kept in the app's documents (outbox/), so it
// survives the app being closed; the share extension ("Send to Manul", targets/share) leaves what it was given in
// the app group's share/ folder for the app to pick up. The browser build has its own (files.web.ts).
import { Directory, File, Paths, type FileHandle } from 'expo-file-system'
import type { Source } from './mac'

/** Shared with the share extension: app.json's ios.entitlements and targets/share/ShareViewController.swift. */
export const APP_GROUP = 'group.com.hormuzlabs.manul.mobile'

/** A file waiting to be sent: where it is on the phone, its name, its size. */
export type Kept = { uri: string; name: string; size: number }
/** A file from the camera, the photo library or the share sheet. `file` is only there in a browser. */
export type Picked = { uri: string; name: string; file?: Blob }

const outbox = () => new Directory(Paths.document, 'outbox')
const queueFile = () => new File(Paths.document, 'outbox.json')

/** Into the outbox, each file in a folder of its own so names never clash. */
export function keep(p: Picked): Kept {
  const dir = new Directory(outbox(), Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
  dir.create({ intermediates: true })
  const f = new File(p.uri)
  f.move(new File(dir, p.name.replace(/[/\\:]/g, '-') || 'clip.mov'))
  return { uri: f.uri, name: f.name, size: f.size }
}

export function sourceOf(k: Kept): Source & { close(): void } {
  let handle: FileHandle | null = null
  return {
    name: k.name,
    size: k.size,
    async read(offset, length) {
      handle ??= new File(k.uri).open()
      handle.offset = offset
      return handle.readBytes(length)
    },
    close() { handle?.close(); handle = null },
  }
}

export function discard(k: Kept) {
  try { new File(k.uri).parentDirectory.delete() } catch { /* already gone */ }
}

export function loadQueue<T>(): T[] {
  try { return JSON.parse(queueFile().textSync()) } catch { return [] }
}
export function saveQueue(items: unknown[]) {
  try { queueFile().write(JSON.stringify(items)) } catch (e) { console.warn('outbox', e) }
}

/** What the share extension left, moved into the outbox. It writes each share into a hidden folder and renames it
 *  when every file is in, so a share still being written is left for next time. */
export function takeShared(): Kept[] {
  const group = Paths.appleSharedContainers[APP_GROUP]
  const share = group && new Directory(group, 'share')
  if (!share?.exists) return []
  const out: Kept[] = []
  for (const batch of share.list()) {
    if (!(batch instanceof Directory) || batch.name.startsWith('.')) continue
    for (const f of batch.list()) if (f instanceof File && !f.name.startsWith('.')) out.push(keep({ uri: f.uri, name: f.name }))
    batch.delete()
  }
  return out
}

/** Whether this build can take files from the share sheet. */
export const canShare = () => !!Paths.appleSharedContainers[APP_GROUP]
