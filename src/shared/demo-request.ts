// The modal writes a complete user brief; chat remains the owner of execution, progress and the resulting version.
import type { DemoRequest } from './demo'

export type DemoChatRequest = Omit<DemoRequest, 'sync'> & { manualOffset?: number }
export function demoChatRequest(req: DemoChatRequest): { text: string; files: string[] } {
  if (!req.screen || !req.camera || req.screen === req.camera) throw new Error('Choose two different recordings.')
  if (!req.layout?.width || !req.layout.height || !req.layout.shape || !req.corner) throw new Error('Choose the face shape, position and size first.')
  if (req.manualOffset != null && !Number.isFinite(req.manualOffset)) throw new Error('Manual sync needs a valid offset in seconds.')
  const shape = req.layout.shape === 'rounded' ? 'rounded rectangle' : req.layout.shape
  const pacing = req.cleanup === 'none' ? 'Keep everything — sync and compose only (cleanup: none).' : req.cleanup === 'tight' ? 'Tighter — remove jointly idle time while preserving speech and screen actions (cleanup: tight).' : 'Natural — remove jointly idle time while preserving speech and screen actions (cleanup: natural).'
  const lines = [
    'Create a synced screen + face-camera demo using these choices:',
    `Face layout: ${shape}, ${req.corner.replace('-', ' ')}, ${req.layout.width} × ${req.layout.height} px.`,
    `Screen recording: ${req.screen}`,
    `Face-camera recording: ${req.camera}`,
    `Pacing: ${pacing}`,
    `Narration: ${req.audio || 'screen'} microphone (audio: ${req.audio || 'screen'}). Mute the duplicate microphone.`,
    `Coverage: ${req.overlapOnly ? 'Only keep footage covered by both recordings (overlap_only: true).' : 'Keep useful screen footage outside camera coverage; hide the face there (overlap_only: false).'}`,
    req.manualOffset != null ? `Sync: use my manual alignment, screen time = camera time + ${req.manualOffset} seconds (manual_offset: ${req.manualOffset}).` : 'Sync: automatically match common audio and check clock drift.',
    'Use the demo editing tools, show the result beside this chat, and report the measured stale time removed. These layout choices are already selected; do not ask them again.',
  ]
  return { text: lines.join('\n'), files: [req.screen, req.camera] }
}
