// Bundles the plugin's launcher into one file with no dependencies, so the Claude plugin runs straight from a git checkout
// (plugins are installed without npm install). The bundle is committed; test/plugin-packaging.test.ts fails when it's stale.
// Not minified: the plugin directory's security scan reads it, and so should anyone installing it.
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

export const options = {
  entryPoints: [fileURLToPath(new URL('./src/main.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  legalComments: 'none',
  logLevel: 'warning',
  banner: { js: '#!/usr/bin/env node' },
}

export const OUTFILE = fileURLToPath(new URL('./bin/agentshot-mcp.mjs', import.meta.url))

if (process.argv[1] === fileURLToPath(import.meta.url)) await build({ ...options, outfile: OUTFILE })
