import { buildSync } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const root = join(import.meta.dirname, '..', '..')

// Node 22.19 needs explicit type stripping; bundle the real path helpers once instead.
const { outputFiles } = buildSync({
  stdin: { contents: "export { executableName } from '../../src/main/paths.ts'; export { decodeMediaPath } from '../../src/shared/paths.ts'", resolveDir: import.meta.dirname },
  bundle: true, platform: 'node', format: 'esm', write: false,
})
const paths = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
export const decodeMediaPath = paths.decodeMediaPath
export const bundledBinary = name => join(root, 'resources', 'bin', `${process.platform}-${process.arch}`, paths.executableName(name))
export const speechFixture = join(root, 'test', 'fixtures', 'speech', 'narration-music.flac')

export function recordedTranscriptEnv(tmp) {
  mkdirSync(join(tmp, 'ud'), { recursive: true })
  writeFileSync(join(tmp, 'ud', 'config.json'), JSON.stringify({ whisper: { engine: 'system', mode: 'custom' } }))
  return { ...process.env, MANUL_TOOLS: join(tmp, 'tools'), MANUL_PROJECTS: join(tmp, 'projects') }
}

// Exercise persisted transcripts and real export/mix, independently of model downloads or local STT engines.
export async function loadRecordedTranscript(win, words) {
  await win.waitForFunction(async () => !!(await window.manul.tabs.get()).active)
  const dir = await win.evaluate(() => window.manul.tabs.get().then(t => t.active))
  await win.evaluate(d => window.manul.project.close(d), dir)
  const p = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  const media = p.versions[0].path
  const segments = []
  for (const word of words) {
    const last = segments.at(-1)
    if (last && !/[.?!]$/.test(last.words.at(-1).w) && word.s - last.e <= 0.8) {
      last.words.push(word); last.e = word.e; last.text += ` ${word.w}`
    } else segments.push({ s: word.s, e: word.e, text: word.w, words: [word] })
  }
  mkdirSync(join(dir, 'transcripts'), { recursive: true })
  const transcript = 'transcripts/recorded.json'
  writeFileSync(join(dir, transcript), JSON.stringify({ media, language: 'en', model: 'recorded reference', createdAt: Date.now(), segments }))
  p.transcripts = { ...p.transcripts, [media]: transcript }
  writeFileSync(join(dir, 'project.json'), JSON.stringify(p))
  await win.reload()
  await win.waitForSelector('video')
  await win.waitForFunction(d => window.manul.project.open(d).then(proj => Object.keys(proj.transcripts || {}).length > 0), dir)
  return dir
}
