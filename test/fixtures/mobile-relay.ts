// Cross-runtime test: real Flutter TLS over WSS to the real desktop bridge.
import { createServer } from 'node:tls'
import { connect } from 'node:net'
import { createInterface } from 'node:readline'
import { generate } from 'selfsigned'
import { createRelay } from '../../relay/server'
import { MobileBridge } from '../../src/main/mobile-bridge'

const identity = async (token: string) => { if (token !== 'test-account') throw new Error(); return { sub: 'test-account' } }
const relay = createRelay(identity)
await new Promise<void>(r => relay.server.listen(0, '127.0.0.1', r))
const relayPort = (relay.server.address() as { port: number }).port
const pem = await generate([{ name: 'commonName', value: 'localhost' }], { keySize: 2048, algorithm: 'sha256', extensions: [{ name: 'subjectAltName', altNames: [{ type: 7, ip: '127.0.0.1' }] }] })
const front = createServer({ key: pem.private, cert: pem.cert }, socket => {
  const local = connect(relayPort, '127.0.0.1')
  const close = () => { socket.destroy(); local.destroy() }
  local.on('error', close); socket.on('error', close); local.on('close', close); socket.on('close', close)
  local.pipe(socket).pipe(local)
})
await new Promise<void>(r => front.listen(0, '127.0.0.1', r))
process.env.MANUL_RELAY = `http://127.0.0.1:${relayPort}`
const bridge = new MobileBridge({
  account: { current: () => ({ id: 'd'.repeat(32), sub: 'test-account', email: 'test@manul' }), token: async () => 'test-account', identity },
  projects: () => [{ dir: '/test-project' }],
  invoke: async (method, args) => {
    if (method === 'project:open') return { dir: args[0], title: 'Existing film', versions: [], media: {}, files: {} }
    if (method === 'agent:attach') {
      bridge.publish('agui', args[0], { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'saved-message', role: 'user', content: 'Keep the previous opening shot' }] })
      return null
    }
    return { method, args }
  }, importFile: async () => null,
  galleryFile: () => new Response(new Uint8Array(2 * 1024 * 1024).fill(42)),
})
await bridge.start()
while (!bridge.status().relay?.startsWith('Available')) await new Promise(r => setTimeout(r, 10))
console.log(JSON.stringify({ url: `https://127.0.0.1:${(front.address() as { port: number }).port}`, cert: pem.cert, fingerprint: bridge.status().fingerprint, desktop: `test-account:${'d'.repeat(32)}` }))
createInterface({ input: process.stdin }).on('line', command => {
  if (command === 'restart') void bridge.stop().then(() => bridge.start())
})
process.stdin.on('end', () => process.exit(0))
