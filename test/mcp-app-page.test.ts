// The editor page as Claude and ChatGPT get it: AgentShot's own film panel built into one self-contained HTML file
// (scripts/build-mcp-app.mjs).
import { describe, expect, it } from 'vitest'
// @ts-expect-error a plain .mjs build script
import { buildEditorPage } from '../scripts/build-mcp-app.mjs'

describe('the editor page', () => {
  let html = ''
  it('is one file: script, styles and fonts inline, nothing loaded from anywhere', async () => {
    const was = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try { html = await buildEditorPage() } finally { process.env.NODE_ENV = was }
    expect(process.env.NODE_ENV).toBe(was)
    expect(html).toMatch(/^<!doctype html>/i)
    expect(html.match(/<script type="module">/g)).toHaveLength(1)
    const outside = html.replace(/<script type="module">[\s\S]*<\/script>/, '').replace(/<style>[\s\S]*<\/style>/, '')
    expect(outside).not.toMatch(/<script|<link|src=|href=/)
    expect(html).not.toContain('is deprecated in plain JavaScript React classes') // React's production build
    expect(html).not.toContain('jsxDEV') // and JSX built for it, even when NODE_ENV says otherwise (npm run dev)
    expect(html).toContain('<style>')
    expect(html).not.toMatch(/url\((?!["']?data:)[^)]*\.(woff2?|ttf|png|svg)/) // fonts and pictures are data
    expect(html.length).toBeLessThan(3 * 1024 * 1024)
  }, 180_000)

  it('is the app’s film panel, speaking MCP Apps', () => {
    for (const s of ['ui/initialize', 'ui/message', 'editor_call', 'editor_view', 'editor_media', 'Move clip', 'Voiceover', 'Split', 'Proposed:', 'timeline-filmstrip']) expect(html, s).toContain(s)
  })
})
