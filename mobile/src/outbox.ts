// Footage on its way to the Mac, one file at a time, straight over the Wi-Fi (MacClient.upload). The list is kept on
// the phone (files.ts), so an upload cut short by a drop, by the phone sleeping or by the app being closed carries on
// from where the Mac got to. Once a file is in the project it waits in the chat, attached to the next message.
import { useSyncExternalStore } from 'react'
import type { RemoteProject } from '../../src/shared/remote'
import { discard, keep, loadQueue, saveQueue, sourceOf, type Kept, type Picked } from './files'
import type { MacClient } from './mac'

export type Item = Kept & {
  id: string
  /** the paired Mac it goes to */
  mac: string
  project: string
  projectTitle: string
  /** the Mac's id for it, once it has one */
  upload?: string
  received: number
  state: 'waiting' | 'sending' | 'done' | 'failed'
  error?: string
  /** where it landed in the project (media/…) */
  files?: string[]
}

let items: Item[] = loadQueue<Item>().map(i => (i.state === 'sending' ? { ...i, state: 'waiting' } : i))
const listeners = new Set<() => void>()
let client: MacClient | null = null
let current: { id: string; stop: AbortController } | null = null

function set(next: Item[], persist = true) {
  items = next
  if (persist) saveQueue(items)
  listeners.forEach(l => l())
}
const patch = (id: string, p: Partial<Item>, persist = true) => set(items.map(i => (i.id === id ? { ...i, ...p } : i)), persist)

export const outbox = {
  /** Send these into a project: they're moved into the outbox first, so the camera roll's copies can go. */
  add(project: RemoteProject, picked: (Picked | Kept)[]) {
    if (!client) return
    const mac = client.mac.id
    const added = picked.map((p): Item => ({
      ...('size' in p ? p : keep(p)), id: Math.random().toString(36).slice(2), mac, project: project.id, projectTitle: project.title, received: 0, state: 'waiting',
    }))
    set([...items, ...added])
    void run()
  },
  retry(id: string) { patch(id, { state: 'waiting', error: undefined }); void run() },
  /** Stop it and let it go, on the phone and on the Mac. */
  remove(id: string) {
    const it = items.find(i => i.id === id)
    if (!it) return
    if (current?.id === id) current.stop.abort()
    if (it.upload && it.state !== 'done') client?.cancelUpload(it.upload).catch(() => {})
    discard(it)
    set(items.filter(i => i.id !== id))
  },
  /** These went with a message: done with them. */
  sent(ids: string[]) { set(items.filter(i => !ids.includes(i.id))) },
  /** The Mac to send to. */
  use(c: MacClient | null) {
    client = c
    void run()
  },
  /** Unpaired: what was waiting for that Mac goes. */
  forget() {
    client = null
    current?.stop.abort()
    items.forEach(discard)
    set([])
  },
}

export function useOutbox(project?: string) {
  const all = useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb) }, () => items)
  return project ? all.filter(i => i.project === project) : all
}

async function run() {
  if (current || !client) return
  const c = client
  const it = items.find(i => i.state === 'waiting' && i.mac === c.mac.id)
  if (!it) return
  const stop = new AbortController()
  current = { id: it.id, stop }
  patch(it.id, { state: 'sending' })
  const src = sourceOf(it)
  try {
    const done = await c.upload(it.project, src, {
      upload: it.upload,
      signal: stop.signal,
      onStart: upload => patch(it.id, { upload }),
      onProgress: received => patch(it.id, { received }, false),
    })
    src.close()
    discard(it) // the Mac has it now
    patch(it.id, { state: 'done', received: done.size, files: done.files })
  } catch (e) {
    src.close()
    if (!stop.signal.aborted) patch(it.id, { state: 'failed', error: (e as Error).message })
  } finally {
    current = null
  }
  void run()
}
