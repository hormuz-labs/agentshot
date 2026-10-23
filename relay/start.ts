import { createRelay, clerkIdentity } from './server.ts'

const issuer = (process.env.CLERK_ISSUER || 'https://clerk.manul.si').replace(/\/+$/, '')
if (new URL(issuer).protocol !== 'https:') throw new Error('CLERK_ISSUER must use HTTPS')
const relay = createRelay(token => clerkIdentity(issuer, token))
relay.server.listen(Number(process.env.PORT || 8091), process.env.HOST || '127.0.0.1')
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void relay.close().then(() => process.exit(0)) })
