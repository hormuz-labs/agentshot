import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { encodeMediaPath } from '../../../shared/paths'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** 75.3 → "1:15.3" */
export const timecode = (s: number, tenths = true) => {
  if (!Number.isFinite(s)) s = 0
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${(tenths ? sec.toFixed(1) : Math.floor(sec).toString()).padStart(tenths ? 4 : 2, '0')}`
}

/** File path → manul:// URL served by the main process (with Range support). */
export const mediaUrl = encodeMediaPath

/** Typing in a field: keys and menu commands are its own (undo is the field's). */
export const typing = () => !!(document.activeElement as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]')

/** On a Mac (the window's own buttons sit at the top left). */
export const MAC = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac')
