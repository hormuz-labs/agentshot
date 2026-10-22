import { describe, expect, it } from 'vitest'
import { demoChatRequest } from '../src/shared/demo-request'
import { DemoBriefs } from '../src/main/demo-brief'

describe('Auto Demo modal → chat brief', () => {
  const base = { screen: 'media/screen.mov', camera: 'media/camera.mp4', corner: 'bottom-left' as const,
    layout: { shape: 'rounded' as const, width: 400, height: 224 }, cleanup: 'tight' as const, audio: 'camera' as const, overlapOnly: true }
  it('carries recordings and every selected option in a readable user message', () => {
    const request = demoChatRequest({ ...base, manualOffset: -15.37 })
    expect(request.files).toEqual([base.screen, base.camera])
    expect(request.text).toContain('rounded rectangle, bottom left, 400 × 224 px')
    expect(request.text).toContain('cleanup: tight')
    expect(request.text).toContain('audio: camera')
    expect(request.text).toContain('overlap_only: true')
    expect(request.text).toContain('manual_offset: -15.37')
    const briefs = new DemoBriefs()
    briefs.input('chat', request.text)
    expect(briefs.resolve('chat', 1920, 1080)).toMatchObject({ corner: 'bottom-left', layout: { shape: 'rounded', width: 400, height: 224 } })
    expect(briefs.resolve('chat', 1920, 1080).questions).toBeUndefined()
  })
  it('keeps sync-only and automatic sync distinct from cleanup and manual alignment', () => {
    const request = demoChatRequest({ ...base, cleanup: 'none', overlapOnly: false })
    expect(request.text).toContain('sync and compose only (cleanup: none)')
    expect(request.text).toContain('automatically match common audio')
    expect(request.text).not.toContain('manual_offset')
    expect(request.text).toContain('overlap_only: false')
  })
  it('rejects incomplete selections before sending', () => {
    expect(() => demoChatRequest({ ...base, camera: base.screen })).toThrow(/different/)
    expect(() => demoChatRequest({ ...base, manualOffset: NaN })).toThrow(/offset/)
  })
})
