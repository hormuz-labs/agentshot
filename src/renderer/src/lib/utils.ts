import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { encodeMediaPath } from '../../../shared/paths'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** 75.3 → "1:15.3" */
export const timecode = (s: number, tenths = true) => {
  if (!Number.isFinite(s) || s < 0) s = 0
  // round (or floor) once, on the whole, so 59.96 s reads 1:00.0 rather than 0:60.0
  const tenthsTotal = tenths ? Math.round(s * 10) : Math.floor(s) * 10
  const h = Math.floor(tenthsTotal / 36000)
  const m = Math.floor(tenthsTotal / 600) % 60
  const sec = (tenthsTotal % 600) / 10
  const ss = (tenths ? sec.toFixed(1) : String(sec)).padStart(tenths ? 4 : 2, '0')
  // an hour or more reads h:mm:ss, so a 3-hour film doesn't say 180:00
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

let mediaResolver: ((path: string) => string) | undefined
/** File path → manul:// URL served by the main process (with Range support). The editor inside a chat (src/mcp-app)
 *  has no main process beside it, so it plays the same files from where its MCP server says they are. */
export const mediaUrl = (path: string) => (mediaResolver ? mediaResolver(path) : encodeMediaPath(path))
/** Where files play from outside the app window (src/mcp-app). */
export const setMediaResolver = (fn: ((path: string) => string) | undefined) => { mediaResolver = fn }

/** Typing in a field: keys and menu commands are its own (undo is the field's). */
export const typing = () => !!(document.activeElement as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')

/** On a Mac (the window's own buttons sit at the top left). */
export const MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
/** What showing a file where it lives is called here: Finder on a Mac, a folder elsewhere. */
export const REVEAL = MAC ? 'Show in Finder' : 'Show in folder'
/** The same, for one named file. */
export const revealLabel = (name: string) => (MAC ? `Show ${name} in Finder` : `Show ${name} in folder`)
