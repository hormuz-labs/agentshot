// Builds the editor page AgentShot shows inside Claude and ChatGPT (src/mcp-app: the app's own film panel, React and
// Tailwind as in src/renderer) into one HTML file: an MCP App is served as a single document, so its script, styles
// and fonts go inline. AgentShot's main process serves it (electron.vite.config.ts builds it next to index.js); a
// hosted server in front of the cloud workers serves the very same file.
//
//   node scripts/build-mcp-app.mjs [out file]      default out/main/mcp-app/editor.html
import { build } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_OUT = resolve(root, 'out/main/mcp-app/editor.html')

/** The page as one HTML string. */
export async function buildEditorPage() {
  // a production build whoever runs it: electron-vite's dev server and test runners set NODE_ENV, and React's JSX
  // follows it (development JSX against production React draws nothing)
  const was = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  try { return await buildPage() } finally { if (was === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = was }
}

async function buildPage() {
  const result = await build({
    configFile: false, root: resolve(root, 'src/mcp-app'), base: './', logLevel: 'warn', mode: 'production',
    plugins: [react(), tailwindcss()],
    // React's production build, whoever runs this (a test runner sets NODE_ENV=test)
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: { alias: { '@': resolve(root, 'src/renderer/src') } },
    build: {
      write: false, target: 'es2022', minify: true, cssCodeSplit: false, modulePreload: false, reportCompressedSize: false,
      assetsInlineLimit: () => true, // fonts and pictures as data: one file
      rollupOptions: { input: resolve(root, 'src/mcp-app/index.html'), output: { inlineDynamicImports: true } },
    },
  })
  const files = (Array.isArray(result) ? result : [result]).flatMap(r => r.output)
  const html = files.find(f => f.fileName.endsWith('.html'))
  if (!html || html.type !== 'asset') throw new Error('The editor page didn’t build.')
  let page = String(html.source)
  for (const f of files) {
    if (f.type === 'chunk') {
      const tag = new RegExp(`<script[^>]*src="\\./${f.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`)
      if (!tag.test(page)) throw new Error(`The page doesn’t load ${f.fileName}.`)
      page = page.replace(tag, () => `<script type="module">${f.code.replace(/<\/script/gi, '<\\/script')}</script>`)
    } else if (f.fileName.endsWith('.css')) {
      const tag = new RegExp(`<link[^>]*href="\\./${f.fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`)
      if (!tag.test(page)) throw new Error(`The page doesn’t load ${f.fileName}.`)
      page = page.replace(tag, () => `<style>${String(f.source).replace(/<\/style/gi, '<\\/style')}</style>`)
    }
  }
  return page
}

export async function writeEditorPage(out = DEFAULT_OUT) {
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, await buildEditorPage())
  return out
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await writeEditorPage(process.argv[2] ? resolve(process.argv[2]) : undefined))
