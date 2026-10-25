// Fetch the models AgentShot's model runners use (scripts/build-ml.sh) into resources/models/. The same files on every
// platform; each SHA-256 checked against the hashes pinned here. Runs on `npm install`.
//   speaker-segmentation.onnx  pyannote segmentation 3.0 (MIT, github.com/pyannote), as converted by sherpa-onnx
//   speaker-embedding.onnx     3D-Speaker CAM++ zh/en (Apache-2.0, github.com/modelscope/3D-Speaker)
//   faces-yunet.onnx           YuNet 2023mar (MIT, github.com/opencv/opencv_zoo)
//   objects-yolox-tiny.onnx    YOLOX-Tiny, 80 COCO classes (Apache-2.0, github.com/Megvii-BaseDetection/YOLOX)
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SHERPA = 'https://github.com/k2-fsa/sherpa-onnx/releases/download'
export const MODELS = {
  'speaker-segmentation.onnx': {
    url: `${SHERPA}/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2`,
    sha256: '24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488',
    member: 'sherpa-onnx-pyannote-segmentation-3-0/model.onnx',
    fileSha256: '220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079',
  },
  'speaker-embedding.onnx': {
    url: `${SHERPA}/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx`,
    sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
  },
  'faces-yunet.onnx': {
    url: 'https://media.githubusercontent.com/media/opencv/opencv_zoo/47534e27c9851bb1128ccc0102f1145e27f23f98/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
  },
  'objects-yolox-tiny.onnx': {
    url: 'https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_tiny.onnx',
    sha256: '427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7',
  },
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'models')
const sha = buf => createHash('sha256').update(buf).digest('hex')

async function fetchOne(name, m) {
  const target = join(dir, name)
  const want = m.fileSha256 || m.sha256
  if (existsSync(target) && sha(readFileSync(target)) === want) return
  const res = await fetch(m.url, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  const got = sha(buf)
  if (got !== m.sha256) throw new Error(`${name}: checksum mismatch (got ${got}); refusing to use it`)
  mkdirSync(dir, { recursive: true })
  if (m.member) {
    const tmp = mkdtempSync(join(tmpdir(), 'agentshot-model-'))
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar'
    writeFileSync(join(tmp, 'a.tar.bz2'), buf)
    execFileSync(tar, ['-xjf', 'a.tar.bz2', m.member], { cwd: tmp, timeout: 60_000, windowsHide: true })
    const inner = readFileSync(join(tmp, m.member))
    if (sha(inner) !== m.fileSha256) throw new Error(`${name}: unexpected file in the archive`)
    copyFileSync(join(tmp, m.member), target)
    rmSync(tmp, { recursive: true, force: true })
  } else writeFileSync(target, buf)
  console.log(`  model ${name} (${(buf.length / 1e6).toFixed(1)} MB)`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dir, { recursive: true })
  if (process.env.MANUL_SKIP_MODELS || (process.platform === 'win32' && !process.argv.includes('--all'))) process.exit(0)
  for (const [name, m] of Object.entries(MODELS)) await fetchOne(name, m)
}
