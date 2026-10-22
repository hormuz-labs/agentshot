import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { Hand, Volume2, VolumeX, AudioLines } from 'lucide-react'
import { mascotLabels, type MascotState } from '@/lib/mascot'
import { cursorGaze, gestureDuration, petGestures, type MascotGesture } from '@/lib/mascot-motion'
import { catVoice, useMascotSound } from '@/lib/mascot-sound'
import { Tip } from '@/components/ui/tooltip'
import type { MascotScene } from './scene'

/** The same full-body brand portrait stays visible while loading and on machines without WebGL. */
function CatFallback() {
  return <img src="./manul.png" alt="" aria-hidden="true" className="manul-mascot-fallback" draggable={false} />
}

export type MascotHandle = { react(gesture: MascotGesture): void }

export function MascotControls({ onGesture, inline = false }: { onGesture(gesture: MascotGesture): void; inline?: boolean }) {
  const [sound, toggleSound] = useMascotSound()
  return <span className={inline ? 'manul-mascot-actions' : 'manul-mascot-controls'} role="group" aria-label="Manul interactions">
    <Tip label="High-five"><button type="button" aria-label="Raise Manul’s paw" onClick={() => onGesture('wave')}><Hand aria-hidden="true" /></button></Tip>
    <Tip label="Hear Manul’s growl"><button type="button" aria-label="Hear Manul’s growl" onClick={() => onGesture('growl')}><AudioLines aria-hidden="true" /></button></Tip>
    <Tip label={sound ? 'Mute mascot sounds' : 'Unmute mascot sounds'}><button type="button" aria-label={sound ? 'Mute mascot sounds' : 'Unmute mascot sounds'} aria-pressed={!sound} onClick={toggleSound}>{sound ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}</button></Tip>
  </span>
}

export const ManulMascot = forwardRef<MascotHandle, {
  state?: MascotState; size?: number; active?: boolean; className?: string; controls?: boolean
}>(function ManulMascot({ state = 'idle', size = 112, active = true, className = '', controls = true }, ref) {
  const host = useRef<HTMLButtonElement>(null), canvas = useRef<HTMLCanvasElement>(null)
  const live = useRef({ state, active, pointer: { x: 0, y: 0 }, gesture: null as MascotGesture | null, pressed: false, reduced: false, highFpsUntil: 0 })
  live.current.state = state; live.current.active = active
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [reaction, setReaction] = useState<MascotGesture | null>(null)
  const petCount = useRef(0), reactionTimer = useRef(0), pressHandled = useRef(false)
  const trigger = (gesture: MascotGesture, userGesture = true) => {
    if (!live.current.active) return
    live.current.gesture = gesture; live.current.highFpsUntil = performance.now() + 2000
    setReaction(gesture)
    window.clearTimeout(reactionTimer.current)
    reactionTimer.current = window.setTimeout(() => setReaction(null), gestureDuration[gesture] * 1000)
    host.current?.dispatchEvent(new Event('mascot-update'))
    if (userGesture) void catVoice(gesture === 'growl' ? 'growl' : gesture === 'wave' ? 'chirrup' : 'purr', true)
  }
  useImperativeHandle(ref, () => ({ react: trigger }))
  useEffect(() => () => window.clearTimeout(reactionTimer.current), [])
  live.current.reduced = reduced
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const change = () => setReduced(preference.matches)
    preference.addEventListener('change', change); return () => preference.removeEventListener('change', change)
  }, [])

  useEffect(() => {
    if (!active) return
    let bounds = host.current?.getBoundingClientRect(), hoverTimer = 0
    const measure = () => { bounds = host.current?.getBoundingClientRect() }
    const reset = () => {
      live.current.pointer = { x: 0, y: 0 }; live.current.pressed = false
      host.current?.style.setProperty('--cat-gaze-x', '0px'); host.current?.style.setProperty('--cat-gaze-y', '0px')
    }
    const move = (e: PointerEvent) => {
      if (document.hidden || live.current.reduced || !bounds || !host.current?.checkVisibility({ visibilityProperty: true })) return
      // Ignore other panels while a modal/tour covers this mascot.
      if (document.querySelector('[role="dialog"]')) { reset(); return }
      live.current.pointer = cursorGaze(e.clientX, e.clientY, bounds)
      live.current.highFpsUntil = performance.now() + 350
      host.current.style.setProperty('--cat-gaze-x', `${live.current.pointer.x * 3}px`)
      host.current.style.setProperty('--cat-gaze-y', `${live.current.pointer.y * 2}px`)
      const near = e.clientX >= bounds.left - 18 && e.clientX <= bounds.right + 18 && e.clientY >= bounds.top - 18 && e.clientY <= bounds.bottom + 18
      if (near && !hoverTimer) hoverTimer = window.setTimeout(() => {
        hoverTimer = -1
        if (!live.current.pressed && live.current.state === 'idle' && !live.current.gesture && performance.now() > live.current.highFpsUntil) trigger('peek', false)
      }, 800)
      else if (!near && hoverTimer) { window.clearTimeout(hoverTimer); hoverTimer = 0 }
    }
    const resize = new ResizeObserver(measure)
    if (host.current) resize.observe(host.current)
    window.addEventListener('pointermove', move, { passive: true })
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('blur', reset)
    document.addEventListener('pointerleave', reset)
    return () => {
      window.clearTimeout(hoverTimer); resize.disconnect()
      window.removeEventListener('pointermove', move); window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true); window.removeEventListener('blur', reset)
      document.removeEventListener('pointerleave', reset)
    }
  }, [active])

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
      const busy = state === 'thinking' || state === 'working' || state === 'speaking'
      const fps = busy || live.current.pressed || live.current.gesture || now < live.current.highFpsUntil ? 60 : state === 'idle' || state === 'sleeping' ? 30 : 40
      if (now - lastFrame >= 1000 / fps - .5 || reduced) {
        if (live.current.gesture) {
          if (!reduced) scene.react(live.current.gesture, clock)
          live.current.gesture = null
        }
        scene.render(clock, state, reduced, live.current.pointer, document.documentElement.classList.contains('dark'), live.current.pressed)
        lastFrame = now
      }
      if (!reduced) frame = requestAnimationFrame(draw)
    }
    const wake = () => {
      if (!frame) lastTime = 0
      lastFrame = 0 // pointer-down is drawn on the next frame, never behind the idle frame limiter
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
  useEffect(() => {
    if (reduced) {
      live.current.pointer = { x: 0, y: 0 }
      host.current?.style.setProperty('--cat-gaze-x', '0px'); host.current?.style.setProperty('--cat-gaze-y', '0px')
    }
    host.current?.dispatchEvent(new Event('mascot-update'))
    if (active && state === 'success') void catVoice('chirrup')
    else if (active && state === 'error') void catVoice('growl')
  }, [state, reduced, active])
  return <span className={`manul-mascot-wrap ${className}`} style={{ width: size, height: size }}>
    <button ref={host} type="button" className="manul-mascot" style={{ width: size, height: size }}
    data-mascot-state={state} data-mascot-renderer={ready ? 'webgl' : 'fallback'} data-reduced-motion={reduced}
    data-mascot-reaction={reaction ?? 'none'}
    aria-label={`${mascotLabels[state]}. Pet Manul.`} title="Pet Manul"
    onPointerDown={e => {
      if (e.button !== 0) return
      pressHandled.current = true; live.current.pressed = true
      e.currentTarget.setPointerCapture(e.pointerId)
      trigger(petGestures[petCount.current++ % petGestures.length])
    }}
    onPointerUp={() => { live.current.pressed = false; host.current?.dispatchEvent(new Event('mascot-update')) }}
    onPointerCancel={() => { pressHandled.current = false; live.current.pressed = false }}
    onClick={e => {
      if (e.detail === 0 || !pressHandled.current) trigger(petGestures[petCount.current++ % petGestures.length])
      pressHandled.current = false
    }}>
    {!ready && <CatFallback />}
    <canvas key={active ? 'active' : 'inactive'} ref={canvas} aria-hidden="true" className={ready ? 'is-ready' : ''} />
    {state === 'sleeping' && <span className="manul-mascot-sleep" aria-hidden="true">z<span>z</span></span>}
    {!reduced && (reaction === 'pet' || reaction === 'nuzzle') && <span key={reaction} className="manul-mascot-delight" aria-hidden="true"><i>✧</i><i>✧</i><i>♡</i></span>}
  </button>
  {controls && <MascotControls onGesture={trigger} />}
  </span>
})
