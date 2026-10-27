// On-demand tools: downloaded only when first needed, after the user agrees, into <userData>/tools (never system-wide).
//   uv        Astral's Python manager (a single binary, pinned version, SHA-256 checked)
//   whisper   speech-to-text: faster-whisper in its own uv-managed Python, plus the "base" model
// Every install runs as a background job. One install at a time per tool.
import { app } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { basename, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import { asJob, type JobHandle } from './jobs'
import { MODELS_DIR } from './media'
import type { OnDemandTool } from '../shared/types'

const run = promisify(execFile)

export const toolsRoot = () => process.env.MANUL_TOOLS || join(app.getPath('userData'), 'tools')
const dir = (id: string) => join(toolsRoot(), id)
const stamp = (id: string) => join(dir(id), '.installed.json')

// ---------------------------------------------------------------- pinned downloads
export const UV_VERSION = '0.12.23'
export const UV_BUILDS: Record<string, { target: string; sha256: string }> = {
  'darwin-arm64': { target: 'aarch64-apple-darwin', sha256: '50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544' },
  'darwin-x64': { target: 'x86_64-apple-darwin', sha256: '960da44cb4b73685206ddd250b19e0a117fa41095710c1038f081f5cb613efb4' },
  'linux-x64': { target: 'x86_64-unknown-linux-gnu', sha256: '9167d72b3319674b6303c4cbe071854bba13ebdf3d76b1a7cbdc175471fb66d6' },
  'linux-arm64': { target: 'aarch64-unknown-linux-gnu', sha256: '6524bd338177ed50d035d39354e12545e993bbeba2ecbddf0480c5b3a81d313f' },
  'win32-x64': { target: 'x86_64-pc-windows-msvc', sha256: '75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90' },
  'win32-arm64': { target: 'aarch64-pc-windows-msvc', sha256: '13294e232ececbe709c06b74e6ced06f2a225ea5591476685362f22be56a50d5' },
}
const PYTHON = '3.12'
const FASTER_WHISPER = '1.2.1'
// faster-whisper 1.2.1 calls av.open(metadata_errors=…), which PyAV 17+ removed; pinned until faster-whisper catches up
const PYAV = '16.1.0'
export const WHISPER_MODEL = 'base'
// The bundled whisper.cpp's model: multilingual base (huggingface.co/ggerganov/whisper.cpp), SHA-256 from its LFS pointer
const WHISPER_MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'
export const WHISPER_MODEL_SHA256 = '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe'
export const WHISPER_LARGE_SHA256 = '64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2'

type Def = Omit<OnDemandTool, 'installed' | 'diskBytes' | 'version'> & { install(j: JobHandle): Promise<string> }

const DEFS: Def[] = [
  {
    id: 'uv', name: 'Python runtime (uv)', sizeMB: 40,
    description: 'Runs AgentShot\'s Python-based tools in their own sandboxed environments.',
    async install(j) {
      const build = UV_BUILDS[`${process.platform}-${process.arch}`]
      if (!build) throw new Error(`No uv build for ${process.platform}-${process.arch}`)
      const ext = process.platform === 'win32' ? 'zip' : 'tar.gz'
      const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${build.target}.${ext}`
      const archive = join(dir('uv'), `uv.${ext}`)
      await download(url, archive, build.sha256, j, 'Downloading uv')
      if (process.platform === 'win32') {
        // .NET paths are literal, unlike Expand-Archive's wildcard-sensitive DestinationPath.
        const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
        await run(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command',
          `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
          `[System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(archive)}, ${quote(dir('uv'))})`], { windowsHide: true })
      } else {
        await run('tar', ['-xzf', archive, '-C', dir('uv'), '--strip-components', '1'], { windowsHide: true })
      }
      if (!existsSync(uvBin())) throw new Error('The uv archive did not contain the expected executable.')
      await rm(archive)
      return UV_VERSION
    },
  },
  {
    id: 'whisper-model', name: 'Speech recognition (Whisper base model)', sizeMB: 148,
    description: 'Lets AgentShot\'s built-in whisper.cpp transcribe speech with word timings, so you (and AgentShot) can edit by text: cut the ums, remove a sentence, find a moment.',
    async install(j) {
      await download(WHISPER_MODEL_URL, whisperModelPath(), WHISPER_MODEL_SHA256, j, 'Downloading the Whisper model')
      return 'ggml-base'
    },
  },
  {
    id: 'whisper-large-v3', name: 'Higher-accuracy captions (Whisper Large-v3)', sizeMB: 3096,
    description: 'Optional local speech recognition for caption exports. Downloads about 3.1 GB and needs more memory and processing time than Base. Used automatically for export captions once installed.',
    async install(j) {
      await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin', whisperLargeModelPath(), WHISPER_LARGE_SHA256, j, 'Downloading Whisper Large-v3')
      return 'ggml-large-v3'
    },
  },
  {
    id: 'whisper', name: 'Speech recognition (Python engine)', sizeMB: 330, needs: ['uv'],
    description: 'faster-whisper in its own Python. Only needed on systems where AgentShot has no built-in whisper.cpp.',
    async install(j) {
      const env = pyEnv()
      j.progress(null, `Installing Python ${PYTHON}`)
      await sh(uvBin(), ['python', 'install', PYTHON], env)
      j.progress(0.2, 'Creating environment')
      await sh(uvBin(), ['venv', '--python', PYTHON, join(dir('whisper'), 'venv')], env)
      j.progress(0.3, 'Installing faster-whisper')
      await sh(uvBin(), ['pip', 'install', '--python', venvPython('whisper'), `faster-whisper==${FASTER_WHISPER}`, `av==${PYAV}`], env)
      j.progress(0.7, `Downloading the "${WHISPER_MODEL}" model`)
      await sh(venvPython('whisper'), [scriptPath('transcribe.py'), '--download-only', '--model', WHISPER_MODEL], { ...env, HF_HOME: join(dir('whisper'), 'models') })
      return `faster-whisper ${FASTER_WHISPER} · ${WHISPER_MODEL}`
    },
  },
]

// ---------------------------------------------------------------- paths other modules use
/** Never let Windows executable lookup select a project-supplied powershell.exe or pwsh.exe. */
export function windowsPowerShell(): string {
  const root = process.env.SystemRoot || 'C:\\Windows'
  if (!/^[a-z]:[\\/]/i.test(root)) throw new Error('SystemRoot must be an absolute Windows drive path.')
  return win32.join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Where the Whisper base model is downloaded to (a build without it inside). */
export const whisperModelPath = () => join(dir('whisper-model'), 'ggml-base.bin')
/** The Whisper base model shipped inside the app (scripts/fetch-models.mjs), when it is. */
export const shippedWhisperModel = () => join(MODELS_DIR, 'ggml-base.bin')
/** The Whisper base model to use: the one shipped with the app, else the downloaded one. */
export const activeWhisperModel = () => (existsSync(shippedWhisperModel()) ? shippedWhisperModel() : whisperModelPath())
export const whisperLargeModelPath = () => join(dir('whisper-large-v3'), 'ggml-large-v3.bin')
export const uvBin = () => join(dir('uv'), process.platform === 'win32' ? 'uv.exe' : 'uv')
export const venvPython = (id: string) => process.platform === 'win32' ? join(dir(id), 'venv', 'Scripts', 'python.exe') : join(dir(id), 'venv', 'bin', 'python')
export const whisperEnv = () => ({ ...pyEnv(), HF_HOME: join(dir('whisper'), 'models'), HF_HUB_OFFLINE: '1' })
/** Python scripts ship in resources/py (unpacked next to the app when packaged). */
export const scriptPath = (name: string) =>
  app.isPackaged ? join(process.resourcesPath, 'py', name) : join(import.meta.dirname, '../../resources/py', name)
const pyEnv = () => ({
  ...process.env,
  UV_PYTHON_INSTALL_DIR: join(toolsRoot(), 'python'),
  UV_CACHE_DIR: join(toolsRoot(), 'cache'),
  UV_NO_CONFIG: '1',
  PYTHONUNBUFFERED: '1',
})

// ---------------------------------------------------------------- status, install, remove
export function isInstalled(id: string) {
  if (id === 'whisper-model' && existsSync(shippedWhisperModel())) return true // comes with the app
  return existsSync(stamp(id)) && (id !== 'whisper-large-v3' || existsSync(whisperLargeModelPath()))
}

export async function listTools(): Promise<OnDemandTool[]> {
  return Promise.all(DEFS.map(async ({ install: _i, ...d }) => {
    const installed = isInstalled(d.id)
    let version: string | undefined, diskBytes: number | undefined
    if (installed && d.id === 'whisper-model' && existsSync(shippedWhisperModel())) version = 'ggml-base (built in)'
    else if (installed) {
      try { version = JSON.parse(readFileSync(stamp(d.id), 'utf8')).version } catch { /* old stamp */ }
      diskBytes = await du(dir(d.id))
    }
    return { ...d, installed, version, diskBytes }
  }))
}

/** What installing `id` would download: the tool and any missing tools it needs. */
export function plan(id: string): Def[] {
  const out: Def[] = []
  const add = (t: string) => {
    const d = DEFS.find(x => x.id === t)
    if (!d) throw new Error(`unknown tool ${t}`)
    for (const n of d.needs || []) add(n)
    if (!isInstalled(t) && !out.includes(d)) out.push(d)
  }
  add(id)
  return out
}

const installing = new Map<string, Promise<void>>()

/** Told when an install ends, for usage statistics. */
export let onInstalled: (id: string, ok: boolean) => void = () => {}
export const setOnInstalled = (fn: typeof onInstalled) => { onInstalled = fn }

export function install(id: string): Promise<void> {
  const busy = installing.get(id)
  if (busy) return busy
  const p = (async () => {
    for (const d of plan(id)) {
      await rm(dir(d.id), { recursive: true, force: true })
      await mkdir(dir(d.id), { recursive: true })
      const version = await asJob(`Installing ${d.name}`, 'install', j => d.install(j), { doneTitle: `Installed ${d.name}` })
      writeFileSync(stamp(d.id), JSON.stringify({ version, at: Date.now() }))
    }
    if (isInstalled('uv')) await sh(uvBin(), ['cache', 'clean'], pyEnv()).catch(() => {}) // wheels are installed; the cache only takes space
  })().then(() => onInstalled(id, true), e => { onInstalled(id, false); throw e }).finally(() => installing.delete(id))
  installing.set(id, p)
  return p
}

export async function remove(id: string) {
  if (DEFS.some(d => d.needs?.includes(id) && isInstalled(d.id))) throw new Error(`Other tools need ${id}; remove them first.`)
  await rm(dir(id), { recursive: true, force: true })
}

/**
 * Make sure a tool is installed, asking the user first if it is not.
 * `ask` shows the consent card and resolves true when the user agrees.
 */
export async function ensure(id: string, ask: (title: string, body: string, sizeMB: number) => Promise<boolean>) {
  const todo = plan(id)
  if (!todo.length) return
  const main = DEFS.find(d => d.id === id)!
  const size = todo.reduce((s, d) => s + d.sizeMB, 0)
  const ok = await ask(`Download ${main.name}?`, main.description, size)
  if (!ok) throw new Error(`The user declined to download ${main.name}.`)
  await install(id)
}

// ---------------------------------------------------------------- helpers
async function download(url: string, to: string, sha256: string, j: JobHandle, label: string) {
  const res = await fetch(url)
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`)
  const total = Number(res.headers.get('content-length')) || 0
  const hash = createHash('sha256')
  let got = 0
  // Stream large models to disk rather than retaining several gigabytes in memory.
  const partial = `${to}.part`
  const file = await open(partial, 'w')
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await file.writeFile(chunk)
      hash.update(chunk)
      got += chunk.length
      j.progress(total ? got / total : null, `${label} · ${(got / 1e6).toFixed(1)} MB`)
    }
    if (hash.digest('hex') !== sha256) throw new Error(`Checksum mismatch for ${url}: the download was not what AgentShot expected, so it was discarded.`)
    await file.close()
    await rename(partial, to)
  } finally {
    await file.close()
    await rm(partial, { force: true })
  }
}

function sh(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { env, windowsHide: true })
    let out = '', err = ''
    p.stdout.on('data', d => { out += d })
    p.stderr.on('data', d => { err += d })
    p.on('error', fail)
    p.on('close', code => (code === 0 ? ok(out) : fail(new Error(`${basename(cmd)} ${args[0]} failed: ${err.slice(-1500)}`))))
  })
}

async function du(path: string) {
  try {
    const stats = await lstat(path)
    if (stats.isSymbolicLink()) return 0 // never follow links outside the managed tool or count an environment twice
    if (!stats.isDirectory()) return stats.size
    let bytes = 0
    for (const name of await readdir(path)) {
      const size = await du(join(path, name))
      if (size === undefined) return undefined
      bytes += size
    }
    return bytes
  } catch { return undefined }
}
