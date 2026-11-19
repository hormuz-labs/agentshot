// Optional GPU siblings keep the baseline executable independent of GPU driver/runtime libraries.
// Vulkan covers NVIDIA/AMD/Intel on Windows/Linux; Metal is embedded in the normal macOS build.
// CUDA is available to builders with the CUDA SDK: --backend=cuda (Vulkan is the release default).
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION, WINDOWS_FLAGS } from './build-whisper.mjs'
import { checkWhisperManifest } from './check-whisper-manifest.mjs'

export function gpuBuildFlags(backend, windows = process.platform === 'win32') {
  if (!['vulkan', 'cuda'].includes(backend)) throw new Error('GPU backend must be vulkan or cuda')
  return [
    ...WINDOWS_FLAGS.filter(f => !f.startsWith('-DGGML_CUDA=') && (windows || !f.startsWith('-DCMAKE_'))),
    '-DCMAKE_BUILD_TYPE=Release', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_BACKEND_DL=OFF', '-DGGML_NATIVE=OFF',
    '-DGGML_OPENMP=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_CURL=OFF',
    `-DGGML_VULKAN=${backend === 'vulkan' ? 'ON' : 'OFF'}`, `-DGGML_CUDA=${backend === 'cuda' ? 'ON' : 'OFF'}`,
    ...(backend === 'cuda' ? ['-DGGML_STATIC=ON'] : []),
  ]
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.platform === 'darwin') { console.log('Metal is embedded in whisper-cli; no GPU sibling needed.'); process.exit(0) }
  const backend = process.argv.find(a => a.startsWith('--backend='))?.split('=')[1] || 'vulkan'
  const root = resolve(import.meta.dirname, '..'), work = join(root, 'out', `whisper-${backend}`)
  const source = process.env.MANUL_WHISPER_SOURCE || join(work, 'src'), build = join(work, 'build')
  const output = join(root, 'resources', 'bin', `${process.platform}-${process.arch}`)
  const ext = process.platform === 'win32' ? '.exe' : '', name = `whisper-cli-${backend}${ext}`
  const flags = gpuBuildFlags(backend), identity = JSON.stringify([VERSION, 'gpu-v2-spirv-1.4.313.0', flags])
  const stamp = join(output, `.${name}.version`)
  if (existsSync(join(output, name)) && existsSync(stamp) && readFileSync(stamp, 'utf8') === identity) process.exit(0)
  mkdirSync(work, { recursive: true })
  if (!existsSync(source)) execFileSync('git', ['clone', '--depth', '1', '--branch', VERSION, 'https://github.com/ggml-org/whisper.cpp', source], { stdio: 'inherit' })
  // Use a pinned header package newer than Ubuntu's SDK without modifying upstream sources.
  const headers = join(work, 'spirv-headers'), headersBuild = join(work, 'headers-build'), prefix = join(work, 'headers-install')
  if (backend === 'vulkan') {
    if (!existsSync(headers)) execFileSync('git', ['clone', '--depth', '1', '--branch', 'vulkan-sdk-1.4.313.0', 'https://github.com/KhronosGroup/SPIRV-Headers', headers], { stdio: 'inherit' })
    execFileSync('cmake', ['-S', headers, '-B', headersBuild, `-DCMAKE_INSTALL_PREFIX=${prefix}`], { stdio: 'inherit' })
    execFileSync('cmake', ['--install', headersBuild, '--config', 'Release'], { stdio: 'inherit' })
  }
  const cmakeSource = process.platform === 'win32' ? join(root, 'scripts', 'windows-whisper') : source
  execFileSync('cmake', ['-S', cmakeSource, '-B', build, ...(process.platform === 'win32' ? ['-G', 'Visual Studio 17 2022', '-A', 'x64', `-DMANUL_WHISPER_SOURCE=${source}`] : []),
    ...flags, `-DCMAKE_PREFIX_PATH=${prefix}`,
    ...(backend === 'vulkan' ? [`-DCMAKE_CXX_FLAGS=${process.platform === 'win32' ? '/I' : '-I'}"${join(prefix, 'include')}"`] : [])], { stdio: 'inherit' })
  execFileSync('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '--parallel', '4'], { stdio: 'inherit' })
  const executable = join(build, 'bin', ...(process.platform === 'win32' ? ['Release'] : []), `whisper-cli${ext}`)
  if (process.platform === 'win32') checkWhisperManifest(executable)
  execFileSync('git', ['-C', source, 'diff', '--exit-code'], { stdio: 'inherit' })
  mkdirSync(output, { recursive: true })
  copyFileSync(executable, join(output, name))
  copyFileSync(join(source, 'LICENSE'), join(output, 'whisper-LICENSE.txt'))
  writeFileSync(stamp, identity)
  console.log(`Built ${name}. A real-model runtime probe selects it, with CPU fallback.`)
}
