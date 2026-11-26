// Light copies of film files for AgentShot's editor inside a chat (src/mcp-app). A chat's frame may refuse video from
// this computer; the page then gets the file through MCP itself (src/main/mcp.ts, editor_media), so it should be
// small: at most 960 wide, H.264 and AAC, ready to play from the first bytes. Kept in their own cache, outside every
// project, and named after the file's path, size and time, so a changed file gets a new copy.
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Runs ffmpeg with these arguments (the last is the file it writes). */
export type Run = (args: string[], signal: AbortSignal) => Promise<void>

export class ChatPreviews {
  private making = new Map<string, Promise<string>>()
  constructor(private cache: string, private run: Run) {}

  async get(dir: string, rel: string, signal: AbortSignal): Promise<string> {
    const src = join(dir, rel)
    const s = await stat(src)
    const out = join(this.cache, `${createHash('sha256').update(`${src}\0${s.size}\0${s.mtimeMs}`).digest('hex').slice(0, 32)}.mp4`)
    if (existsSync(out)) return out
    const going = this.making.get(out)
    if (going) return going
    const made = this.make(src, out, signal).finally(() => this.making.delete(out))
    this.making.set(out, made)
    return made
  }

  private async make(src: string, out: string, signal: AbortSignal) {
    await mkdir(this.cache, { recursive: true })
    const part = `${out}.${randomUUID()}.part.mp4`
    try {
      await this.run(['-y', '-v', 'error', '-i', src, '-map', '0:v:0?', '-map', '0:a:0?',
        '-vf', "scale='min(960,iw)':-2:flags=bicubic,format=yuv420p", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30',
        '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-movflags', '+faststart', part], signal)
      await rename(part, out)
      return out
    } catch (e) { await rm(part, { force: true }); throw e }
  }
}
