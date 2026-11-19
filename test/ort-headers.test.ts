import { afterEach, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { fetchHeaders } from '../scripts/fetch-ort-headers.mjs'

const folders: string[] = []
afterEach(() => { vi.unstubAllGlobals(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-ort-')); folders.push(dir)
  const zip = new AdmZip(), data = Buffer.from('verified C ABI header')
  zip.addFile('include/api.h', data)
  zip.addFile('unexpected.txt', Buffer.from('not a header'))
  const bytes = zip.toBuffer()
  const download = vi.fn(async () => new Response(bytes))
  vi.stubGlobal('fetch', download)
  return { dir, download, source: { url: 'https://headers.test/ort.zip', sha256: sha(bytes), prefix: 'include/', headers: { 'api.h': sha(data) } } }
}
it('extracts only verified headers and reuses a verified cache', async () => {
  const { dir, download, source } = fixture()
  await fetchHeaders(dir, source)
  expect(readFileSync(join(dir, 'api.h'), 'utf8')).toBe('verified C ABI header')
  expect(existsSync(join(dir, 'unexpected.txt'))).toBe(false)
  await fetchHeaders(dir, source)
  expect(download).toHaveBeenCalledTimes(1)
})
it('rejects archive checksum drift', async () => {
  const { dir, source } = fixture()
  await expect(fetchHeaders(dir, { ...source, sha256: '0'.repeat(64) })).rejects.toThrow('archive checksum mismatch')
  expect(existsSync(join(dir, 'api.h'))).toBe(false)
})
it('verifies all members before writing any header', async () => {
  const { dir, source } = fixture()
  await expect(fetchHeaders(dir, { ...source, headers: { ...source.headers, 'missing.h': '0'.repeat(64) } })).rejects.toThrow('missing missing.h')
  expect(existsSync(join(dir, 'api.h'))).toBe(false)
  await expect(fetchHeaders(dir, { ...source, headers: { 'api.h': '0'.repeat(64) } })).rejects.toThrow('checksum mismatch for api.h')
})
