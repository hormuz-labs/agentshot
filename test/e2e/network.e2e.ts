// Actual Chromium fetch through a required proxy, not a mocked Electron API.
import { app } from 'electron'
import { createServer } from 'node:http'
import { once } from 'node:events'
import assert from 'node:assert/strict'
import { initializeNetwork } from '../../src/main/network-electron'

const proxy = createServer((req, res) => {
  assert.equal(req.url, 'http://internet-only.invalid/stream')
  assert.equal(req.headers.authorization, 'Bearer origin-token')
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.write('streamed ')
  setTimeout(() => res.end('through proxy'), 20)
})
const sockets = new Set<import('node:net').Socket>()
proxy.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
async function main() {
try {
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening')
  process.env.http_proxy = `http://127.0.0.1:${(proxy.address() as { port: number }).port}`
  process.env.https_proxy = process.env.http_proxy
  process.env.no_proxy = ''
  await app.whenReady()
  await initializeNetwork()
  console.log('Electron proxy setup ready')
  const response = await fetch(new URL('http://internet-only.invalid/stream'), { headers: { authorization: 'Bearer origin-token' }, signal: AbortSignal.timeout(5000) })
  assert.equal(await response.text(), 'streamed through proxy')
  // Fetch Request input is used by provider SDKs as well as URL/string input.
  const requestResponse = await fetch(new Request('http://internet-only.invalid/stream', { headers: { authorization: 'Bearer origin-token' }, signal: AbortSignal.timeout(5000) }))
  assert.equal(await requestResponse.text(), 'streamed through proxy')
  console.log('Electron system network/proxy streaming fetch: passed')
  app.exit(0)
} catch (error) {
  console.error(error); app.exit(1)
} finally {
  for (const socket of sockets) socket.destroy()
  proxy.close()
}
}
void main()
