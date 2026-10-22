// Motion video formats. A motion video (no footage) is made in one of these; a gallery example picks the closest to its
// own picture (main/gallery.ts aspectOf).

export type Aspect = '16:9' | '9:16' | '1:1'
export const ASPECTS: Record<Aspect, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
}

/** The closest of these formats to a picture's size. */
export function aspectOf(e: { width?: number; height?: number }): Aspect {
  const r = (e.width || 16) / (e.height || 9)
  return r > 1.2 ? '16:9' : r < 0.83 ? '9:16' : '1:1'
}
