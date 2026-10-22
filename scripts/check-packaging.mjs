// Run before compiling or invoking builder, and again in beforePack to catch direct builder invocations.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILDS, VERSION as FFMPEG_VERSION } from './fetch-ffmpeg.mjs'
import { CLI, EXTENSION } from './fetch-bsk.mjs'
import { WINDOWS_IDENTITY } from './build-whisper.mjs'

export function checkPackaging({ root = join(import.meta.dirname, '..'), platform = process.platform, arch = process.arch, run = execFileSync } = {}) {
  const target = `${platform}-${arch}`
  if (!BUILDS[target] || !CLI.builds[target]) throw new Error(`Unsupported packaging target ${target}`)
  const required = name => {
    const path = join(root, name)
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0)
      throw new Error(`Packaging resource missing: ${path}. Run npm ci and npm run build:whisper.`)
    return path
  }
  const stamp = (name, expected) => {
    if (readFileSync(required(name), 'utf8').trim() !== expected) throw new Error(`Stale packaging resource: ${name}`)
  }
  const bin = `resources/bin/${target}`
  for (const tool of ['ffmpeg', 'ffprobe', 'whisper-cli', 'bsk']) {
    const path = required(`${bin}/${tool}${platform === 'win32' ? '.exe' : ''}`)
    if (platform === 'win32' && readFileSync(path).toString('ascii', 0, 2) !== 'MZ') throw new Error(`Not a Windows executable: ${path}`)
    const args = tool === 'ffmpeg' || tool === 'ffprobe' ? ['-version'] : ['--version']
    const output = run(path, args, { encoding: 'utf8', timeout: 30000, windowsHide: true })
    if (tool === 'ffmpeg' || tool === 'ffprobe') {
      if (!output.includes(`${tool} version ${FFMPEG_VERSION}`)) throw new Error(`Unexpected ${tool} version in ${path}`)
      for (const flag of ['--enable-gpl', '--enable-libx264', '--enable-libass'])
        if (!output.includes(flag)) throw new Error(`${tool} lacks required ${flag}`)
      stamp(`${bin}/.${tool}.sha256`, BUILDS[target].sha256 || BUILDS[target][tool])
    }
    if (tool === 'bsk') {
      if (!output.includes(CLI.version)) throw new Error(`Unexpected BrowserSkill version in ${path}`)
      stamp(`${bin}/.bsk.sha256`, CLI.builds[target].sha256)
    }
    if (tool === 'whisper-cli' && !output.includes('1.9.4')) throw new Error(`Unexpected whisper.cpp version in ${path}`)
  }
  stamp(`${bin}/.whisper-cli.version`, platform === 'win32' ? WINDOWS_IDENTITY : 'v1.9.4')
  if (platform === 'win32') {
    for (const f of ['ffmpeg-LICENSE.txt', 'ffmpeg-README.txt', 'whisper-LICENSE.txt']) required(`${bin}/${f}`)
    const dll = required(`${bin}/vcruntime140.dll`)
    if (readFileSync(dll).toString('ascii', 0, 2) !== 'MZ') throw new Error(`Not a Windows DLL: ${dll}`)
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'resources/bsk-ext/manifest.json',
    'resources/lib/gsap.min.js', 'resources/lib/fonts/Inter.woff2', 'resources/lib/fonts/Inter-Regular.ttf', 'resources/lib/fonts/Inter-Bold.ttf', 'resources/lib/fonts/Inter-LICENSE.txt']) required(name)
  stamp('resources/bsk-ext/.sha256', EXTENSION.sha256)
  for (const dir of ['resources/skills', 'resources/py'])
    if (!existsSync(join(root, dir)) || !statSync(join(root, dir)).isDirectory()) throw new Error(`Packaging directory missing: ${dir}`)
  console.log(`packaging resources: ${target} ok`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) checkPackaging()
