import { useEffect, useState } from 'react'
import type { PreviewState } from '../../../shared/proxy'

/** Subscribe before preparing: even a cached preview can finish between those two operations. */
export function usePreview(dir: string, media: string) {
  const [value, setValue] = useState<{ dir: string; media: string; state: PreviewState } | null>(null)
  useEffect(() => {
    if (!media) return
    let disposed = false, changed = false
    const off = window.manul.preview.onState((d, m, state) => {
      if (d === dir && m === media) { changed = true; setValue({ dir, media, state }) }
    })
    window.manul.preview.prepare(dir, media).then(state => {
      if (!disposed && !changed) setValue({ dir, media, state })
    }).catch(e => { if (!disposed) setValue({ dir, media, state: { status: 'failed', error: String(e.message || e) } }) })
    return () => { disposed = true; off() }
  }, [dir, media])
  const retry = () => {
    setValue({ dir, media, state: { status: 'running', progress: 0 } })
    window.manul.preview.prepare(dir, media, true).then(state => setValue({ dir, media, state })).catch(e => setValue({ dir, media, state: { status: 'failed', error: String(e.message || e) } }))
  }
  return { state: value?.dir === dir && value.media === media ? value.state : undefined, retry }
}
