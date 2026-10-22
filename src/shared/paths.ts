// Browser-safe filesystem paths and media URLs. The URL authority never contains a drive or UNC server.
export type PathPlatform = 'posix' | 'win32'
const hostPlatform = (): PathPlatform => typeof process !== 'undefined' && process.platform === 'win32' ? 'win32' : 'posix'

/** Convert known Windows/native relative paths to the project's slash-separated storage format. */
export const toPortablePath = (path: string) => path.replace(/\\/g, '/')
export const pathBasename = (path: string) => path.split(/[\\/]/).at(-1) || ''

/** A filesystem-safe slug, including Windows device names (even when created on another OS). */
export function filesystemSlug(name: string, fallback = 'project', limit = 40): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, limit).replace(/^-+|-+$/g, '') || fallback
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(slug) ? `${slug}-file` : slug
}

/** Absolute path -> hierarchical URL, so a clip's relative images/styles resolve beside its HTML. */
export function encodeMediaPath(path: string, platform: PathPlatform = /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(path) ? 'win32' : 'posix'): string {
  if (path.includes('\0')) throw new Error('Invalid media path')
  let parts: string[]
  if (platform === 'win32') {
    const portable = toPortablePath(path)
    if (/^[a-z]:\//i.test(portable)) parts = ['drive', ...portable.split('/')]
    else if (/^\/\/[^/]+\/[^/]+/.test(portable) && !/^\/\/[?.]\//.test(portable)) parts = ['unc', ...portable.slice(2).split('/')]
    else throw new Error('Media path must be absolute')
  } else {
    if (!path.startsWith('/')) throw new Error('Media path must be absolute')
    parts = ['posix', ...path.slice(1).split('/')]
  }
  return `manul://media/${parts.map(encodeURIComponent).join('/')}`
}

/** URL -> host filesystem absolute path. Authorization/realpath containment belongs to the caller. */
export function decodeMediaPath(input: string | URL, platform: string = hostPlatform()): string {
  const url = typeof input === 'string' ? new URL(input) : input
  if (url.protocol !== 'manul:' || url.host !== 'media' || url.username || url.password) throw new Error('Invalid media URL')
  const [kind, ...parts] = url.pathname.slice(1).split('/').map(decodeURIComponent)
  if (parts.some(p => p.includes('\0') || p.includes('/') || (platform === 'win32' && p.includes('\\')))) throw new Error('Invalid media path')
  if (platform !== 'win32' && kind === 'posix') return '/' + parts.join('/')
  if (platform === 'win32') {
    if (kind === 'drive' && /^[a-z]:$/i.test(parts[0] || '') && parts.length >= 2) return parts.join('\\')
    if (kind === 'unc' && parts.length >= 2 && parts[0] && parts[1] && !parts.slice(0, 2).some(p => /^(\.|\.\.|\?)$/.test(p))) return '\\\\' + parts.join('\\')
  }
  throw new Error('Media URL does not name an absolute path on this platform')
}
