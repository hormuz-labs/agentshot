// Fetch Manul's pinned ffmpeg + ffprobe (static builds, same release for every platform) into resources/bin/<platform>-<arch>/.
// Every file is SHA-256 checked against the hashes pinned here. Runs on `npm install`; packaging fetches every target with --all.
//   node scripts/fetch-ffmpeg.mjs            this machine's platform
//   node scripts/fetch-ffmpeg.mjs --all      every platform Manul ships for
// Builds: Manul's own on Unix (scripts/ffmpeg/build.sh: FFmpeg 9.0.2 in Martin Riedl's GPLv3 configuration — libx264, libass,
// VideoToolbox on macOS… — plus vid.stab and Rubber Band), made by .github/workflows/ffmpeg.yml and published as the
// GitHub prerelease RELEASE; Windows x64 uses Gyan's GPLv3 static essentials build (libx264 + libass).
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { download, extractZip, zipFiles } from './archive.mjs'

export const VERSION = '9.0.2'
export const RELEASE = 'ffmpeg-9.0.2-2'
const BASE = `https://github.com/hormuz-labs/manul/releases/download/${RELEASE}`
export const BUILDS = {
  'darwin-arm64': { ffmpeg: '867fed3f111609a1ffcb4e1fac18f1e763e8672fe5d7b16ffd6be67711af8a1e', ffprobe: 'a78c66a130ba4bebd054903c04690b2d69c1e85e8ef54b62d932634c2304d27c' },
  'darwin-x64': { ffmpeg: '8bec703783a93005c09ddb8efb875d571d5b20d073375c819fc36273cd5395a9', ffprobe: 'be0e837ffb9e2724faac5559fcd663a87762745bc1257212871693d30daa9151' },
  'linux-x64': { ffmpeg: '9d690340e1a68574d2b0f071388cb1fb902544223619efc1f0f7c953fcd14a2e', ffprobe: '1491bd0e1db10dd9a6fa4f9a44b012ef4cfdffb2e76739e0b52a7da759e40f1b' },
  'linux-arm64': { ffmpeg: '04d16b3f23305fe06d2938d848bb2024058eaef5b3a592e3bd7c76eb070778ae', ffprobe: 'b7e0c4d3598813b6bdf5fdf89c05eced6e6545b7b1d88496a372097f4a850c37' },
  'win32-x64': {
    url: 'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
    sha256: '60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba',
    prefix: 'ffmpeg-9.0.2-essentials_build',
  },
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'bin')

async function fetchOne(target, tool) {
  const b = BUILDS[target]
  const dir = join(root, target)
  const bin = join(dir, tool)
  const stamp = join(dir, `.${tool}.sha256`)
  if (existsSync(bin) && existsSync(stamp) && readFileSync(stamp, 'utf8') === b[tool]) return // already this build
  mkdirSync(dir, { recursive: true })
  const zip = await download(`${BASE}/${tool}-${target}.zip`, b[tool])
  rmSync(bin, { force: true })
  extractZip(zip, dir)
  chmodSync(bin, 0o755)
  writeFileSync(stamp, b[tool])
  console.log(`  ${target}/${tool} ${VERSION} from ${RELEASE} (${(zip.length / 1e6).toFixed(0)} MB zip)`)
}

export async function fetchWindows(dir = join(root, 'win32-x64')) {
  const b = BUILDS['win32-x64']
  const names = ['ffmpeg.exe', 'ffprobe.exe', 'ffmpeg-LICENSE.txt', 'ffmpeg-README.txt']
  if (names.every(n => existsSync(join(dir, n))) && ['ffmpeg', 'ffprobe'].every(t =>
    existsSync(join(dir, `.${t}.sha256`)) && readFileSync(join(dir, `.${t}.sha256`), 'utf8') === b.sha256)) return
  const zip = await download(b.url, b.sha256)
  const files = zipFiles(zip, [`${b.prefix}/bin/ffmpeg.exe`, `${b.prefix}/bin/ffprobe.exe`, `${b.prefix}/LICENSE`, `${b.prefix}/README.txt`])
  for (const data of files.slice(0, 2)) {
    if (data.toString('ascii', 0, 2) !== 'MZ') throw new Error('Windows FFmpeg ZIP does not contain PE executables')
  }
  mkdirSync(dir, { recursive: true })
  names.forEach((name, i) => writeFileSync(join(dir, name), files[i]))
  for (const t of ['ffmpeg', 'ffprobe']) writeFileSync(join(dir, `.${t}.sha256`), b.sha256)
  console.log(`  win32-x64/ffmpeg + ffprobe ${VERSION} (${(zip.length / 1e6).toFixed(0)} MB zip)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.MANUL_SKIP_FFMPEG) process.exit(0)
  const targets = process.argv.includes('--all') ? Object.keys(BUILDS) : [process.argv.find(a => a.startsWith('--target='))?.slice(9) || `${process.platform}-${process.arch}`]
  for (const t of targets) {
    if (!BUILDS[t]) throw new Error(`no ffmpeg build pinned for ${t}`)
    if (t === 'win32-x64') await fetchWindows()
    else for (const tool of ['ffmpeg', 'ffprobe']) await fetchOne(t, tool)
  }
}
