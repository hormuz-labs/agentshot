import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ChatMarkdown } from '../src/renderer/src/components/ChatMarkdown'

const render = (text: string, dir?: string, files?: string[]) => renderToStaticMarkup(createElement(ChatMarkdown, { text, dir, files }))

describe('chat artifact rendering', () => {
  it('renders one downloadable preview for repeated links and known backtick references', () => {
    const html = render('[Cover](renders/cover.png)\n![Preview](renders/cover.png)\n`renders/cover.png`', '/project', ['renders/cover.png'])
    expect(html.match(/data-artifact=/g)).toHaveLength(1)
    expect(html).toContain('alt="cover.png"')
    expect(html).toContain('aria-label="Download cover.png"')
    expect(html).toContain('aria-label="Show cover.png in folder"')
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain('href="renders/cover.png"')
  })

  it('renders document cards without image previews', () => {
    const html = render('[Report](<documents/my report.pdf>)', '/project')
    expect(html).toContain('data-artifact="documents/my report.pdf"')
    expect(html).toContain('Download my report.pdf')
    expect(html).not.toContain('<img')
  })

  it('does not render artifacts without project context or for unknown code references', () => {
    expect(render('[Report](outputs/report.pdf)')).not.toContain('data-artifact=')
    expect(render('`outputs/unknown.pdf`', '/project')).not.toContain('data-artifact=')
  })

  it('keeps web links external while escaping HTML and refusing unsafe file links', () => {
    const html = render('[Web](https://example.com) [Bad](javascript:alert) [Outside](../secret.pdf) <script>alert(1)</script>', '/project')
    expect(html).toContain('target="_blank" rel="noreferrer"')
    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('data-artifact=')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})
