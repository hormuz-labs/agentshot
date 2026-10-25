import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PreviewCopies } from '../src/main/proxies'
import { FFMPEG, probe } from '../src/main/media'
import type { Project } from '../src/shared/types'

const ff = (...args: string[]) => execFileSync(FFMPEG, ['-y', '-v', 'error', ...args])
describe('preview lifecycle', () => {
  it('publishes a real preview, uses unique names for identically named sources and recovers deleted copies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-preview-'))
    try {
      mkdirSync(join(dir, 'media')); mkdirSync(join(dir, 'renders'))
      for (const folder of ['media', 'renders']) ff('-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=1', '-c:v', 'prores_ks', join(dir, folder, 'same.mov'))
      const p = { dir, media: { 'media/same.mov': await probe(join(dir, 'media/same.mov')), 'renders/same.mov': await probe(join(dir, 'renders/same.mov')) } } as unknown as Project
      const events: string[] = []
      const previews = new PreviewCopies({ publish: async () => {}, notify: (_d, _m, state) => events.push(state.status), platform: 'linux' })
      await Promise.all([previews.ensure(p, 'media/same.mov'), previews.ensure(p, 'renders/same.mov')])
      expect(previews.state(dir, 'media/same.mov')?.status).toBe('ready')
      expect(previews.state(dir, 'renders/same.mov')?.status).toBe('ready')
      expect(p.proxies!['media/same.mov']).not.toEqual(p.proxies!['renders/same.mov'])
      rmSync(join(dir, p.proxies!['media/same.mov']))
      await previews.ensure(p, 'media/same.mov')
      expect(previews.state(dir, 'media/same.mov')?.status).toBe('ready')
      expect(events.filter(s => s === 'ready')).toHaveLength(3)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  it('falls back from hardware encoding, clears stale mappings, and stops spinning after failure until retry', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-preview-fail-'))
    try {
      ff('-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=25:d=1', '-c:v', 'prores_ks', join(dir, 'source.mov'))
      mkdirSync(join(dir, 'proxies')); writeFileSync(join(dir, 'proxies/bad.mp4'), 'interrupted render')
      const p = { dir, media: { 'source.mov': await probe(join(dir, 'source.mov')) }, proxies: { 'source.mov': 'proxies/bad.mp4' } } as unknown as Project
      let calls = 0, fail = true
      const previews = new PreviewCopies({ publish: async () => {}, notify: () => {}, platform: 'darwin', run: async (args, cwd) => {
        calls++
        if (fail || args.includes('h264_videotoolbox')) throw new Error('Encoder unavailable')
        execFileSync(FFMPEG, ['-y', '-v', 'error', ...args], { cwd })
      } })
      await previews.ensure(p, 'source.mov')
      expect(previews.state(dir, 'source.mov')).toMatchObject({ status: 'failed', error: 'Encoder unavailable' })
      expect(p.proxies?.['source.mov']).toBeUndefined()
      expect(calls).toBe(2)
      await previews.ensure(p, 'source.mov'); expect(calls).toBe(2)
      fail = false
      await previews.ensure(p, 'source.mov', true)
      expect(previews.state(dir, 'source.mov')?.status).toBe('ready')
      expect(calls).toBe(4)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
