// Preview lifecycle is explicit: never leave the UI claiming work is running after a failure or for an unscheduled render.
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { asJob } from './jobs'
import { FFMPEG, probe } from './media'
import { needsProxy, proxyArgs, type PreviewState } from '../shared/proxy'
import type { Project } from '../shared/types'

type Runner = (args: string[], cwd: string, progress: (p: number) => void, duration: number) => Promise<void>
const run: Runner = (args, cwd, progress, duration) => new Promise((ok, fail) => {
  const child = spawn(FFMPEG, ['-y', '-v', 'error', '-progress', 'pipe:1', '-nostats', ...args], { cwd })
  let err = '', pending = ''
  child.stdout.on('data', d => {
    pending += d
    const lines = pending.split('\n'); pending = lines.pop() || ''
    for (const line of lines) { const m = /^out_time_us=(\d+)/.exec(line); if (m && duration > 0) progress(Math.min(1, Number(m[1]) / 1e6 / duration)) }
  })
  child.stderr.on('data', d => { err = (err + d).slice(-2000) })
  child.once('error', fail)
  child.once('close', code => code === 0 ? ok() : fail(new Error(err || `Preview encoding exited with code ${code}.`)))
})

export class PreviewCopies {
  private states = new Map<string, PreviewState>()
  private running = new Map<string, Promise<void>>()
  constructor(private deps: { publish(p: Project): Promise<void>; notify(dir: string, media: string, state: PreviewState): void; run?: Runner; platform?: string }) {}
  private key = (dir: string, media: string) => `${dir}|${media}`
  state(dir: string, media: string) { return this.states.get(this.key(dir, media)) }
  private set(p: Project, media: string, state: PreviewState) {
    this.states.set(this.key(p.dir, media), state); this.deps.notify(p.dir, media, state)
  }
  ensure(p: Project, media: string, retry = false): Promise<void> {
    const key = this.key(p.dir, media)
    if (this.running.has(key)) return this.running.get(key)!
    if (!retry && this.state(p.dir, media)?.status === 'ready' && p.proxies?.[media] && existsSync(join(p.dir, p.proxies[media]))) return Promise.resolve()
    if (!retry && this.state(p.dir, media)?.status === 'failed') return Promise.resolve()
    if (!p.media[media] || !needsProxy(p.media[media])) { this.set(p, media, { status: 'unneeded' }); return Promise.resolve() }
    this.set(p, media, { status: 'running', progress: 0 })
    const work = this.make(p, media).catch(async e => {
      const error = e instanceof Error ? e.message : String(e)
      this.set(p, media, { status: 'failed', error })
      if (p.proxies?.[media]) { delete p.proxies[media]; await this.deps.publish(p) }
    }).finally(() => this.running.delete(key))
    this.running.set(key, work)
    return work
  }
  private async make(p: Project, media: string) {
    const source = join(p.dir, media), info = p.media[media]
    const st = await stat(source)
    const hash = createHash('sha256').update(`${media}:${st.size}:${st.mtimeMs}:v2`).digest('hex').slice(0, 12)
    const out = join('proxies', `${basename(media).replace(/\.[^.]+$/, '')}-${hash}.mp4`)
    const old = p.proxies?.[media]
    // Recover old projects and interrupted renders. A mapped path alone is not evidence of a playable preview.
    const valid = async (rel: string) => {
      if (!existsSync(join(p.dir, rel))) return false
      try { const i = await probe(join(p.dir, rel)); return i.codec === 'h264' && i.width > 0 && Math.abs(i.duration - info.duration) < Math.max(0.2, 2 / (info.fps || 25)) } catch { return false }
    }
    if ((old === out || (old && !/-[a-f0-9]{12}\.mp4$/.test(old))) && await valid(old!)) { this.set(p, media, { status: 'ready', progress: 1 }); return }
    if (old) { delete p.proxies![media]; await this.deps.publish(p) }
    if (!await valid(out)) {
      await mkdir(join(p.dir, 'proxies'), { recursive: true })
      const temp = out.replace(/\.mp4$/, `.pending-${process.pid}.mp4`)
      try {
        await asJob(`Making a preview copy of ${basename(media)}`, 'import', async j => {
          let last = 0
          const progress = (fraction: number) => {
            j.progress(fraction)
            if (Date.now() - last > 200 || fraction === 1) { last = Date.now(); this.set(p, media, { status: 'running', progress: fraction }) }
          }
          const platform = this.deps.platform || process.platform, execute = this.deps.run || run
          try { await execute(proxyArgs(media, temp, platform), p.dir, progress, info.duration) }
          catch (e) {
            if (platform !== 'darwin') throw e
            j.progress(null, 'Trying software encoding')
            await execute(proxyArgs(media, temp, platform, true), p.dir, progress, info.duration)
          }
          if (!await valid(temp)) throw new Error('The preview copy could not be decoded or has an incomplete duration.')
          await rename(join(p.dir, temp), join(p.dir, out))
        }, { project: p.dir, doneTitle: `Preview copy of ${basename(media)} ready` })
      } finally { await rm(join(p.dir, temp), { force: true }) }
    }
    p.proxies = { ...p.proxies, [media]: out }
    await this.deps.publish(p)
    this.set(p, media, { status: 'ready', progress: 1 })
  }
}
