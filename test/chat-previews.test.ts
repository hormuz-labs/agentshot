// Light copies of film files for the editor page inside a chat, when the chat's frame won't load video from this
// computer and the page gets the file through MCP instead (src/main/chat-previews.ts).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ChatPreviews } from '../src/main/chat-previews'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const folder = () => { const d = mkdtempSync(join(tmpdir(), 'chat-previews-')); dirs.push(d); return d }
const never = new AbortController().signal

function setup() {
  const project = folder(), cache = folder()
  writeFileSync(join(project, 'talk.mov'), 'film')
  const run = vi.fn(async (args: string[]) => { writeFileSync(args[args.length - 1], 'light') })
  return { project, cache, run, previews: new ChatPreviews(cache, run) }
}

describe('light copies for the chat', () => {
  it('makes a small H.264 copy that starts playing at once, in its own cache', async () => {
    const { project, cache, run, previews } = setup()
    const out = await previews.get(project, 'talk.mov', never)
    expect(out.startsWith(cache)).toBe(true)
    const args = run.mock.calls[0][0]
    expect(args).toEqual(expect.arrayContaining(['-i', join(project, 'talk.mov'), '-c:v', 'libx264', '-movflags', '+faststart']))
    expect(args.join(' ')).toMatch(/scale=/)
    expect(args.at(-1)).not.toBe(out) // written aside, then moved in: never a half-made copy
  })

  it('makes it once, even when asked twice at the same time', async () => {
    const { project, run, previews } = setup()
    const [a, b] = await Promise.all([previews.get(project, 'talk.mov', never), previews.get(project, 'talk.mov', never)])
    expect(a).toBe(b)
    await previews.get(project, 'talk.mov', never)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('makes a new one when the file changes', async () => {
    const { project, run, previews } = setup()
    const a = await previews.get(project, 'talk.mov', never)
    writeFileSync(join(project, 'talk.mov'), 'a longer film'); utimesSync(join(project, 'talk.mov'), new Date(), new Date(Date.now() + 5000))
    const b = await previews.get(project, 'talk.mov', never)
    expect(b).not.toBe(a)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('tries again after a failure', async () => {
    const { project, run, previews } = setup()
    run.mockRejectedValueOnce(new Error('ffmpeg broke'))
    await expect(previews.get(project, 'talk.mov', never)).rejects.toThrow('ffmpeg broke')
    await expect(previews.get(project, 'talk.mov', never)).resolves.toBeTruthy()
  })
})
