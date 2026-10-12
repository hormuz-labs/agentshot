import { describe, expect, it } from 'vitest'
import { blinkAmount, cursorGaze, gestureDuration, gesturePose } from '../src/renderer/src/lib/mascot-motion'

describe('responsive cat choreography', () => {
  it('tracks outside the mascot hit area without sending the pupils beyond their eye sockets', () => {
    const box = { left: 300, top: 200, width: 76, height: 76 }
    expect(cursorGaze(0, 0, box)).toEqual({ x: -1, y: -1 })
    expect(cursorGaze(1500, 1000, box)).toEqual({ x: 1, y: 1 })
    expect(cursorGaze(338, 232.68, box).x).toBe(0)
  })

  it('reacts in the first 40ms, rises within 150ms, and settles completely', () => {
    expect(gesturePose('pet', .04).squash).toBeLessThan(-.08)
    expect(gesturePose('pet', .15).lift).toBeGreaterThan(.15)
    expect(gesturePose('pet', gestureDuration.pet + .01)).toEqual(gesturePose(null, 0))
  })

  it('holds a raised paw long enough to wave, then lowers it without a discontinuity', () => {
    expect(gesturePose('wave', .4).paw).toBeGreaterThan(.9)
    expect(gesturePose('wave', 1).paw).toBeGreaterThan(.9)
    expect(gesturePose('wave', 1.59).paw).toBeLessThan(.01)
    expect(gesturePose('wave', .4).wave).not.toBe(gesturePose('wave', .6).wave)
  })

  it('closes quickly and opens gently, including the second blink', () => {
    expect(blinkAmount(.065)).toBe(1)
    expect(blinkAmount(.15)).toBeGreaterThan(0)
    expect(blinkAmount(.23)).toBe(0)
    expect(blinkAmount(.375, true)).toBeCloseTo(1)
    expect(blinkAmount(-.01)).toBe(0)
  })
})
