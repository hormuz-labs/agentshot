import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SHORTCUTS, shortcutFor, shown } from '../src/shared/shortcuts'

describe('shortcuts', () => {
  it('reads as a Mac writes them, modifiers in the Mac order', () => {
    expect(shown('CmdOrCtrl+K', true)).toBe('⌘K')
    expect(shown('CmdOrCtrl+Shift+H', true)).toBe('⇧⌘H')
    expect(shown('Shift+CmdOrCtrl+Z', true)).toBe('⇧⌘Z')
    expect(shown('Ctrl+Shift+Tab', true)).toBe('⌃⇧Tab')
    expect(shown('Alt+CmdOrCtrl+P', true)).toBe('⌥⌘P')
    expect(shown('CmdOrCtrl+\\', true)).toBe('⌘\\')
  })

  it('reads as Windows and Linux write them', () => {
    expect(shown('CmdOrCtrl+K', false)).toBe('Ctrl+K')
    expect(shown('Shift+CmdOrCtrl+Z', false)).toBe('Ctrl+Shift+Z')
    expect(shown('Ctrl+Shift+Tab', false)).toBe('Ctrl+Shift+Tab')
    expect(shown('Option+Cmd+P', false)).toBe('Ctrl+Alt+P')
    expect(shown('CmdOrCtrl+.', false)).toBe('Ctrl+.')
  })

  it('gives every command the menu binds a shortcut the palette shows, and none to a command without one', () => {
    expect(shortcutFor('history', true)).toBe('⇧⌘H')
    expect(shortcutFor('agent.stop', false)).toBe('Ctrl+.')
    expect(shortcutFor('tab.3', true)).toBe('⌘3')
    expect(shortcutFor('reveal', true)).toBeUndefined()
  })

  it('never gives two commands the same keys', () => {
    const seen = new Map<string, string>()
    for (const [id, keys] of Object.entries(SHORTCUTS)) {
      const norm = keys.split('+').sort().join('+')
      expect(seen.get(norm), `${id} and ${seen.get(norm)} share ${keys}`).toBeUndefined()
      seen.set(norm, id)
    }
  })

  it('leaves the native menu no shortcut of its own, so menu and palette cannot disagree', () => {
    const menu = readFileSync(new URL('../src/main/menu.ts', import.meta.url), 'utf8')
    // every accelerator in the menu comes from SHORTCUTS
    expect(menu).not.toMatch(/['"`](CmdOrCtrl|Ctrl|Shift|Alt|Cmd)\+/)
    for (const id of ['palette', 'home', 'media', 'export', 'tab.close', 'history', 'browser', 'agent.new', 'agent.focus', 'agent.stop', 'sidebar', 'settings', 'tab.next', 'tab.prev']) {
      expect(menu, `the menu has no item for ${id}`).toContain(`cmd('${id}'`)
    }
  })

  it('leaves the palette no shortcut of its own for a key the menu binds', () => {
    for (const file of ['../src/renderer/src/App.tsx', '../src/renderer/src/views/ProjectView.tsx']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8')
      for (const [, id, keys] of src.matchAll(/\{ id: '([^']+)'[^}]*?shortcut: ([^,}]+)/g)) {
        expect(SHORTCUTS[id], `${id} sets its own shortcut (${keys}) though the menu binds one`).toBeUndefined()
      }
    }
  })
})
