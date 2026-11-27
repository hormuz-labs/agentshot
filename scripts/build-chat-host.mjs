// chat-host for the cluster, as the account service ships (gateway/k8s/deploy-chat-host.sh): the server bundled into one
// file with the MCP SDK, and the editor page beside it. Two ConfigMaps, each under Kubernetes' 1 MiB.
import { build } from 'esbuild'
import { mkdir, stat } from 'node:fs/promises'
import { writeEditorPage } from './build-mcp-app.mjs'

await mkdir('out/chat-host', { recursive: true })
await build({
  entryPoints: ['chat-host/server.mjs'], outfile: 'out/chat-host/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node24', logLevel: 'warning',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
})
await writeEditorPage('out/chat-host/editor.html')
for (const f of ['server.mjs', 'editor.html']) {
  const { size } = await stat(`out/chat-host/${f}`)
  if (size > 1000 * 1024) throw new Error(`out/chat-host/${f} is ${size} bytes: too big for a ConfigMap.`)
  console.log(`out/chat-host/${f}: ${(size / 1024).toFixed(0)} KB`)
}
