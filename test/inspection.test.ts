import { describe, expect, it } from 'vitest'
import { inspectionTimes, InspectionGuard } from '../src/main/inspection'

describe('frame inspection loop prevention', () => {
  it('deduplicates eight sub-frame samples and labels the information limit', () => {
    const sample = inspectionTimes({ duration: 35, fps: 25 }, { t0: 26.51, t1: 26.52, count: 8 })
    expect(sample.times).toEqual([26.52])
    expect(sample.note).toContain('only 1 distinct')
    expect(inspectionTimes({ duration: 35, fps: 25 }, { t0: 0, t1: 30, count: 8 }).times).toHaveLength(8)
  })
  it('blocks near-identical repeated regions and terminates continued looping', () => {
    const guard = new InspectionGuard()
    for (const t of [26.52, 26.56, 26.60]) expect(guard.inspect('chat', 'film', [t]).blocked).toBe(false)
    expect(guard.inspect('chat', 'film', [26.64])).toMatchObject({ blocked: true, stop: false })
    expect(guard.inspect('chat', 'film', [26.68])).toMatchObject({ blocked: true, stop: true })
    guard.reset('chat')
    expect(guard.inspect('chat', 'film', [26.52]).blocked).toBe(false)
  })
  it('bounds total inspection work while allowing different regions and new user turns', () => {
    const guard = new InspectionGuard()
    for (let i = 0; i < 16; i++) expect(guard.inspect('chat', 'film', [i]).blocked).toBe(false)
    expect(guard.inspect('chat', 'film', [17]).blocked).toBe(true)
    expect(guard.inspect('other', 'film', [17]).blocked).toBe(false)
  })
})
