// Placement inside a viewport. x/y move the source in viewport-width/height units, independently of its mask.
export type VideoFraming = { fit: 'contain' | 'cover'; zoom: number; x: number; y: number }
export function framing(patch: Partial<VideoFraming> = {}, fit: VideoFraming['fit'] = 'contain'): VideoFraming {
  for (const k of ['zoom', 'x', 'y'] as const) if (patch[k] != null && !Number.isFinite(patch[k])) throw new Error('Video framing values must be finite.')
  if (patch.fit && !['contain', 'cover'].includes(patch.fit)) throw new Error('Choose Fit or Fill for video framing.')
  return { fit: patch.fit || fit, zoom: Math.max(0.25, Math.min(4, patch.zoom ?? 1)), x: Math.max(-2, Math.min(2, patch.x ?? 0)), y: Math.max(-2, Math.min(2, patch.y ?? 0)) }
}
export function placedVideo(sourceW: number, sourceH: number, W: number, H: number, f: VideoFraming) {
  if (!sourceW || !sourceH) return { left: 0, top: 0, width: W, height: H }
  const scale = (f.fit === 'cover' ? Math.max(W / sourceW, H / sourceH) : Math.min(W / sourceW, H / sourceH)) * f.zoom
  const width = sourceW * scale, height = sourceH * scale
  return { width, height, left: (W - width) / 2 + f.x * W, top: (H - height) / 2 + f.y * H }
}
/** A clipped black viewport shared by normal footage and camera masks. Input timestamps must start at zero. */
export function framingGraph(input: string, output: string, W: number, H: number, fps: number, dur: number, f: VideoFraming) {
  const tag = `${output}frame`
  // Resize once from the original pixels, not down to the mask then back up during zoom.
  const width = Math.max(2, Math.round(W * f.zoom / 2) * 2), height = Math.max(2, Math.round(H * f.zoom / 2) * 2)
  return [`[${input}]scale=${width}:${height}:force_original_aspect_ratio=${f.fit === 'cover' ? 'increase' : 'decrease'}:flags=lanczos,setsar=1[${tag}src]`,
    `color=c=black:s=${W}x${H}:r=${fps}:d=${dur}[${tag}bg]`,
    `[${tag}bg][${tag}src]overlay=x='(main_w-overlay_w)/2+${f.x * W}':y='(main_h-overlay_h)/2+${f.y * H}':eof_action=pass:repeatlast=0:shortest=1[${output}]`]
}
