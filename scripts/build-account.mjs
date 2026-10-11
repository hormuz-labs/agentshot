// Self-contained server for the existing ConfigMap deployment; includes the Postgres driver.
import { build } from 'esbuild'
await build({
  entryPoints: ['account/server.mjs'], outfile: 'out/account/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
