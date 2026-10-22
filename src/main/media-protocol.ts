import { createReadStream, realpathSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { Readable } from 'node:stream'
import { decodeMediaPath } from '../shared/paths'
import { isWithinDir } from './paths'

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf' }
const CLIP_CSP = "default-src manul: data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src manul: data: blob:"

/** Both normal playback and offscreen clips use the same authorized, range-aware protocol. */
export function serveMedia(req: Request, lib: string, projectRoots: string[], gallery?: string): Response {
  let file: string
  let size: number
  try {
    const url = new URL(req.url)
    if (url.protocol !== 'manul:' || url.username || url.password) throw new Error('Invalid URL')
    const fixed = url.host === 'lib' ? lib : url.host === 'gallery' && gallery ? gallery : null
    file = realpathSync(fixed ? join(fixed, decodeURIComponent(url.pathname).replace(/^\/+/, '')) : decodeMediaPath(url))
    const roots = fixed ? [fixed] : projectRoots
    if (!roots.some(root => { try { return isWithinDir(realpathSync(root), file) } catch { return false } })) throw new Error('Outside project')
    const stat = statSync(file)
    if (!stat.isFile()) throw new Error('Not a file')
    size = stat.size
  } catch { return new Response('not found', { status: 404 }) }
  const type = MIME[extname(file).toLowerCase()] || 'application/octet-stream'
  const headers: Record<string, string> = { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes', 'access-control-allow-origin': '*' }
  if (type.startsWith('text/html')) headers['content-security-policy'] = CLIP_CSP
  const rangeHeader = req.headers.get('range')
  if (!rangeHeader) return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers })
  const range = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  const start = range?.[1] ? Number(range[1]) : Math.max(0, size - Number(range?.[2]))
  const end = range?.[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } })
  }
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206, headers: { ...headers, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}` },
  })
}
