/** Turn a chat link into a project-relative file, never an external URL or a traversal. */
export function artifactRelative(href: string, dir: string): string | null {
  let path: string
  try { path = decodeURIComponent(href.trim().replace(/^<|>$/g, '')) } catch { return null }
  if (path.startsWith('file://')) path = path.slice(7)
  if (path.startsWith(`${dir}/`)) path = path.slice(dir.length + 1)
  path = path.replace(/^\.\//, '')
  if (!path || path.startsWith('/') || /[\\\u0000-\u001f]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) return null
  if (path.split('/').some(p => !p || p.startsWith('.'))) return null
  return /\.[a-z\d]{1,12}$/i.test(path) ? path : null
}

export function chatArtifacts(text: string, dir: string, files: string[] = []): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)|`([^`\n]+)`/g)) {
    const rel = artifactRelative(match[1] || match[2], dir)
    if (rel && (match[1] || files.includes(rel))) found.add(rel)
  }
  return [...found]
}
