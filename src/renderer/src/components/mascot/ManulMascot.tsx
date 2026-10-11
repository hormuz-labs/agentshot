import { useEffect, useRef, useState } from 'react'
import { mascotLabels, type MascotState } from '@/lib/mascot'
import type { MascotScene } from './scene'

/** A local SVG stays visible during lazy loading and on machines without WebGL. */
function CatFallback() {
  return <svg viewBox="0 0 160 160" fill="none" aria-hidden="true" className="manul-mascot-fallback">
    <ellipse cx="80" cy="139" rx="45" ry="7" fill="#736b5d" opacity=".12" />
    <path d="M114 128c30 6 37-17 19-22" stroke="#888378" strokeWidth="14" strokeLinecap="round" />
    <ellipse cx="80" cy="106" rx="35" ry="33" fill="#99958b" />
    <ellipse cx="80" cy="113" rx="23" ry="23" fill="#c6bca8" />
    <ellipse cx="65" cy="134" rx="13" ry="8" fill="#b7b0a2" /><ellipse cx="95" cy="134" rx="13" ry="8" fill="#b7b0a2" />
    <ellipse cx="39" cy="52" rx="12" ry="16" fill="#99958b" /><ellipse cx="121" cy="52" rx="12" ry="16" fill="#99958b" />
    <ellipse cx="39" cy="53" rx="7" ry="10" fill="#9e8578" /><ellipse cx="121" cy="53" rx="7" ry="10" fill="#9e8578" />
    <path d="M28 86l-5-7 7-3-4-9 8-2c3-29 89-29 92 0l8 2-4 9 7 3-5 7 3 8-10 2c-14 22-76 22-90 0l-10-2 3-8Z" fill="#aaa496" />
    <ellipse cx="58" cy="76" rx="13" ry="10" fill="#514943" /><ellipse cx="102" cy="76" rx="13" ry="10" fill="#514943" />
    <ellipse cx="58" cy="77" rx="10" ry="8" fill="#cda047" /><ellipse cx="102" cy="77" rx="10" ry="8" fill="#cda047" />
    <ellipse cx="59" cy="78" rx="4" ry="6" fill="#242721" /><ellipse cx="101" cy="78" rx="4" ry="6" fill="#242721" />
    <circle cx="55" cy="74" r="2" fill="#fff8e9" /><circle cx="98" cy="74" r="2" fill="#fff8e9" />
    <path d="m46 68 23 3m22 0 23-3" stroke="#969184" strokeWidth="6" strokeLinecap="round" />
    <ellipse cx="72" cy="95" rx="12" ry="10" fill="#d3c6ac" /><ellipse cx="88" cy="95" rx="12" ry="10" fill="#d3c6ac" />
    <path d="M74 86q6-4 12 0l-6 6-6-6Z" fill="#67504b" /><path d="M80 92v7m0-1-5 3m5-3 5 3" stroke="#67504b" strokeWidth="2" strokeLinecap="round" />
    <path d="m47 85-6 5m7 0-4 5m68-10 6 5m-7 0 4 5" stroke="#62594e" strokeWidth="2.5" strokeLinecap="round" />
    <path d="m58 97-30-4m30 7-31 3m75-6 30-4m-30 7 31 3" stroke="#e3d6bb" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
}

export function ManulMascot({ state = 'idle', size = 112, active = true, className = '' }: {
  state?: MascotState; size?: number; active?: boolean; className?: string
}) {
  const host = useRef<HTMLButtonElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef({ state, active, pointer: { x: 0, y: 0 }, hop: false, reduced: false })
  live.current.state = state; live.current.active = active
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  live.current.reduced = reduced
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    preference.addEventListener('change', change); return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (failed || !active || !host.current || !canvas.current) return
    const element = host.current, surface = canvas.current
    let scene: MascotScene | undefined, stopped = false, frame = 0, visible = false, lastFrame = 0, clock = 0, lastTime = 0
    const onLost = (e: Event) => { e.preventDefault(); setReady(false); setFailed(true) }
    surface.addEventListener('webglcontextlost', onLost)
    const draw = (now: number) => {
      frame = 0
      if (stopped || !scene || !visible || document.hidden || !live.current.active) return
      // Keep animation time frozen when the app or a project tab is hidden.
      if (lastTime) clock += Math.min((now - lastTime) / 1000, .1)
      lastTime = now
      const state = live.current.state
      const reduced = live.current.reduced
      const fps = state === 'idle' || state === 'sleeping' ? 24 : 30
      if (now - lastFrame >= 1000 / fps || reduced) {
        if (live.current.hop && !reduced) { scene.hop(clock); live.current.hop = false }
        scene.render(clock, state, reduced, live.current.pointer, document.documentElement.classList.contains('dark'))
        lastFrame = now
      }
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      lastTime = 0
      if (!frame && !stopped && visible && !document.hidden) frame = requestAnimationFrame(draw)
    }
    const resize = new ResizeObserver(() => {
      if (scene && element.clientWidth && element.clientHeight) { scene.resize(element.clientWidth, element.clientHeight); wake() }
    })
    resize.observe(element)
    const observer = new IntersectionObserver(entries => {
      visible = entries[0].isIntersecting
      if (visible) wake(); else { cancelAnimationFrame(frame); frame = 0; lastTime = 0 }
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', wake)
    const theme = new MutationObserver(wake); theme.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    element.addEventListener('mascot-update', wake)
    import('./scene').then(({ createMascotScene }) => {
      if (stopped) return
      try {
        scene = createMascotScene(surface); scene.resize(element.clientWidth, element.clientHeight)
        scene.render(0, live.current.state, live.current.reduced, live.current.pointer, document.documentElement.classList.contains('dark'))
        setReady(true); wake()
      } catch { setFailed(true) }
    }).catch(() => { if (!stopped) setFailed(true) })
    return () => {
      stopped = true; cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect(); theme.disconnect()
      document.removeEventListener('visibilitychange', wake); element.removeEventListener('mascot-update', wake)
      surface.removeEventListener('webglcontextlost', onLost); scene?.dispose(); setReady(false)
    }
  }, [active, failed])
  useEffect(() => { host.current?.dispatchEvent(new Event('mascot-update')) }, [state, reduced])
  return <button ref={host} type="button" className={`manul-mascot ${className}`} style={{ width: size, height: size }}
    data-mascot-state={state} data-mascot-renderer={ready ? 'webgl' : 'fallback'} data-reduced-motion={reduced}
    aria-label={`${mascotLabels[state]}. Pet Manul.`} title="Pet Manul"
    onPointerMove={e => {
      const bounds = e.currentTarget.getBoundingClientRect()
      live.current.pointer = { x: (e.clientX - bounds.left) / bounds.width * 2 - 1, y: (e.clientY - bounds.top) / bounds.height * 2 - 1 }
    }}
    onPointerLeave={() => { live.current.pointer = { x: 0, y: 0 } }}
    onClick={() => { live.current.hop = true; host.current?.dispatchEvent(new Event('mascot-update')) }}>
    {!ready && <CatFallback />}
    <canvas key={active ? 'active' : 'inactive'} ref={canvas} aria-hidden="true" className={ready ? 'is-ready' : ''} />
    {state === 'sleeping' && <span className="manul-mascot-sleep" aria-hidden="true">z<span>z</span></span>}
  </button>
}
