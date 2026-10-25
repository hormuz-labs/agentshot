// Edit a motion clip on the picture: the live clip (sandboxed), its elements outlined. Drag an element to move it
// (written back into the clip, which re-renders); click one to talk to the agent about just that element.
import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { cn, mediaUrl } from '@/lib/utils'
import type { ClipInfo } from '../../../shared/types'

type El = { id: string; x: number; y: number; w: number; h: number; text: string }
type Props = { dir: string; clip: ClipInfo; width: number; height: number; time: number; picked?: string; onPick(id: string): void; onClose(): void }

export function ClipEditor({ dir, clip, width, height, time, picked, onPick, onClose }: Props) {
  const frame = useRef<HTMLIFrameElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const [els, setEls] = useState<El[]>([])
  const [drag, setDrag] = useState<{ id: string; x: number; y: number; dx: number; dy: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const src = `${mediaUrl(`${dir}/clips/${clip.id}/clip.html`)}?v=${clip.updatedAt}`

  useEffect(() => {
    const ro = new ResizeObserver(() => { const r = box.current!.getBoundingClientRect(); setScale(Math.min(r.width / width, r.height / height)) })
    ro.observe(box.current!)
    return () => ro.disconnect()
  }, [width, height])

  useEffect(() => {
    const on = (e: MessageEvent) => { if (e.source === frame.current?.contentWindow && e.data?.manul === 'elements') setEls(e.data.list) }
    addEventListener('message', on)
    return () => removeEventListener('message', on)
  }, [])

  const local = Math.max(0, Math.min(clip.duration - 1e-3, time))
  useEffect(() => { frame.current?.contentWindow?.postMessage({ manul: 'seek', t: local }, '*') }, [local, src])

  const post = (m: object) => frame.current?.contentWindow?.postMessage(m, '*')
  const W = width * scale, H = height * scale

  return (
    <div ref={box} className="absolute inset-0 z-10 flex items-center justify-center bg-black">
      <div className="relative overflow-hidden" style={{ width: W, height: H }}>
        <iframe ref={frame} src={src} sandbox="allow-scripts" title={clip.title}
          onLoad={() => post({ manul: 'seek', t: local })}
          style={{ width, height, transform: `scale(${scale})`, transformOrigin: '0 0', border: 0 }} className="pointer-events-none absolute left-0 top-0" />
        {els.map(el => (
          <div key={el.id}
            className={cn('absolute cursor-move rounded-sm border border-dashed', picked === el.id ? 'border-note bg-note/10' : 'border-amber/60 hover:border-amber hover:bg-amber/10')}
            style={{ left: el.x * scale, top: el.y * scale, width: el.w * scale, height: el.h * scale }}
            onPointerDown={e => { (e.target as Element).setPointerCapture(e.pointerId); setDrag({ id: el.id, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }) }}
            onPointerMove={e => {
              if (!drag || drag.id !== el.id) return
              const mx = (e.clientX - drag.x) / scale, my = (e.clientY - drag.y) / scale
              post({ manul: 'move', id: el.id, dx: mx - drag.dx, dy: my - drag.dy })
              setDrag({ ...drag, dx: mx, dy: my })
            }}
            onPointerUp={async () => {
              const d = drag
              setDrag(null)
              if (!d) return
              if (Math.abs(d.dx) < 2 && Math.abs(d.dy) < 2) { onPick(el.id); return }
              setSaving(true)
              try { await window.agentshot.clips.move(dir, clip.id, el.id, d.dx, d.dy) } finally { setSaving(false) }
            }}
          >
            <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-black/70 px-1 text-[10px] text-amber">{el.id}</span>
          </div>
        ))}
      </div>
      <div className="absolute left-3 top-3 flex items-center gap-2 rounded-lg bg-black/70 px-2.5 py-1 text-xs">
        <span className="font-medium text-amber">{clip.title}</span>
        <span className="text-dim">drag to move · click to ask about an element</span>
        {saving && <Loader2 className="size-3.5 animate-spin text-amber" />}
        <button onClick={onClose} className="ml-1 text-faint hover:text-fg" title="Done (Esc)"><X className="size-3.5" /></button>
      </div>
    </div>
  )
}
