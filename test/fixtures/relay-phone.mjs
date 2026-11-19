// Cross-language fixture: real pinned HTTPS over Dart CONNECT -> WSS -> Node -> HTTPS.
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { once } from 'node:events'
import { createRelayServer } from '../../relay/server.ts'
import { DesktopRelay } from '../../src/main/relay.ts'
import { signRelayTicket } from '../../src/shared/relay-ticket.ts'
const [key, cert] = process.argv.slice(2)
const bridge = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
  if (req.headers.authorization !== 'Bearer desktop-token') return res.writeHead(401).end()
  res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
})
bridge.listen(0, '127.0.0.1'); await once(bridge, 'listening')
const secret = 's'.repeat(48), expiresAt = Date.now() + 60_000
const router = createRelayServer(secret); router.server.listen(0, '127.0.0.1'); await once(router.server, 'listening')
const url = `ws://127.0.0.1:${router.server.address().port}`
const ticket = role => signRelayTicket(secret, { role, worker: 'home', owner: 'user', expires: expiresAt })
const desktop = new DesktopRelay(() => bridge.address().port)
desktop.update({ url, ticket: ticket('worker'), expiresAt })
await new Promise(resolve => setTimeout(resolve, 100))
console.log(JSON.stringify({ url, ticket: ticket('client'), expiresAt }))
process.stdin.resume()
process.stdin.on('end', () => { desktop.stop(); router.close(); bridge.close(); })
