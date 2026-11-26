// add_video: a video from a link into the person's space (chat-host/src/intake.ts). Only https, only public addresses
// (never the cluster's own services), at most a few redirects, a size given and within the worker's limit.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer, type Server } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { isPublicAddress, fetchFile, nameOf } from '../chat-host/src/intake'

describe('which addresses may be fetched', () => {
  it('only public ones: never this machine, the private networks, the mesh or link-local', () => {
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::6810:84e5']) expect(isPublicAddress(ip), ip).toBe(true)
    for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.7', '100.127.1.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::', '::7f00:1', '64:ff9b::a00:1'])
      expect(isPublicAddress(ip), ip).toBe(false)
  })
})

describe('a file’s name', () => {
  it('comes from the link, made safe for the worker', () => {
    expect(nameOf(new URL('https://x.test/a/My%20Talk.mp4?sig=1'), null)).toBe('My Talk.mp4')
    expect(nameOf(new URL('https://x.test/download'), 'attachment; filename="clip one.mov"')).toBe('clip one.mov')
    expect(nameOf(new URL('https://x.test/'), null)).toBe('video.mp4')
    expect(nameOf(new URL('https://x.test/..%2F..%2Fetc%2Fpasswd'), null)).toBe('passwd')
    expect(nameOf(new URL('https://x.test/.hidden'), null)).toBe('hidden')
  })
})

let server: Server | undefined, dir: string | undefined
afterEach(() => { server?.close(); server = undefined; if (dir) rmSync(dir, { recursive: true, force: true }); dir = undefined })

/** An https server on this machine; the tests let it count as public (its address is 127.0.0.1). */
async function site(handler: Parameters<typeof createServer>[1]) {
  dir = mkdtempSync(join(tmpdir(), 'intake-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' })
  server = createServer({ key: readFileSync(join(dir, 'k.pem')), cert: readFileSync(join(dir, 'c.pem')) }, handler)
  await new Promise<void>(ok => server!.listen(0, '127.0.0.1', ok))
  return `https://localhost:${(server.address() as { port: number }).port}`
}
const trustLocal = { isPublic: () => true, insecure: true }

describe('fetching the file', () => {
  it('gives its name, size and bytes', async () => {
    const at = await site((_req, res) => { res.writeHead(200, { 'content-length': '5', 'content-type': 'video/mp4' }).end('hello') })
    const got = await fetchFile(`${at}/talk.mp4`, trustLocal)
    expect(got).toMatchObject({ name: 'talk.mp4', size: 5 })
    const chunks: Buffer[] = []; for await (const c of got.body) chunks.push(c as Buffer)
    expect(Buffer.concat(chunks).toString()).toBe('hello')
  })

  it('refuses a private address, even one a public name points to', async () => {
    const at = await site((_req, res) => { res.writeHead(200, { 'content-length': '1' }).end('x') })
    await expect(fetchFile(`${at}/talk.mp4`, { insecure: true })).rejects.toThrow(/public/)
  })

  it('follows a few redirects, checking each place', async () => {
    let hops = 0
    const at = await site((req, res) => {
      if (req.url === '/final.mp4') return res.writeHead(200, { 'content-length': '2' }).end('ok')
      hops++; res.writeHead(302, { location: hops > 9 ? '/final.mp4' : `/hop${hops}` }).end()
    })
    await expect(fetchFile(`${at}/start`, trustLocal)).rejects.toThrow(/redirect/i)
    hops = 8
    expect((await fetchFile(`${at}/start`, trustLocal)).size).toBe(2)
  })

  it('refuses http, no size, too big, and what isn’t there', async () => {
    const at = await site((req, res) => {
      if (req.url === '/nosize') { res.writeHead(200, { 'transfer-encoding': 'chunked' }); res.write('a'); return res.end() }
      if (req.url === '/huge') return res.writeHead(200, { 'content-length': String(5 * 1024 ** 3) }).end()
      res.writeHead(404).end()
    })
    await expect(fetchFile('http://example.com/a.mp4', trustLocal)).rejects.toThrow(/https/)
    await expect(fetchFile(`${at}/nosize`, trustLocal)).rejects.toThrow(/size/)
    await expect(fetchFile(`${at}/huge`, trustLocal)).rejects.toThrow(/4 GB/)
    await expect(fetchFile(`${at}/missing`, trustLocal)).rejects.toThrow(/404/)
  })
})

void vi
