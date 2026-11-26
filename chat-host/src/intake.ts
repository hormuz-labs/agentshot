// add_video: a file from a link into the person's cloud space. The hosted server fetches what people name, so it must
// never be made to reach anything but the public internet: only https, only public addresses, checked as each
// connection is made (so a name can't switch to a private address after a check) and again at each redirect.
import { request } from 'node:https'
import { lookup as dnsLookup } from 'node:dns'
import { isIP, type LookupFunction } from 'node:net'
import type { IncomingMessage } from 'node:http'
import type { Worker } from './worker.ts'
import { upload } from './worker.ts'

const MAX = 4 * 1024 ** 3 // what a worker takes in one file

/** Whether an address is on the public internet (not this machine, a private or carrier network, the mesh, link-local…). */
export function isPublicAddress(ip: string): boolean {
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.(\d+)\.(\d+)$/i.exec(ip)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19)))
  }
  if (isIP(ip) !== 6) return false
  const s = ip.toLowerCase()
  // ::, ::1, and IPv4 inside IPv6 (mapped, compatible, NAT64) could be any IPv4 address: none of them
  if (s.startsWith('::') || s.startsWith('64:ff9b:')) return false
  return !/^(fc|fd|fe[89ab]|ff)/.test(s.replace(/^0+/, ''))
}

/** A name the worker takes (the bridge's rule): from the link's disposition or path, else video.mp4. */
export function nameOf(url: URL, disposition: string | null) {
  const given = disposition && /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition)?.[1]
  let raw = given || ''
  if (!raw) { try { raw = decodeURIComponent(url.pathname) } catch { raw = url.pathname } }
  const name = raw.split(/[\\/]/).pop()!.replace(/[\x00-\x1f:]/g, '').replace(/^\.+/, '').slice(0, 180).trim()
  return name || 'video.mp4'
}

type Options = { isPublic?: (ip: string) => boolean; insecure?: boolean; maxRedirects?: number }

/** The file at [link]: its name, size and bytes, to pass on as they arrive. */
export async function fetchFile(link: string, o: Options = {}): Promise<{ name: string; size: number; type?: string; body: IncomingMessage }> {
  const isPublic = o.isPublic ?? isPublicAddress
  // every connection checks where it is going, after the name is looked up
  const lookup: LookupFunction = (host, opts, done) => dnsLookup(host, { ...opts, all: true }, (err, all) => {
    if (err) return done(err, '', 0)
    const list = all as unknown as { address: string; family: number }[]
    const bad = list.find(a => !isPublic(a.address))
    if (bad || !list.length) return done(new Error('That link isn’t on the public internet.'), '', 0)
    if ((opts as { all?: boolean }).all) return (done as unknown as (e: null, a: typeof list) => void)(null, list)
    done(null, list[0].address, list[0].family)
  })
  let url: URL
  try { url = new URL(link) } catch { throw new Error('That isn’t a link.') }
  for (let hop = 0; hop <= (o.maxRedirects ?? 5); hop++) {
    if (url.protocol !== 'https:') throw new Error('Give an https link.')
    if (isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublic(url.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That link isn’t on the public internet.')
    const res = await new Promise<IncomingMessage>((ok, fail) => {
      const req = request(url, { method: 'GET', lookup, agent: false, timeout: 60_000, rejectUnauthorized: !o.insecure, headers: { 'user-agent': 'AgentShot' } }, ok)
      req.on('timeout', () => req.destroy(new Error('The link took too long to answer.')))
      req.on('error', fail)
      req.end()
    })
    const status = res.statusCode || 0
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume()
      url = new URL(res.headers.location, url)
      continue
    }
    if (status !== 200) { res.resume(); throw new Error(`The link answered ${status}.`) }
    const size = Number(res.headers['content-length'])
    if (!Number.isSafeInteger(size) || size <= 0) { res.destroy(); throw new Error('The link doesn’t say the file’s size, so it can’t be brought in.') }
    if (size > MAX) { res.destroy(); throw new Error('The file is over 4 GB, more than AgentShot takes at once.') }
    return { name: nameOf(url, (res.headers['content-disposition'] as string | undefined) ?? null), size, type: res.headers['content-type'], body: res }
  }
  throw new Error('The link redirects too many times.')
}

/** add_video: the file at [link] into the person's space, as a new project or into [dir]. */
export async function addVideo(worker: Worker, link: string, dir?: string, o: Options = {}) {
  const file = await fetchFile(link, o)
  const made = await upload(worker, file.name, file.size, file.body, dir) as { dir?: string; title?: string }
  if (typeof made?.dir !== 'string') throw new Error('AgentShot didn’t make a project of it.')
  return { dir: made.dir, ...(made.title ? { title: made.title } : {}) }
}
