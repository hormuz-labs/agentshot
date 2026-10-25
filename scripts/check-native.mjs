// Build and packaging gate: never publish an app missing executables/models for its actual target.
import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export const NATIVE_TOOLS = ['ffmpeg', 'ffprobe', 'whisper-cli', 'agentshot-beats', 'agentshot-speakers', 'agentshot-vision', 'bsk']
export const NATIVE_MODELS = ['speaker-segmentation.onnx', 'speaker-embedding.onnx', 'faces-yunet.onnx', 'objects-yolox-tiny.onnx']
export function checkNative(root, { platform = process.platform, arch = process.arch, packaged = false, runChecks = true } = {}) {
  if (!['darwin', 'linux'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error(`Unsupported native target: ${platform}-${arch}`)
  const bin = packaged ? join(root, 'bin') : join(root, 'resources', 'bin', `${platform}-${arch}`)
  const models = packaged ? join(root, 'models') : join(root, 'resources', 'models')
  const missing = []
  for (const tool of [...NATIVE_TOOLS, ...(platform === 'linux' ? ['agentshot-fence'] : [])]) {
    const path = join(bin, tool)
    try { accessSync(path, constants.X_OK) } catch { missing.push(path); continue }
    const bytes = readFileSync(path).subarray(0, 32)
    if (platform === 'darwin') {
      // Native thin Mach-O executable, cputype = x86_64 or ARM64. Runner builds are per architecture.
      const cpu = arch === 'arm64' ? 0x0100000c : 0x01000007
      if (bytes.length < 8 || bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu) missing.push(`${path} (wrong architecture)`)
    } else {
      const cpu = arch === 'arm64' ? 183 : 62
      if (bytes.length < 20 || bytes.toString('ascii', 1, 4) !== 'ELF' || bytes[4] !== 2 || bytes.readUInt16LE(18) !== cpu) missing.push(`${path} (wrong architecture)`)
    }
  }
  for (const model of NATIVE_MODELS) if (!existsSync(join(models, model))) missing.push(join(models, model))
  // Validate the binaries actually start on this runner, including their linked native libraries/model loaders.
  if (runChecks && !missing.length && platform === process.platform && arch === process.arch) {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const result = spawnSync(join(bin, tool), ['-version'], { encoding: 'utf8', timeout: 10000 })
      if (result.error || result.status !== 0) missing.push(`${tool} (cannot execute)`)
    }
    const vision = spawnSync(join(bin, 'agentshot-vision'), ['--info', '--file', join(models, 'faces-yunet.onnx')], { encoding: 'utf8', timeout: 15000 })
    if (vision.error || vision.status !== 0) missing.push('agentshot-vision (cannot load bundled model)')
    const speakers = spawnSync(join(bin, 'agentshot-speakers'), [], { encoding: 'utf8', timeout: 10000 })
    if (speakers.error || speakers.status !== 2 || !/usage: agentshot-speakers/.test(speakers.stderr || '')) missing.push('agentshot-speakers (cannot execute)')
  }
  if (missing.length) throw new Error(`Native resources missing for ${platform}-${arch}:\n${missing.map(p => `- ${p}`).join('\n')}\nRun npm run setup:native before packaging. Release builds must contain every native tool and model.`)
  return { target: `${platform}-${arch}`, tools: NATIVE_TOOLS.length + (platform === 'linux' ? 1 : 0), models: NATIVE_MODELS.length }
}
export default async function beforePack(context) {
  const arch = context.arch === 3 ? 'arm64' : context.arch === 1 ? 'x64' : String(context.arch)
  if (context.electronPlatformName !== process.platform || arch !== process.arch)
    throw new Error('AgentShot packaging requires a native runner and Node architecture matching the target')
  if (context.electronPlatformName === 'win32') {
    const { checkPackaging } = await import('./check-packaging.mjs')
    checkPackaging({ root: context.packager.projectDir, platform: context.electronPlatformName, arch })
    return
  }
  checkNative(context.packager.projectDir, { platform: context.electronPlatformName, arch })
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '..')
  const result = checkNative(root, { packaged: process.argv.includes('--packaged') })
  console.log(`Native resources verified: ${result.target} · ${result.tools} executables · ${result.models} models`)
}
