// Repeatable phone-relay benchmark against the production desktop range server.
// Needs Node 22+, Flutter, and sparse-file support; only touched blocks occupy disk.
import { createServer as httpsServer } from 'node:https'
import { createServer as httpServer, request as httpRequest } from 'node:http'
import { mkdtemp, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { X509Certificate } from 'node:crypto'
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { generate } from 'selfsigned'
import { serveMobileMedia } from '../src/main/mobile-media.ts'

const folder = await mkdtemp(join(tmpdir(), 'agentshot-media-bench-'))
const file = join(folder, 'hour-long.mp4'), size = 20 * 1024 ** 3
const disk = await open(file, 'w+')
await disk.truncate(size)
const cert = await generate([{ name: 'commonName', value: 'Media benchmark' }], { keySize: 2048 })
let profile = { latencyMs: 5, mbps: 100 }, revision = 0
let bytes = 0, gets = 0, heads = 0, active = 0, peak = 0
const origin = httpServer((req, res) => {
  serveMobileMedia(req, res, file).catch(() => res.destroy())
})
await new Promise(r => origin.listen(0, '127.0.0.1', r))
const server = httpsServer({ key: cert.private, cert: cert.cert }, async (req, res) => {
  const json = value => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(value)) }
  if (req.url === '/hello') { json({}); return }
  if (req.url === '/bench/stats') { json({ bytes, gets, heads, active, peak }); return }
  if (req.url === '/bench/reset' && req.method === 'POST') {
    if (active) { res.writeHead(409); res.end(); return }
    let body = ''; for await (const chunk of req) body += chunk
    profile = JSON.parse(body); bytes = gets = heads = peak = 0; json({}); return
  }
  if (req.url === '/bench/revise' && req.method === 'POST') {
    // A one-byte same-size edit changes the descriptor, without generating a 20 GiB file.
    await disk.write(Buffer.from([++revision % 256]), 0, 1, 0)
    json({}); return
  }
  if (!req.url?.startsWith('/media?')) { res.writeHead(404); res.end(); return }
  if (req.method === 'HEAD') heads++; else gets++
  active++; peak = Math.max(peak, active)
  let upstream
  const abort = () => upstream?.destroy()
  res.on('close', abort)
  try {
    await new Promise(r => setTimeout(r, profile.latencyMs))
    if (res.destroyed) return
    const response = await new Promise((resolve, reject) => {
      upstream = httpRequest({ host: '127.0.0.1', port: origin.address().port, method: req.method, headers: req.headers }, resolve)
      upstream.on('error', reject); upstream.end()
    })
    res.writeHead(response.statusCode, response.headers)
    const throttle = new Transform({ transform(chunk, _, done) {
      setTimeout(() => { bytes += chunk.length; done(null, chunk) }, chunk.length * 8 / (profile.mbps * 1000))
    } })
    await pipeline(response, throttle, res)
  } catch { res.destroy() } finally { active--; res.off('close', abort); abort() }
})
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `https://127.0.0.1:${server.address().port}`
const fingerprint = new X509Certificate(cert.cert).fingerprint256.replaceAll(':', '').toLowerCase()
try {
  const child = spawn(process.env.FLUTTER || 'flutter', ['test', 'benchmark/media_transfer_benchmark.dart', '--reporter', 'expanded',
    `--dart-define=BENCH_URL=${url}`, `--dart-define=BENCH_FINGERPRINT=${fingerprint}`,
    `--dart-define=BENCH_OUTPUT=${process.env.BENCH_OUTPUT || '../out/media-benchmark.json'}`], {
    cwd: join(import.meta.dirname, '..', 'mobile'), stdio: 'inherit',
  })
  process.exitCode = await new Promise((resolve, reject) => { child.on('exit', code => resolve(code ?? 1)); child.on('error', reject) })
} finally {
  server.closeAllConnections(); origin.closeAllConnections()
  await Promise.all([new Promise(r => server.close(r)), new Promise(r => origin.close(r))])
  await disk.close(); await rm(folder, { recursive: true, force: true })
}
