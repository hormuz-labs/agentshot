// Native entry point: Unix keeps the existing build; Windows uses Visual Studio/MSVC, no shell dependency.
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyWindowsRuntime } from './copy-windows-runtime.mjs'
import { checkWhisperManifest } from './check-whisper-manifest.mjs'

export const VERSION = 'v1.9.4'
export const WINDOWS_IDENTITY = `${VERSION} windows-msvc-static-sse2-utf8-v2`
export const WINDOWS_FLAGS = [
  '-DCMAKE_POLICY_DEFAULT_CMP0091=NEW', '-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded',
  '-DBUILD_SHARED_LIBS=OFF', '-DGGML_BACKEND_DL=OFF', '-DGGML_CPU_ALL_VARIANTS=OFF',
  '-DGGML_NATIVE=OFF', '-DGGML_OPENMP=OFF', '-DGGML_BLAS=OFF', '-DGGML_CUDA=OFF', '-DGGML_METAL=OFF',
  // x64's default SSE2 baseline, not the build runner's AVX/AVX2 instruction set.
  ...['SSE42', 'AVX', 'AVX2', 'AVX_VNNI', 'AVX512', 'AVX512_VBMI', 'AVX512_VNNI', 'AVX512_BF16', 'BMI2', 'FMA', 'F16C', 'AMX_TILE', 'AMX_INT8', 'AMX_BF16'].map(f => `-DGGML_${f}=OFF`),
  '-DWHISPER_BUILD_IS_DEV=OFF', '-DWHISPER_BUILD_EXAMPLES=ON', '-DWHISPER_BUILD_TESTS=OFF',
  '-DWHISPER_BUILD_SERVER=OFF', '-DWHISPER_SDL2=OFF', '-DWHISPER_CURL=OFF',
]

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(import.meta.dirname, '..')
  if (process.platform !== 'win32') {
    execFileSync('sh', [join(root, 'scripts', 'build-whisper.sh')], { cwd: root, stdio: 'inherit' })
  } else {
    if (process.arch !== 'x64') throw new Error('Windows whisper builds require native x64 Node and MSVC')
    copyWindowsRuntime()
    execFileSync('cmake', ['--version'], { stdio: 'inherit' })
    execFileSync('git', ['--version'], { stdio: 'inherit' })
    const out = join(root, 'resources', 'bin', 'win32-x64')
    const stamp = join(out, '.whisper-cli.version')
    const identity = `${WINDOWS_IDENTITY}\n`
    if (existsSync(join(out, 'whisper-cli.exe')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === identity) {
      console.log(`whisper-cli ${identity.trim()} already built`)
    } else {
      const tmp = mkdtempSync(join(tmpdir(), 'manul-whisper-'))
      try {
        const src = join(tmp, 'src')
        const build = join(tmp, 'build')
        execFileSync('git', ['clone', '--depth', '1', '--branch', VERSION, 'https://github.com/ggml-org/whisper.cpp', src], { stdio: 'inherit' })
        execFileSync('cmake', ['-S', join(root, 'scripts', 'windows-whisper'), '-B', build, '-G', 'Visual Studio 17 2022', '-A', 'x64', `-DMANUL_WHISPER_SOURCE=${src}`, ...WINDOWS_FLAGS], { stdio: 'inherit' })
        execFileSync('cmake', ['--build', build, '--config', 'Release', '--target', 'whisper-cli', '--parallel', '8'], { stdio: 'inherit' })
        const exe = join(build, 'bin', 'Release', 'whisper-cli.exe')
        checkWhisperManifest(exe)
        // Upstream generates ignored build metadata, but tracked sources must remain pristine.
        execFileSync('git', ['-C', src, 'diff', '--exit-code'], { stdio: 'inherit' })
        execFileSync(exe, ['--help'], { stdio: 'inherit', timeout: 30000 })
        mkdirSync(out, { recursive: true })
        copyFileSync(exe, join(out, 'whisper-cli.exe'))
        copyFileSync(join(src, 'LICENSE'), join(out, 'whisper-LICENSE.txt'))
        writeFileSync(stamp, identity)
        console.log(`built ${join(out, 'whisper-cli.exe')} (${identity.trim()})`)
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }
    checkWhisperManifest(join(out, 'whisper-cli.exe'))
  }
}
