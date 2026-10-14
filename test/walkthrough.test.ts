import { describe, expect, it } from 'vitest'
import { cropAt, cursorAt, drawCommands, filmLength, outTime, planWalkthrough, rippleTrack, stepRanges, subtract, type Take, type TakeEvent } from '../src/shared/walkthrough'

const take = (events: TakeEvent[], steps: Take['steps'], duration = 60, paused: Take['paused'] = []): Take => ({
  id: 't1', video: 'walkthroughs/t1/take.mp4', duration, width: 2560, height: 1440, fps: 30, viewport: { width: 1280, height: 720 },
  steps, events, paused, browser: 'manul', startedAt: 0,
})

describe('walkthrough plan', () => {
  it('splits the take at its step marks', () => {
    expect(stepRanges(take([], [{ t: 10, title: 'b' }, { t: 2, title: 'a' }]))).toEqual([{ s: 2, e: 10, title: 'a' }, { s: 10, e: 60, title: 'b' }])
    expect(stepRanges(take([], []))).toEqual([{ s: 0, e: 60, title: '' }])
  })

  it('subtracts ranges', () => {
    expect(subtract([{ s: 0, e: 10 }], [{ s: 2, e: 3 }, { s: 9, e: 12 }])).toEqual([{ s: 0, e: 2 }, { s: 3, e: 9 }])
  })

  it('cuts the idle time between actions and keeps the actions and their results', () => {
    // a click at 5 s, then the agent thinks for 20 s, then types at 26 s
    const t = take([{ t: 5, k: 'click', x: 100, y: 100 }, { t: 26, k: 'key' }, { t: 26.2, k: 'input' }], [{ t: 0, title: 'Open' }])
    const plan = planWalkthrough(t, [{ s: 5, e: 6 }], [])
    expect(plan.duration).toBeLessThan(6)
    expect(plan.cut).toBeGreaterThan(50)
    expect(outTime(plan.segments, 5)).not.toBeNull()
    expect(outTime(plan.segments, 26)).not.toBeNull()
    expect(outTime(plan.segments, 15)).toBeNull() // the thinking is gone
  })

  it('speeds through a long load nobody acted in', () => {
    const t = take([{ t: 2, k: 'click', x: 10, y: 10 }], [{ t: 0, title: 'Load' }])
    const plan = planWalkthrough(t, [{ s: 2, e: 14 }], [])
    expect(plan.segments.some(g => g.speed > 1)).toBe(true)
    expect(plan.spedUp).toBeGreaterThan(8)
    expect(plan.duration).toBeLessThan(5)
  })

  it('makes each step as long as its narration, leading the first action', () => {
    const t = take([{ t: 1, k: 'click', x: 640, y: 360 }, { t: 21, k: 'click', x: 100, y: 100 }], [{ t: 0.5, title: 'One' }, { t: 20, title: 'Two' }])
    const plan = planWalkthrough(t, [], [6, 2])
    const [one, two] = plan.steps
    expect(one.end - one.start).toBeGreaterThanOrEqual(6 + 0.3)
    expect(one.narration).toEqual({ at: one.start + 0.3, dur: 6 })
    expect(two.narration!.at).toBeCloseTo(two.start + 0.3, 3)
    // the click in step one lands after the voice has started
    expect(outTime(plan.segments, 1)!).toBeGreaterThan(one.narration!.at + 0.5)
    expect(plan.duration).toBeCloseTo(filmLength(plan.segments), 3)
  })

  it('leaves paused stretches out of the film', () => {
    const t = take([{ t: 3, k: 'click', x: 1, y: 1 }, { t: 12, k: 'click', x: 2, y: 2 }], [{ t: 0, title: 'a' }], 20, [{ s: 8, e: 16 }])
    const plan = planWalkthrough(t, [{ s: 0, e: 20 }], [])
    expect(outTime(plan.segments, 12)).toBeNull()
    expect(outTime(plan.segments, 3)).not.toBeNull()
  })

  it('glides the cursor into each click and draws a ripple there', () => {
    const t = take([{ t: 2, k: 'down', x: 1000, y: 600 }, { t: 2.1, k: 'click', x: 1000, y: 600 }], [{ t: 0, title: 'a' }])
    const plan = planWalkthrough(t, [], [])
    const T = outTime(plan.segments, 2)!
    expect(plan.clicks).toEqual([{ t: T, x: 2000, y: 1200 }]) // video pixels (2x the viewport)
    const p = cursorAt(plan.cursor, T)
    expect(p.x).toBeCloseTo(2000, 0)
    expect(p.y).toBeCloseTo(1200, 0)
    const mid = cursorAt(plan.cursor, T - 0.3)
    expect(mid.x).toBeGreaterThan(1280)
    expect(mid.x).toBeLessThan(2000)
  })

  it('uses an element\'s middle when a click reports no pointer (element.click())', () => {
    const t = take([{ t: 2, k: 'click', x: 0, y: 0, r: [100, 100, 50, 20] }], [{ t: 0, title: 'a' }])
    expect(planWalkthrough(t, [], []).clicks[0]).toMatchObject({ x: 250, y: 220 })
  })

  it('zooms in on nearby actions and out for a scroll', () => {
    const t = take([
      { t: 2, k: 'click', x: 200, y: 150, r: [150, 130, 120, 36] },
      { t: 3, k: 'key', r: [150, 130, 120, 36] },
      { t: 3.5, k: 'input', r: [150, 130, 120, 36] },
      { t: 8, k: 'wheel', x: 640, y: 360 },
      { t: 8.3, k: 'scroll' },
    ], [{ t: 0, title: 'a' }])
    const plan = planWalkthrough(t, [], [])
    const typing = outTime(plan.segments, 3)!
    const crop = cropAt(plan.zoom, typing, 2560, 1440)
    expect(crop.w).toBeLessThan(2560 / 1.3)
    expect(crop.x).toBe(0) // clamped inside the frame
    const scrolling = outTime(plan.segments, 8.3)!
    expect(cropAt(plan.zoom, scrolling, 2560, 1440).w).toBe(2560)
    expect(planWalkthrough(t, [], [], { zoom: false }).zoom).toHaveLength(1)
  })

  it('writes per-frame commands only for changes', () => {
    const t = take([{ t: 2, k: 'down', x: 1000, y: 600 }], [{ t: 0, title: 'a' }], 6)
    const plan = planWalkthrough(t, [], [])
    const cmds = drawCommands(plan, { width: 2560, height: 1440, outWidth: 1920, outHeight: 1080, fps: 30, cursor: { hotX: 4, hotY: 2 }, ripple: { size: 96, dur: 0.5 } })
    const lines = cmds.trim().split('\n')
    expect(lines[0]).toMatch(/^0\.0000 crop@zoom w 2560, crop@zoom h 1440, crop@zoom x 0, crop@zoom y 0, overlay@cursor x \d+, overlay@cursor y \d+;$/)
    expect(cmds).toContain('overlay@ripple x')
    expect(lines.length).toBeLessThan(Math.ceil(plan.duration * 30))
  })

  it('times the ripple layer to the clicks', () => {
    const list = rippleTrack([{ t: 1, x: 0, y: 0 }, { t: 1.2, x: 0, y: 0 }], 3, { fps: 30, frames: 15, blank: 'blank.png', frame: i => `r${i}.png` })
    const durations = [...list.matchAll(/duration (\S+)/g)].map(m => Number(m[1]))
    expect(durations.reduce((a, b) => a + b, 0)).toBeCloseTo(3, 2)
    expect(list.startsWith('ffconcat version 1.0\nfile \'blank.png\'\nduration 1.0000\nfile \'r0.png\'')).toBe(true)
    expect(list.match(/r0\.png/g)).toHaveLength(2)
  })
})

describe('walkthrough plan: skipped steps', () => {
  it('leaves a step that went wrong out of the film', () => {
    const t = take([{ t: 2, k: 'click', x: 1, y: 1 }, { t: 12, k: 'click', x: 2, y: 2 }, { t: 22, k: 'click', x: 3, y: 3 }],
      [{ t: 0, title: 'Create' }, { t: 10, title: 'Create' }, { t: 20, title: 'Name' }], 30)
    const plan = planWalkthrough(t, [], [undefined, 1, 3], { skip: [0] })
    expect(outTime(plan.segments, 2)).toBeNull()
    expect(plan.steps.map(s => [s.index, s.narration?.dur])).toEqual([[1, 1], [2, 3]])
    expect(outTime(plan.segments, 12)).not.toBeNull()
    expect(plan.steps.map(s => s.title)).toEqual(['Create', 'Name'])
  })
})

describe('telling a walkthrough from a motion video', () => {
  it('reads it from what the user asks for', async () => {
    const { wantsWalkthrough } = await import('../src/shared/walkthrough')
    for (const p of ['Make a product walkthrough of my web app', 'walkthrough of linear.app: create an issue', 'Demo of https://acme.com signing up',
      'show people how to make a board in trello.com', 'a product tour of our dashboard', 'Tutorial for my app: inviting teammates'])
      expect(wantsWalkthrough(p), p).toBe(true)
    for (const p of ['Make an animated product demo for my app', 'A kinetic typography intro for my podcast', 'A 15 second logo reveal',
      'Explainer about how photosynthesis works', 'Make a video like this one', ''])
      expect(wantsWalkthrough(p), p).toBe(false)
  })
})
