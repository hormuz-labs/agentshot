// Light (the default), dark, or whatever the system uses. The page keeps the choice to paint the first frame right;
// the main process keeps it too, for the window behind the page and the native menus.
import { useEffect, useState } from 'react'

export type Theme = 'light' | 'dark' | 'system'
const KEY = 'manul.theme'
const dark = matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<(t: Theme) => void>()

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === 'dark' || t === 'system' ? t : 'light' } catch { return 'light' }
}

const paint = (t: Theme) => document.documentElement.classList.toggle('dark', t === 'dark' || (t === 'system' && dark.matches))

/** Paint the saved theme (before the first render), and follow the system while it's 'system'. */
export function startTheme() {
  paint(getTheme())
  dark.addEventListener('change', () => { if (getTheme() === 'system') paint('system') })
  window.manul.theme.set(getTheme())
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
  paint(t)
  window.manul.theme.set(t)
  listeners.forEach(fn => fn(t))
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, set] = useState(getTheme)
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set) } }, [])
  return [t, setTheme]
}
