// Defaults for the host-side server; Compose supplies its own internal URLs.
import { readFile } from 'node:fs/promises'
const config = JSON.parse(await readFile(new URL('../gateway/config.json', import.meta.url), 'utf8'))
for (const [name, value] of Object.entries({
  ACCOUNT_DATABASE_URL: 'postgresql://manul:local-manul@127.0.0.1:55439/manul_account',
  BIFROST_URL: 'http://127.0.0.1:8089',
  BIFROST_PROVIDERS: Object.keys(config.providers).join(','),
  CLERK_ISSUER: 'https://clerk.manul.si',
  ACCOUNT_METADATA_KEY: 'manul_local',
  PUBLIC_URL: 'http://127.0.0.1:8090',
  PORT: '8090',
})) process.env[name] ||= value
await import('./server.mjs')
