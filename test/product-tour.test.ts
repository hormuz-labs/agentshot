import { describe, expect, it } from 'vitest'
import { productTourSteps } from '../src/renderer/src/lib/product-tour'

const content = (phase: 'home' | 'editor', platform: string, ready = true) =>
  productTourSteps(phase, platform, ready).map(s => `${s.popover?.title} ${s.popover?.description}`).join('\n')

describe('platform-specific first-run guidance', () => {
  it('shows macOS and Command shortcuts to Mac users', () => {
    expect(content('home', 'MacIntel')).toContain('macOS')
    const editor = content('editor', 'MacIntel')
    for (const shortcut of ['⌘Z', '⌘E', '⌘K']) expect(editor).toContain(shortcut)
    expect(editor).not.toContain('Ctrl+')
  })

  it('shows Linux and Control shortcuts on both Linux architectures', () => {
    for (const platform of ['Linux x86_64', 'Linux aarch64']) {
      expect(content('home', platform)).toContain('Linux')
      const editor = content('editor', platform)
      for (const shortcut of ['Ctrl+Z', 'Ctrl+E', 'Ctrl+K']) expect(editor).toContain(shortcut)
      expect(editor).not.toContain('⌘')
    }
  })

  it('explains how to connect a key when the editing assistant is not ready', () => {
    const home = content('home', 'Linux x86_64', false)
    expect(home).toContain('Gemini, Anthropic or OpenAI')
    expect(home).toContain('sign in or paste a key')
    expect(content('editor', 'Linux x86_64', false)).toContain('Connect a key')
  })
})
