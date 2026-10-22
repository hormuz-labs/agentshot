// What's attached to each project's next message (paths in the project: files, versions' renders, motion clips).
// Shared by the message box and the files in the sidebar's project tree.
import { useSyncExternalStore } from 'react'

const byDir = new Map<string, string[]>()
const subs = new Set<() => void>()
const NONE: string[] = []
const set = (dir: string, rels: string[]) => { byDir.set(dir, rels); subs.forEach(f => f()) }

export const attachFiles = (dir: string, rels: string[]) => set(dir, [...new Set([...(byDir.get(dir) || []), ...rels])])
export const detachFiles = (dir: string, rels: string[]) => set(dir, (byDir.get(dir) || []).filter(r => !rels.includes(r)))
export const clearAttached = (dir: string) => set(dir, [])

export function useAttached(dir: string): string[] {
  return useSyncExternalStore(f => { subs.add(f); return () => subs.delete(f) }, () => byDir.get(dir) || NONE)
}

/** Copy files, folders or .zips into the project, and attach what came in to the next message. */
export async function addFiles(dir: string, paths: string[]) {
  for (const f of paths) {
    try { attachFiles(dir, await window.manul.project.import(dir, f)) } catch (e) { alert((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
  }
}
export const pickFiles = async (dir: string) => addFiles(dir, await window.manul.project.pickFiles())
