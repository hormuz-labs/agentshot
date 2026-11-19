// Version-pinned media reads for the phone. A render may replace a path between any two requests.
import { createHash, randomBytes } from 'node:crypto'
import { open } from 'node:fs/promises'
import type { BigIntStats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname } from 'node:path'
import { pipeline } from 'node:stream/promises'

const epoch = randomBytes(16).toString('hex')
const version = (s: BigIntStats) => `"${createHash('sha256').update(`${epoch}:${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`).digest('hex')}"`
const mime: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
export const MAX_MEDIA_BLOCK = 4 * 1024 * 1024

export function mediaRange(value: string, size: number): { start: number; end: number } | undefined {
  const m = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!m || (!m[1] && !m[2]) || size === 0) return
  const a = m[1] ? Number(m[1]) : undefined, b = m[2] ? Number(m[2]) : undefined
  if ((a !== undefined && !Number.isSafeInteger(a)) || (b !== undefined && !Number.isSafeInteger(b))) return
  if (a === undefined && !b) return
  const start = a ?? Math.max(0, size - b!), end = a === undefined ? size - 1 : Math.min(b ?? size - 1, size - 1)
  if (start > end || start >= size) return
  return { start, end }
}

export async function serveMobileMedia(req: IncomingMessage, res: ServerResponse, file: string) {
  const handle = await open(file, 'r')
  try {
    const info = await handle.stat({ bigint: true }), tag = version(info), size = Number(info.size)
    if (!Number.isSafeInteger(size)) { res.writeHead(413); res.end(); return }
    res.setHeader('etag', tag)
    res.setHeader('last-modified', new Date(Number(info.mtimeMs)).toUTCString())
    res.setHeader('content-type', mime[extname(file).toLowerCase()] || 'application/octet-stream')
    res.setHeader('accept-ranges', 'bytes')
    res.setHeader('cache-control', 'private, no-cache')
    res.setHeader('x-agentshot-range-cache', '1')
    const matches = (value: string) => value.split(',').some(v => v.trim() === tag || v.trim() === '*')
    if (req.headers['if-match'] && !matches(req.headers['if-match'])) { res.writeHead(412); res.end(); return }
    if (req.headers['if-none-match'] && matches(req.headers['if-none-match'].replace(/W\//g, ''))) { res.writeHead(304); res.end(); return }
    const block = req.headers['x-agentshot-range-cache'] === '1' && req.method === 'GET'
    const rangeHeader = req.method === 'HEAD' ? undefined : req.headers.range
    const useRange = rangeHeader && (!req.headers['if-range'] || req.headers['if-range'] === tag)
    const range = useRange ? mediaRange(rangeHeader, size) : undefined
    if (useRange && !range) { res.writeHead(416, { 'content-range': `bytes */${size}` }); res.end(); return }
    if (block && (!range || !/^bytes=\d+-\d+$/.test(rangeHeader || '') || req.headers['if-match'] !== tag || range.end - range.start + 1 > MAX_MEDIA_BLOCK)) {
      res.writeHead(400); res.end(); return
    }
    const start = range?.start ?? 0, end = range?.end ?? size - 1, length = Math.max(0, end - start + 1)
    // Read and re-stat a bounded block before sending headers. In-place rewrites fail the precondition;
    // atomic replacements keep reading the same opened inode. Never return a partial/mixed block as valid.
    let bytes: Buffer | undefined
    if (block) {
      bytes = Buffer.allocUnsafe(length)
      let offset = 0
      while (offset < length) {
        const { bytesRead } = await handle.read(bytes, offset, length - offset, start + offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== length || version(await handle.stat({ bigint: true })) !== tag) { res.writeHead(412); res.end(); return }
    }
    if (range) { res.statusCode = 206; res.setHeader('content-range', `bytes ${start}-${end}/${size}`) }
    res.setHeader('content-length', String(length))
    if (req.method === 'HEAD' || !length) { res.end(); return }
    if (bytes) { res.end(bytes); return }
    await pipeline(handle.createReadStream({ start, end, autoClose: false }), res)
  } finally { await handle.close() }
}
