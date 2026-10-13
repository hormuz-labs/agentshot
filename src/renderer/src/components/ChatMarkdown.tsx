import type { ReactNode } from 'react'

// Safe React elements only, never raw HTML. Supports the editor's concise Markdown replies and streaming text.
export function markdownInline(text: string): ReactNode[] {
  const out: ReactNode[] = [], re = /(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index! > at) out.push(text.slice(at, m.index))
    const key = `${m.index}`
    out.push(m[2] ? <strong key={key} className="font-semibold">{m[2]}</strong> : m[3] ? <code key={key} className="rounded bg-raised px-1 font-mono text-[.85em]">{m[3]}</code> : <em key={key}>{m[4]}</em>)
    at = m.index! + m[0].length
  }
  if (at < text.length) out.push(text.slice(at))
  return out
}
export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split('\n'), blocks: ReactNode[] = []
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    if (/^\s*[-*]\s+/.test(lines[i])) {
      const items: ReactNode[] = [], start = i
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(<li key={i}>{markdownInline(lines[i].replace(/^\s*[-*]\s+/, ''))}</li>); i++ }
      i--; blocks.push(<ul key={start} className="list-disc space-y-1 pl-5">{items}</ul>); continue
    }
    if (/^#{1,3}\s/.test(lines[i])) { blocks.push(<div key={i} className="font-semibold">{markdownInline(lines[i].replace(/^#{1,3}\s+/, ''))}</div>); continue }
    const paragraph = [lines[i]], start = i
    while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*(?:[-*]\s|#{1,3}\s)/.test(lines[i + 1])) paragraph.push(lines[++i])
    blocks.push(<p key={start} className="whitespace-pre-wrap">{markdownInline(paragraph.join('\n'))}</p>)
  }
  return <div data-chat-markdown className="space-y-3 font-serif text-[16px] leading-7 text-fg" data-selectable>{blocks}</div>
}
