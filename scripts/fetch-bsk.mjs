// Fetch Manul's pinned BrowserSkill (MIT, github.com/Tencent/BrowserSkill): the bsk CLI into resources/bin/<platform>-<arch>/
// and the Chrome extension into resources/bsk-ext/. Manul runs both privately (its own daemon home and port; the
// extension runs inside Manul's embedded browser), so a bsk the user installed in Chrome is never touched.
// Every download is SHA-256 checked against the hashes pinned here. Runs on `npm install`; packaging uses --all.
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, extractZip, zipFiles } from './archive.mjs'

const REL = 'https://github.com/Tencent/BrowserSkill/releases/download'
export const CLI = {
  version: '0.3.2',
  builds: {
    'darwin-arm64': { url: `${REL}/cli-v0.3.2/bsk-v0.3.2-aarch64-apple-darwin.tar.gz`, sha256: 'f9f9f5f678fdfc6b577e524f4eb74a5fe5c47420dae8b77b66619a636d87c99a' },
    'darwin-x64': { url: `${REL}/cli-v0.3.2/bsk-v0.3.2-x86_64-apple-darwin.tar.gz`, sha256: '58bd9b69dc88493508e27a9a40d79d73a4234e20a6eeb7f9ba4e93d0888c21f2' },
    'linux-x64': { url: `${REL}/cli-v0.3.2/bsk-v0.3.2-x86_64-unknown-linux-musl.tar.gz`, sha256: '73e3948ad2232111661729c25e6c762eda7bd5c2320fa2593fe55c9855790631' },
    'linux-arm64': { url: `${REL}/cli-v0.3.2/bsk-v0.3.2-aarch64-unknown-linux-musl.tar.gz`, sha256: '625de29561a98b245ef712d13c273c5de744e4610a7bbf1999ff3b279d2220cf' },
    'win32-x64': { url: `${REL}/cli-v0.3.2/bsk-v0.3.2-x86_64-pc-windows-msvc.zip`, sha256: 'b773c443275b8581af29b314baa799e1ec599464379998edcf1dbc7eb07a7eab' },
  },
}
export const EXTENSION = {
  version: '0.3.2',
  url: `${REL}/ext-v0.3.2/browser-skill-extension-v0.3.2-chrome.zip`,
  sha256: '9f543214a0ff5f0f2ce213dd8c5300111dba0ab757fa542a3f61b5636132c24e',
}

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')

async function fetchCli(target) {
  const b = CLI.builds[target]
  const dir = join(resources, 'bin', target)
  const bin = join(dir, target.startsWith('win32-') ? 'bsk.exe' : 'bsk')
  const stamp = join(dir, '.bsk.sha256')
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, 'utf8') === b.sha256) return
  mkdirSync(dir, { recursive: true })
  if (target === 'win32-x64') {
    const [exe] = zipFiles(await download(b.url, b.sha256), ['bsk.exe'])
    if (exe.toString('ascii', 0, 2) !== 'MZ') throw new Error('Windows BrowserSkill ZIP does not contain a PE executable')
    writeFileSync(bin, exe)
    writeFileSync(stamp, b.sha256)
    console.log(`  ${target}/bsk ${CLI.version}`)
    return
  }
  const tmp = mkdtempSync(join(tmpdir(), 'manul-bsk-'))
  writeFileSync(join(tmp, 'bsk.tar.gz'), await download(b.url, b.sha256))
  execFileSync('tar', ['xzf', join(tmp, 'bsk.tar.gz'), '-C', tmp])
  rmSync(bin, { force: true })
  renameSync(join(tmp, 'bsk'), bin)
  chmodSync(bin, 0o755)
  rmSync(tmp, { recursive: true })
  writeFileSync(stamp, b.sha256)
  console.log(`  ${target}/bsk ${CLI.version}`)
}

async function fetchExtension() {
  const dir = join(resources, 'bsk-ext')
  const stamp = join(dir, '.sha256')
  if (existsSync(join(dir, 'manifest.json')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === EXTENSION.sha256) return
  const zip = await download(EXTENSION.url, EXTENSION.sha256)
  zipFiles(zip, ['manifest.json'])
  rmSync(dir, { recursive: true, force: true })
  extractZip(zip, dir)
  writeFileSync(stamp, EXTENSION.sha256)
  console.log(`  bsk-ext ${EXTENSION.version}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.MANUL_SKIP_BSK) process.exit(0)
  const targets = process.argv.includes('--all') ? Object.keys(CLI.builds) : [process.argv.find(a => a.startsWith('--target='))?.slice(9) || `${process.platform}-${process.arch}`]
  for (const t of targets) {
    if (!CLI.builds[t]) throw new Error(`no bsk build pinned for ${t}`)
    await fetchCli(t)
  }
  await fetchExtension()
}
