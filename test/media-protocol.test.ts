import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeMediaPath } from '../src/shared/paths'
import { serveMedia } from '../src/main/media-protocol'

const tmp = mkdtempSync(join(tmpdir(), 'manul-protocol-'))
const project = join(tmp, 'project [edit]')
const lib = join(tmp, 'lib')
mkdirSync(project); mkdirSync(lib)
const media = join(project, 'film #1 %.mp4')
writeFileSync(media, '0123456789')
writeFileSync(join(project, 'clip.html'), '<img src="poster.jpg">')
writeFileSync(join(project, 'poster.jpg'), 'image')
writeFileSync(join(lib, 'clip-runtime.js'), 'runtime')
writeFileSync(join(tmp, 'secret.txt'), 'secret')
afterAll(() => rmSync(tmp, { recursive: true, force: true }))
const serve = (url: string, range?: string) => serveMedia(new Request(url, { headers: range ? { range } : {} }), lib, [project])

describe('media protocol', () => {
  it('serves encoded native paths, including punctuation, with content headers', async () => {
    const response = serve(encodeMediaPath(media))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('video/mp4')
    expect(response.headers.get('content-length')).toBe('10')
    expect(await response.text()).toBe('0123456789')
  })
  it.each([['bytes=2-5', '2345', 'bytes 2-5/10'], ['bytes=7-', '789', 'bytes 7-9/10'], ['bytes=-3', '789', 'bytes 7-9/10'], ['bytes=-50', '0123456789', 'bytes 0-9/10']])('supports %s', async (range, body, header) => {
    const response = serve(encodeMediaPath(media), range)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-range')).toBe(header)
    expect(await response.text()).toBe(body)
  })
  it.each(['bytes=10-', 'bytes=6-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'bytes=999999999999999999999-'])('rejects invalid range %s without crashing', range => {
    expect(serve(encodeMediaPath(media), range).status).toBe(416)
  })
  it('restricts clip HTML and permits relative assets and bundled libraries', async () => {
    const html = encodeMediaPath(join(project, 'clip.html'))
    const response = serve(html)
    expect(response.headers.get('content-security-policy')).toContain('connect-src manul:')
    expect(await response.text()).toContain('poster.jpg')
    expect(await serve(new URL('poster.jpg', html).href).text()).toBe('image')
    expect(await serve('manul://lib/clip-runtime.js').text()).toBe('runtime')
  })
  it.each(['manul://unknown/posix/tmp/file', 'manul://media/posix/%', 'manul://lib/../secret.txt'])('fails closed for malformed or unauthorized URL %s', url => {
    expect(serve(url).status).toBe(404)
  })
  it('rejects outside files, directories, missing files, and sibling prefixes', () => {
    expect(serve(encodeMediaPath(join(tmp, 'secret.txt'))).status).toBe(404)
    expect(serve(encodeMediaPath(project)).status).toBe(404)
    expect(serve(encodeMediaPath(join(project, 'missing.mp4'))).status).toBe(404)
  })
  it('does not serve through an escaping symlink or Windows junction', () => {
    const link = join(project, 'outside')
    symlinkSync(tmp, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(serve(encodeMediaPath(join(link, 'secret.txt'))).status).toBe(404)
  })
})
