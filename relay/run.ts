import { createRelayServer } from './server.ts'
const relay = createRelayServer(process.env.RELAY_SECRET || '')
relay.server.listen(Number(process.env.PORT || 8080), '0.0.0.0')
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => relay.close())
