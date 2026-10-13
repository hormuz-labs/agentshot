// Preview copies: heavy or hard-to-decode footage gets a light 720p H.264 copy (keyframe every half second, so
// scrubbing is instant). The player uses it; renders and exports always use the original.
type Info = { width: number; height: number; codec: string; bitrate?: number; pixfmt?: string }
export type PreviewState = { status: 'running' | 'ready' | 'failed' | 'unneeded'; progress?: number; error?: string }

const SMOOTH = new Set(['h264', 'vp8', 'vp9', 'av1'])

export function needsProxy(i: Info): false | { why: string } {
  if (!i.width || !i.height || i.codec === 'none') return false
  if (!SMOOTH.has(i.codec)) return { why: i.codec }
  if (/10le|12le|422|444/.test(i.pixfmt || '')) return { why: `${i.codec} ${i.pixfmt}` }
  if (Math.min(i.width, i.height) > 1080) return { why: 'larger than 1080p' }
  if ((i.bitrate || 0) > 40e6) return { why: 'very high bitrate' }
  return false
}

/** ffmpeg arguments (after -y) for a preview copy; hardware encoding on macOS. */
export function proxyArgs(input: string, out: string, platform: string, software = false): string[] {
  const video = platform === 'darwin' && !software
    ? ['-c:v', 'h264_videotoolbox', '-b:v', '5M', '-allow_sw', '1']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23']
  return ['-i', input, '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', "scale=-2:'min(720,ih)',format=yuv420p", ...video, '-g', '15', '-keyint_min', '15',
    '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', out]
}
