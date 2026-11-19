// Platform-independent C ABI headers from the exact ORT distribution used by
// sherpa-onnx v1.13.8. The original Microsoft source URLs are unavailable.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

export const SOURCE = {
  url: 'https://github.com/csukuangfj/onnxruntime-libs/releases/download/v1.28.2/onnxruntime-linux-x64-static_lib-1.28.2-glibc2_17.zip',
  sha256: '2dada92465b40a16fb5011956d93eaf90e3091cf621a953e5371a5e6a687794e',
  prefix: 'onnxruntime-linux-x64-static_lib-1.28.2-glibc2_17/include/',
  headers: {
    'onnxruntime_c_api.h': 'b69a133143c0da61782b2b02cc8a620d21ac139231fd211719776d10385135c1',
    'onnxruntime_error_code.h': '5ce3b054e798eced8d14f5b86e98692fd33470463f96194ce0700a2d53dd8721',
    'onnxruntime_ep_c_api.h': 'db86df0f846b8d3bdbf429a5c76c5805293196575ca3c475878612591cd18e51',
  },
}
const sha = bytes => createHash('sha256').update(bytes).digest('hex')

export async function fetchHeaders(dir, source = SOURCE) {
  if (Object.entries(source.headers).every(([name, hash]) => existsSync(join(dir, name)) && sha(readFileSync(join(dir, name))) === hash)) return
  const response = await fetch(source.url, { signal: AbortSignal.timeout(600_000) })
  if (!response.ok) throw new Error(`ORT headers: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha(bytes) !== source.sha256) throw new Error('ORT headers: archive checksum mismatch')
  const zip = new AdmZip(bytes)
  const headers = Object.entries(source.headers).map(([name, hash]) => {
    const entry = zip.getEntry(source.prefix + name)
    if (!entry) throw new Error(`ORT headers: missing ${name}`)
    const data = entry.getData()
    if (sha(data) !== hash) throw new Error(`ORT headers: checksum mismatch for ${name}`)
    return [name, data]
  })
  // Verify every member before writing any header; never extract arbitrary ZIP paths.
  mkdirSync(dir, { recursive: true })
  for (const [name, data] of headers) writeFileSync(join(dir, name), data)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('usage: fetch-ort-headers.mjs <include-directory>')
  await fetchHeaders(process.argv[2])
}
