// ZIP support is in-process, including on Windows. Only checksummed downloads reach extraction.
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'

export const sha256 = data => createHash('sha256').update(data).digest('hex')

export async function download(url, expected) {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha256(buf)
  if (got !== expected) throw new Error(`${url}: checksum mismatch (got ${got}); refusing to use it`)
  return buf
}

export function zipFiles(buf, names) {
  const zip = new AdmZip(buf)
  return names.map(name => {
    const entries = zip.getEntries().filter(e => e.entryName === name)
    if (entries.length !== 1 || entries[0].isDirectory) throw new Error(`ZIP layout: expected one file ${name}`)
    return entries[0].getData()
  })
}

export function extractZip(buf, dir) {
  const root = resolve(dir)
  const entries = new AdmZip(buf).getEntries()
  // Validate the entire archive before writing anything (including Windows-style paths on Unix).
  for (const e of entries) {
    const name = e.entryName.replaceAll('\\', '/')
    const dest = resolve(root, name)
    if (/^[/]|^[a-z]:/i.test(name) || name.split('/').includes('..') ||
        !(dest === root || dest.startsWith(root + sep)) || ((e.attr >>> 16) & 0xf000) === 0xa000)
      throw new Error(`Unsafe ZIP entry: ${e.entryName}`)
  }
  for (const e of entries) {
    const dest = resolve(root, e.entryName.replaceAll('\\', '/'))
    mkdirSync(e.isDirectory ? dest : dirname(dest), { recursive: true })
    if (!e.isDirectory) writeFileSync(dest, e.getData())
  }
}
