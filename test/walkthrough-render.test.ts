import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FFMPEG, probe } from '../src/main/media'
import { composeWalkthrough } from '../src/main/walkthrough'
import { outTime, type Take } from '../src/shared/walkthrough'

const ff = (...args: string[]) => execFileSync(FFMPEG, ['-v', 'error', '-y', ...args])

describe('walkthrough rendering with the real bundled FFmpeg', () => {
  it('condenses a take, paces it to its voices and draws zoom, cursor and ripples', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'manul-walk-'))
    try {
      // a 24 s take at 2560x1440: a page that changes only when something is done (a click at 3 s, typing at 10 s)
      mkdirSync(join(dir, 'walkthroughs', 'w1'), { recursive: true })
      ff('-f', 'lavfi', '-i', 'color=c=white:s=2560x1440:r=30:d=24',
        '-vf', "drawbox=x=200:y=200:w=400:h=120:color=0x2266ff:t=fill:enable='gte(t,3)',drawbox=x=200:y=400:w=900:h=80:color=0x333333:t=4,drawtext=text='hello':x=220:y=415:fontsize=48:enable='gte(t,10)'",
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '60', join(dir, 'walkthroughs', 'w1', 'take.mp4'))
      const take: Take = {
        id: 'w1', video: 'walkthroughs/w1/take.mp4', duration: 24, width: 2560, height: 1440, fps: 30, viewport: { width: 1280, height: 720 },
        steps: [{ t: 0.5, title: 'Open it' }, { t: 8, title: 'Type a name' }],
        events: [
          { t: 3, k: 'down', x: 200, y: 130, r: [100, 100, 200, 60] }, { t: 3.08, k: 'click', x: 200, y: 130, r: [100, 100, 200, 60] },
          { t: 9.6, k: 'focus', r: [100, 200, 450, 40] }, ...[10, 10.2, 10.4, 10.6, 10.8].map(t => ({ t, k: 'input' as const, r: [100, 200, 450, 40] as [number, number, number, number] })),
        ],
        paused: [], browser: 'manul', startedAt: 0,
      }
      writeFileSync(join(dir, 'walkthroughs', 'w1', 'take.json'), JSON.stringify(take))
      // stand-in voices: tones of known length
      const spoken: string[] = []
      const speak = async (text: string, _v: string | undefined, _s: string | undefined, name: string) => {
        spoken.push(text)
        mkdirSync(join(dir, 'generated'), { recursive: true })
        ff('-f', 'lavfi', '-i', `sine=frequency=440:duration=${text.length / 10}`, join(dir, 'generated', `voice-${name}.wav`))
        return `generated/voice-${name}.wav`
      }
      const lines = ['Click the blue button to start a project.', 'Name it.']
      const r = await composeWalkthrough(dir, { take: 'w1', narration: lines }, { speak })
      expect(spoken).toEqual(lines)
      const info = await probe(join(dir, r.file))
      expect(info.width).toBe(1920)
      expect(info.height).toBe(1080)
      expect(info.hasAudio).toBe(true)
      expect(info.duration).toBeCloseTo(r.plan.duration, 1)
      expect(r.plan.duration).toBeLessThan(take.duration) // the idle time between the steps is gone
      expect(r.plan.steps[0].end - r.plan.steps[0].start).toBeGreaterThan(lines[0].length / 10)
      // the clicked button is zoomed in on: at the click, its blue fills more of the frame than in the take
      const at = outTime(r.plan.segments, 3.3)!
      ff('-ss', at.toFixed(2), '-i', join(dir, r.file), '-frames:v', '1', '-vf', 'scale=96:54,format=rgb24', '-f', 'rawvideo', join(dir, 'frame.rgb'))
      const px = execFileSync('cat', [join(dir, 'frame.rgb')])
      let blue = 0
      for (let i = 0; i < px.length; i += 3) if (px[i + 2] > 200 && px[i] < 80) blue++
      expect(blue / (96 * 54)).toBeGreaterThan((400 * 120) / (2560 * 1440) * 1.5)
      if (process.env.MANUL_KEEP) for (const t of [at - 0.4, at, at + 0.1, outTime(r.plan.segments, 10.4)!]) ff('-ss', t.toFixed(2), '-i', join(dir, r.file), '-frames:v', '1', join(process.env.MANUL_KEEP, `walk-${t.toFixed(2)}.png`))
      // composing again with the same words does not voice them again
      await composeWalkthrough(dir, { take: 'w1', narration: lines, zoom: false }, { speak })
      expect(spoken).toHaveLength(2)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 120_000)
})
