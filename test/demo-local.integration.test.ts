// Opt-in reproduction with a user's project; copy inputs to temp and never edit the original project/history.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { expect, it } from 'vitest'
import { planDemo } from '../src/main/demo'
import { composeArgs, duration } from '../src/shared/timeline'
import { FFMPEG, probe } from '../src/main/media'
import type { Project, Transcript } from '../src/shared/types'

it.skipIf(!process.env.MANUL_DEMO_REPRO)('composes the recorded demo without shortening its master timeline', async () => {
  const original = JSON.parse(readFileSync(join(process.env.MANUL_DEMO_REPRO!, 'project.json'), 'utf8')) as Project
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-demo-repro-'))
  try {
    const p = { ...original, dir }
    mkdirSync(join(dir, 'media'))
    for (const rel of Object.keys(p.files || {})) copyFileSync(join(original.dir, rel), join(dir, 'media', basename(rel)))
    const screen = Object.keys(p.files!).find(f => /Screen Recording/.test(f))!, camera = Object.keys(p.files!).find(f => f !== screen && p.files![f].kind === 'video')!
    const transcript = async (media: string) => JSON.parse(readFileSync(join(original.dir, original.transcripts![media]), 'utf8')) as Transcript
    const plan = await planDemo(p, { screen, camera, cleanup: 'natural', corner: 'top-right', layout: { shape: 'circle', border: 3, crop: { h: 0.6, y: 0.25, w: 1, x: 0 }, framing: { y: 0, zoom: 1, x: 0, fit: 'cover' } } }, transcript)
    console.log('Reproduction plan', { duration: plan.duration, cuts: plan.cuts, offset: plan.sync.offset, rate: plan.sync.rate })
    const tl = { ...plan.timeline, width: 720, height: 450, demo: { ...plan.timeline.demo!, layout: { ...plan.timeline.demo!.layout, width: 144, height: 144, x: 562, y: 14 } } }
    execFileSync(FFMPEG, ['-y', '-v', 'error', ...composeArgs(tl, { inputOf: i => i.kind === 'media' ? i.src : '', hasAudio: i => i.kind === 'media' && !!p.media[i.src]?.hasAudio, out: 'out.mp4' })], { cwd: dir, timeout: 60000 })
    const out = await probe(join(dir, 'out.mp4'))
    console.log('Reproduction duration', out.duration, 'expected', duration(tl))
    expect(Math.abs(out.duration - duration(tl))).toBeLessThan(0.15)
    if (p.media[screen].duration > 60 && p.media[screen].duration < 70) {
      expect(plan.cuts.some(r => r.s < 0.1 && r.e > 5)).toBe(true)
      expect(plan.cuts.some(r => r.s < 29.2 && r.e > 33.5)).toBe(true)
      expect(plan.timeline.demo?.summary?.staleRemoved).toBeGreaterThan(9)
    }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 90000)
