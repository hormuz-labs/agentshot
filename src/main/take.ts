// One continuous take of a browser tab for a product walkthrough: frames, each with its own time, kept on disk and
// encoded once at the end (so minutes of the agent thinking cost nothing), and what happened on the page (clicks,
// typing, scrolls, loads) from a small page script. The agent drives the page with bsk as usual; the take also types
// and scrolls the way a person does, so both show on film. Where the frames come from is a Capture:
//   ScreencastCapture  CDP screencast, 30–60 fps (AgentShot's browser, or the user's Chrome when its remote debugging is on)
//   BskCapture         the user's own bsk: its screenshots, about 10 fps, and nothing to set up
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { BINDING, type Cdp } from './cdp'
import { FFMPEG } from './media'
import type { Take, TakeEvent } from '../shared/walkthrough'

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any
const run = promisify(execFile)

/** bsk's own switch for keeping its overlay (the glow, the "Agent controlling" pill, its input blocker) out of captures. */
const BSK_HIDDEN = 'data-bsk-capture-hidden'
/** On the page while a take runs: which take put its script in (its listeners report only while this is theirs). Kept in
 *  the DOM, and events in sessionStorage, so it holds whichever script world bsk evaluates in, and across page loads. */
const ON = 'data-manul-take'
const PAUSED = 'data-manul-take-paused'
const BUFFER = '__manulTakeBuffer'

/** Keeps bsk's overlay off the film (except while the take is paused) and reports what happens on the page (top frame
 *  only), with the page's clock (epoch ms): through the CDP binding when there is one, else into sessionStorage, from
 *  where AgentShot collects it (DRAIN). */
export const pageScript = (take: string) => `(() => {
  if (window !== window.top || !document.documentElement) return
  const root = document.documentElement, me = ${JSON.stringify(take)}
  const hide = () => { if (root.hasAttribute('${PAUSED}') || root.getAttribute('${ON}') !== me) return
    for (const h of document.querySelectorAll('[data-bsk-overlay]')) if (!h.hasAttribute('${BSK_HIDDEN}')) h.setAttribute('${BSK_HIDDEN}', '') }
  if (root.getAttribute('${ON}') === me) { hide(); return }
  root.setAttribute('${ON}', me)
  new MutationObserver(hide).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['${BSK_HIDDEN}', 'data-bsk-overlay'] })
  hide()
  const live = () => root.getAttribute('${ON}') === me && !root.hasAttribute('${PAUSED}')
  const send = o => {
    if (!live()) return
    const e = { ...o, t: Date.now() }
    if (typeof window[${JSON.stringify(BINDING)}] === 'function') { try { window[${JSON.stringify(BINDING)}](JSON.stringify(e)) } catch {} return }
    try { const b = JSON.parse(sessionStorage.getItem('${BUFFER}') || '[]'); b.push(e); sessionStorage.setItem('${BUFFER}', JSON.stringify(b)) } catch {}
  }
  const box = el => { if (!el || !el.getBoundingClientRect) return undefined; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(n => Math.round(n)) }
  const inside = e => e.clientX >= 0 && e.clientY >= 0 && e.clientX <= innerWidth && e.clientY <= innerHeight
  let moved = 0, scrolled = 0
  const on = (type, fn) => addEventListener(type, fn, { capture: true, passive: true })
  on('pointermove', e => { const n = performance.now(); if (n - moved < 50 || !inside(e)) return; moved = n; send({ k: 'move', x: e.clientX, y: e.clientY }) })
  on('pointerdown', e => send({ k: 'down', x: e.clientX, y: e.clientY, r: box(e.target) }))
  on('click', e => send({ k: 'click', x: e.clientX, y: e.clientY, r: box(e.target) }))
  on('keydown', e => send({ k: 'key', r: box(document.activeElement) }))
  on('input', e => send({ k: 'input', r: box(e.target) }))
  on('focusin', e => send({ k: 'focus', r: box(e.target) }))
  on('wheel', e => { if (inside(e)) send({ k: 'wheel', x: e.clientX, y: e.clientY }) })
  on('scroll', () => { const n = performance.now(); if (n - scrolled < 100) return; scrolled = n; send({ k: 'scroll' }) })
})()`

/** Put the take's script in (again after a page load: a fresh page has none) and take the events it kept. */
const drain = (take: string) => `(() => {
  const fresh = !!document.documentElement && document.documentElement.getAttribute('${ON}') !== ${JSON.stringify(take)};
  ${pageScript(take)};
  let events = []
  try { events = JSON.parse(sessionStorage.getItem('${BUFFER}') || '[]'); sessionStorage.removeItem('${BUFFER}') } catch {}
  return { fresh, events }
})()`

/** Paused (bsk's overlay shows again: its sign-in and help prompts are in it), or filming again. */
const PAUSE = `(() => { const r = document.documentElement; r?.setAttribute('${PAUSED}', ''); for (const h of document.querySelectorAll('[data-bsk-overlay]')) h.removeAttribute('${BSK_HIDDEN}') })()`
const UNPAUSE = `document.documentElement?.removeAttribute('${PAUSED}')`
/** The take is over: its listeners go quiet and bsk's overlay shows. */
const END = `(() => { const r = document.documentElement; r?.removeAttribute('${ON}'); r?.removeAttribute('${PAUSED}'); try { sessionStorage.removeItem('${BUFFER}') } catch {}
  for (const h of document.querySelectorAll('[data-bsk-overlay]')) h.removeAttribute('${BSK_HIDDEN}') })()`

/** How far the page and whatever scrolls under x,y have scrolled (to tell whether wheel input moved anything). */
const scrolledAt = (x: number, y: number) => `(() => {
  const el = (document.elementsFromPoint(${x}, ${y}).find(e => !e.closest('[data-bsk-overlay]')) || document.body)
  let n = scrollX + scrollY
  for (let e = el; e; e = e.parentElement) n += e.scrollTop + e.scrollLeft
  return n
})()`
/** Scroll whatever scrolls under x,y by dy over ms, eased. */
const animateScroll = (dy: number, x: number, y: number, ms: number) => `new Promise(done => {
  const can = e => { const s = getComputedStyle(e); return /(auto|scroll|overlay)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1 }
  let el = document.elementsFromPoint(${x}, ${y}).find(e => !e.closest('[data-bsk-overlay]'))
  while (el && el !== document.body && el !== document.documentElement && !can(el)) el = el.parentElement
  if (!el || el === document.body || el === document.documentElement) el = document.scrollingElement || document.documentElement
  const top = el.scrollTop, t0 = performance.now()
  const step = now => { const p = Math.min(1, (now - t0) / ${ms}), k = p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2
    el.scrollTop = top + ${dy} * k; p < 1 ? requestAnimationFrame(step) : done(true) }
  requestAnimationFrame(step)
})`

/** What a capture reports to the take: frames already written to the frames folder, page events, page loads. */
export type Sink = {
  /** a frame file (in the frames folder) and when it was on screen, in seconds on this machine's clock */
  frame(file: string, at: number): void
  /** a page event, its time in epoch ms */
  event(e: { t: number; k: string; x?: number; y?: number; r?: [number, number, number, number] }): void
  nav(): void
}

/** Where a take's frames and page events come from, and how it acts on the page. */
export interface Capture {
  readonly kind: 'screencast' | 'screenshots'
  /** Set the viewport, put the page script in and start capturing. Returns the page's address, and the viewport and
   *  scale it really films at when it could not set the ones asked for. */
  start(o: { take: string; viewport: { width: number; height: number }; scale: number; frames: string; sink: Sink }): Promise<{ url?: string; viewport?: { width: number; height: number }; scale?: number }>
  /** Pause (show bsk's overlay, capture nothing) or carry on. */
  capturing(on: boolean): Promise<void>
  evaluate(expression: string, awaitPromise?: boolean): Promise<unknown>
  /** one character into the focused field, or Enter */
  key(ch: string): Promise<void>
  /** wheel input at x,y (CSS px), when the capture can send it */
  wheel?(x: number, y: number, dy: number): Promise<void>
  /** the pointer to x,y (hover states), when the capture can move it */
  pointer?(x: number, y: number): Promise<void>
  onClose(fn: (why: string) => void): void
  /** Put the page back as it was. */
  stop(): Promise<void>
}

/** CDP screencast: frames as the page paints them, events through a binding. */
export class ScreencastCapture implements Capture {
  readonly kind = 'screencast'
  private scriptId: string | null = null
  private off: (() => void) | null = null
  private clockOffset: number | null = null
  private n = 0
  private frames = ''
  private size = { width: 0, height: 0 }
  private writes: Promise<unknown>[] = []
  private live = false
  private sink: Sink | null = null
  private take = ''

  constructor(private cdp: Cdp) {}

  async start(o: Parameters<Capture['start']>[0]) {
    const { cdp } = this
    this.frames = o.frames
    this.sink = o.sink
    this.take = o.take
    this.size = { width: Math.round(o.viewport.width * o.scale / 2) * 2, height: Math.round(o.viewport.height * o.scale / 2) * 2 }
    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: o.viewport.width, height: o.viewport.height, deviceScaleFactor: o.scale, mobile: false })
    await cdp.send('Runtime.addBinding', { name: BINDING })
    this.off = cdp.on((method, p) => this.onEvent(method, p))
    await this.capturing(true)
    return { url: (await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }).catch(() => null))?.result?.value }
  }

  private onEvent(method: string, p: Any) {
    const sink = this.sink!
    if (method === 'Page.screencastFrame') {
      this.cdp.send('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {})
      if (!this.live) return
      // frame timestamps are the renderer's: put them on this clock once, by the first frame's arrival
      const raw = Number(p.metadata?.timestamp) || Date.now() / 1000
      this.clockOffset ??= Date.now() / 1000 - raw
      const file = `f${String(this.n++).padStart(6, '0')}.jpg`
      this.writes.push(writeFile(join(this.frames, file), Buffer.from(p.data, 'base64')).then(() => sink.frame(file, raw + this.clockOffset!)))
      if (this.writes.length > 64) this.writes = [Promise.all(this.writes)]
    } else if (method === 'Runtime.bindingCalled' && p.name === BINDING) {
      try { sink.event(JSON.parse(p.payload)) } catch { /* not ours */ }
    } else if (method === 'Page.frameNavigated' && !p.frame?.parentId) sink.nav()
  }

  async capturing(on: boolean) {
    const { cdp } = this
    this.live = on
    if (on) {
      // on this page and every page that loads while filming (not while paused: sign-in help must show)
      this.scriptId = (await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: pageScript(this.take) })).identifier
      await cdp.send('Runtime.evaluate', { expression: `${UNPAUSE}; ${pageScript(this.take)}` }).catch(() => {})
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: this.size.width, maxHeight: this.size.height, everyNthFrame: 1 })
    } else {
      await cdp.send('Page.stopScreencast').catch(() => {})
      // bsk's overlay comes back, on this page and the pages that follow
      if (this.scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.scriptId }).catch(() => {})
      this.scriptId = null
      await cdp.send('Runtime.evaluate', { expression: PAUSE }).catch(() => {})
    }
  }

  async evaluate(expression: string, awaitPromise = false) {
    return (await this.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise })).result?.value
  }

  async key(ch: string) {
    if (ch === '\n') {
      for (const type of ['keyDown', 'keyUp']) await this.cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) })
      return
    }
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, unmodifiedText: ch, key: ch })
    await this.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
  }

  async wheel(x: number, y: number, dy: number) {
    const n = Math.max(4, Math.min(60, Math.ceil(Math.abs(dy) / 60))), wait = Math.max(8, Math.min(2500, 400 + Math.abs(dy) / 0.9) / n)
    await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    for (let i = 0; i < n; i++) {
      // eased: slow in, slow out, as a trackpad flick reads on film
      await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: 0, deltaY: dy * (Math.sin(Math.PI * (i + 0.5) / n) * Math.PI) / (2 * n) })
      await sleep(wait)
    }
  }

  async pointer(x: number, y: number) { await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }) }

  onClose(fn: (why: string) => void) { this.cdp.onClose(fn) }

  async stop() {
    this.live = false
    this.off?.()
    const { cdp } = this
    await cdp.send('Page.stopScreencast').catch(() => {})
    await cdp.send('Runtime.evaluate', { expression: END }).catch(() => {})
    if (this.scriptId) await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: this.scriptId }).catch(() => {})
    await cdp.send('Runtime.removeBinding', { name: BINDING }).catch(() => {})
    await cdp.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
    await cdp.close().catch(() => {})
    await Promise.all(this.writes)
  }
}

/** The agent's own bsk session as the camera: bsk screenshots back to back (about 10 a second; bsk keeps its overlay out
 *  of them) and the page script's events collected a few times a second. Nothing to set up in the browser. A bsk session
 *  runs one command at a time: AgentShot's go one by one, the screenshots pause while one of the agent's commands runs (it
 *  leaves a mark in yieldDir, see bskScript), and a command bsk turns away as busy (never sent) is sent again. */
export class BskCapture implements Capture {
  readonly kind = 'screenshots'
  private live = false
  private running = false
  private loops: Promise<void>[] = []
  private closers: ((why: string) => void)[] = []
  private ended = false
  private take = ''

  private queue: Promise<unknown> = Promise.resolve()

  /** haltFile: while it is there (the user pressed Interrupt), bsk refuses the session's commands: wait it out */
  constructor(private o: { bin: string; env: NodeJS.ProcessEnv; session: string; yieldDir?: string; haltFile?: string }) {}

  private cli(args: string[], timeout = 30_000): Promise<Any> {
    const call = async () => {
      for (let tries = 0; ; tries++) {
        try {
          const { stdout } = await run(this.o.bin, [...args, '--session', this.o.session, '--json'], { env: this.o.env, timeout, maxBuffer: 1 << 24 })
          try { return JSON.parse(stdout) } catch { return stdout }
        } catch (e) {
          const busy = (e as { code?: number }).code === 4 && /session_busy/.test(String((e as { stdout?: string }).stdout))
          if (!busy || tries > 300) throw e
          await sleep(30)
        }
      }
    }
    const p = this.queue.then(call, call)
    this.queue = p.catch(() => {})
    return p
  }

  /** One of the agent's commands is running (a fresh mark in yieldDir; old marks are leftovers and are cleared). */
  private async agentBusy() {
    if (!this.o.yieldDir) return false
    const marks = await readdir(this.o.yieldDir).catch(() => [] as string[])
    for (const m of marks) {
      const st = await stat(join(this.o.yieldDir, m)).catch(() => null)
      if (st && Date.now() - st.mtimeMs < 10 * 60_000) return true
      await rm(join(this.o.yieldDir, m), { force: true })
    }
    return false
  }

  async evaluate(expression: string, awaitPromise = true) {
    const r = await this.cli(['evaluate', expression, ...(awaitPromise ? [] : ['--await-promise', 'false'])])
    if (r?.ok === false) throw new Error(`The page refused the take's script: ${r.error?.text || JSON.stringify(r.error)}`)
    return r?.value
  }

  private restore: { width: number; height: number } | null = null

  async start(o: Parameters<Capture['start']>[0]) {
    this.take = o.take
    // No emulation: a capture while the page is emulated at another size or scale than its window makes Chrome redraw
    // the window at each one, a flash ten times a second. Size bsk's Agent Window instead, so the page is the viewport
    // asked for, at the screen's own scale.
    // bsk sizes the whole window (title bar, tabs, its debugging bar): learn that overhead from the page's size after
    // each resize, and correct once or twice
    const size = async () => await this.evaluate('({ iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, url: location.href })')
    let m = await size()
    const before = { width: m.iw, height: m.ih }
    let extra = { w: 2, h: 140 }, asked = { w: 0, h: 0 }
    for (let i = 0; i < 3 && (Math.abs(m.iw - o.viewport.width) > 2 || Math.abs(m.ih - o.viewport.height) > 2); i++) {
      asked = { w: o.viewport.width + extra.w, h: o.viewport.height + extra.h }
      await this.cli(['window', 'resize', '--width', String(asked.w), '--height', String(asked.h)]).catch(() => {})
      await sleep(300)
      m = await size()
      extra = { w: asked.w - m.iw, h: asked.h - m.ih }
    }
    if (asked.w) this.restore = { width: before.width + extra.w, height: before.height + extra.h }
    this.running = true
    await this.capturing(true)
    this.loops = [this.shoot(o.frames, o.sink), this.collect(o.sink)]
    return { url: typeof m.url === 'string' ? m.url : undefined, viewport: { width: m.iw, height: m.ih }, scale: m.dpr || 1 }
  }

  private async shoot(frames: string, sink: Sink) {
    let n = 0, failures = 0
    while (this.running) {
      if (!this.live || await this.agentBusy() || (this.o.haltFile && existsSync(this.o.haltFile))) { await sleep(30); failures = 0; continue }
      const file = `f${String(n).padStart(6, '0')}.png`, t0 = Date.now()
      try {
        await this.cli(['screenshot', '--out', join(frames, file), '--quiet'])
        // bsk hides its overlay, waits a frame, then captures: the picture is from late in the call
        sink.frame(file, (t0 + (Date.now() - t0) * 0.6) / 1000)
        n++; failures = 0
      } catch (e) { if (++failures >= 5) this.end(`bsk stopped answering: ${(e as Error).message.split('\n')[0]}`); await sleep(100) }
    }
  }

  private async collect(sink: Sink) {
    const expression = drain(this.take)
    let first = true
    while (this.running) {
      if (this.live) {
        try {
          const v = await this.evaluate(expression)
          if (v?.fresh && !first) sink.nav()
          first = false
          for (const e of v?.events || []) sink.event(e)
        } catch { /* a page loading: next round */ }
      }
      await sleep(250)
    }
  }

  async capturing(on: boolean) {
    this.live = on
    await this.evaluate(on ? `${UNPAUSE}; ${pageScript(this.take)}` : PAUSE).catch(() => {})
  }

  async key(ch: string) {
    if (ch === '\n') await this.cli(['press', 'Enter'])
    else await this.evaluate(`document.execCommand('insertText', false, ${JSON.stringify(ch)})`)
  }

  onClose(fn: (why: string) => void) { this.closers.push(fn) }
  private end(why: string) { if (this.ended) return; this.ended = true; this.running = false; for (const c of this.closers) c(why) }

  async stop() {
    this.running = false
    this.live = false
    await Promise.all(this.loops)
    await this.evaluate(END).catch(() => {})
    if (this.restore) await this.cli(['window', 'resize', '--width', String(this.restore.width), '--height', String(this.restore.height)]).catch(() => {})
  }
}

export type TakeOptions = {
  capture: Capture
  /** the take's folder: absolute, and relative to the project */
  dir: string; rel: string
  id: string
  browser: Take['browser']
  /** the page's viewport in CSS pixels and the device scale it is filmed at (frames are width·scale × height·scale) */
  viewport?: { width: number; height: number }
  scale?: number
  fps?: number
  log?: (s: string) => void
}

type Frame = { ts: number; file: string }

export class Recorder {
  readonly id: string
  private frames: Frame[] = []
  private events: TakeEvent[] = []
  private steps: Take['steps'] = []
  private paused: { s: number; e: number }[] = []
  private pausedAt: number | null = null
  /** the take's time 0, on this machine's clock */
  private began = Date.now() / 1000
  private url: string | undefined
  private ended: string | null = null
  private stopping: Promise<Take> | null = null
  viewport: { width: number; height: number }
  scale: number
  readonly fps: number

  constructor(private o: TakeOptions) {
    this.id = o.id
    this.viewport = o.viewport || { width: 1280, height: 720 }
    this.scale = o.scale || 2
    this.fps = o.fps || 30
    o.capture.onClose(why => { this.ended = why })
  }

  get capture() { return this.o.capture.kind }
  get frameSize() { return { width: Math.round(this.viewport.width * this.scale / 2) * 2, height: Math.round(this.viewport.height * this.scale / 2) * 2 } }
  /** seconds into the take */
  now() { return Math.max(0, Date.now() / 1000 - this.began) }
  get recording() { return !this.ended && !this.stopping }
  /** why the take ended by itself (the tab closed…), if it did */
  get endedBy() { return this.ended }
  get isPaused() { return this.pausedAt != null }

  async start() {
    await mkdir(join(this.o.dir, 'frames'), { recursive: true })
    const got = await this.o.capture.start({
      take: this.id, viewport: this.viewport, scale: this.scale, frames: join(this.o.dir, 'frames'),
      sink: {
        frame: (file, at) => { if (this.pausedAt == null && !this.stopping) this.frames.push({ file, ts: Math.max(0, at - this.began) }) },
        event: e => { if (this.pausedAt == null) this.events.push({ t: Math.max(0, e.t / 1000 - this.began), k: e.k as TakeEvent['k'], ...(e.x != null ? { x: e.x, y: e.y } : {}), ...(e.r ? { r: e.r } : {}) }) },
        nav: () => { if (this.pausedAt == null) this.events.push({ t: this.now(), k: 'nav' }) },
      },
    })
    this.url = got.url
    if (got.viewport) this.viewport = got.viewport
    if (got.scale) this.scale = got.scale
  }

  /** Mark the start of the next step of the walkthrough (what the narration for it will be about). */
  step(title: string) { this.assertLive(); this.steps.push({ t: this.now(), title }); return this.steps.length }

  /** Stop filming (sign-ins, private pages): nothing is captured until resume, and the gap is never in the film. */
  async pause() {
    this.assertLive()
    if (this.pausedAt != null) return
    this.pausedAt = this.now()
    await this.o.capture.capturing(false)
  }
  async resume() {
    this.assertLive()
    if (this.pausedAt == null) return
    await this.o.capture.capturing(true)
    this.paused.push({ s: this.pausedAt, e: this.now() })
    this.pausedAt = null
  }

  /** Type into the focused field a key at a time, at a person's pace (bsk fill would put it all in at once). */
  async type(text: string, o: { cps?: number; enter?: boolean } = {}) {
    this.assertLive()
    const base = 1000 / Math.min(40, Math.max(4, o.cps ?? 14))
    for (const ch of text) {
      await this.o.capture.key(ch)
      await sleep(base * (0.6 + Math.random() * 0.8) + (ch === ' ' ? base * 0.4 : 0))
    }
    if (o.enter) { await sleep(base * 3); await this.o.capture.key('\n') }
  }

  /** Scroll smoothly (CSS pixels; positive is down) at x,y in the viewport (default its middle): with the wheel, as a
   *  person would, or, when the page ignores wheel input (or there is no wheel), by easing whatever scrolls there. */
  async scroll(dy: number, o: { x?: number; y?: number } = {}) {
    this.assertLive()
    const c = this.o.capture
    const x = o.x ?? this.viewport.width / 2, y = o.y ?? this.viewport.height / 2
    // fewer frames a second: a longer scroll, so it still reads as one on film
    const ms = Math.min(2500, 400 + Math.abs(dy) / 0.9) * (c.kind === 'screenshots' ? 1.6 : 1)
    this.events.push({ t: this.now(), k: 'wheel', x, y })
    if (!c.wheel) { // start the scroll and let the screenshots go on while it plays
      await c.evaluate(animateScroll(dy, x, y, ms), false).catch(() => {})
      await sleep(ms + 150)
      return
    }
    const before = await c.evaluate(scrolledAt(x, y)).catch(() => null)
    await c.wheel(x, y, dy)
    await sleep(250)
    if (before != null && before === await c.evaluate(scrolledAt(x, y)).catch(() => null)) {
      await c.evaluate(animateScroll(dy, x, y, ms), true).catch(() => {})
    }
  }

  /** Move the pointer there (hover states show on film when the capture can move it; the drawn cursor glides there). */
  async move(x: number, y: number) {
    this.assertLive()
    this.events.push({ t: this.now(), k: 'move', x, y })
    await this.o.capture.pointer?.(x, y)
  }

  private assertLive() {
    if (this.stopping) throw new Error('This take has already been stopped.')
    if (this.ended) throw new Error(`The take ended: ${this.ended} Stop it to keep what was recorded.`)
  }

  /** Finish: put the page back as it was, encode the frames, and write take.json. */
  stop(): Promise<Take> {
    this.stopping ??= this.finish()
    return this.stopping
  }

  private async finish(): Promise<Take> {
    const end = this.now()
    if (this.pausedAt != null) { this.paused.push({ s: this.pausedAt, e: end }); this.pausedAt = null }
    await this.o.capture.stop().catch(() => {})
    const frames = [...this.frames].sort((a, b) => a.ts - b.ts)
    if (!frames.length) throw new Error('The take has no picture: the page never painted while recording. Keep the tab open and visible, then record again.')
    const { width, height } = this.frameSize
    // the video's time is the take's: the first frame stands in until it arrived, each frame lasts until the next
    const lines = ['ffconcat version 1.0']
    if (frames[0].ts > 0.001) lines.push(`file 'frames/${frames[0].file}'`, `duration ${frames[0].ts.toFixed(4)}`)
    frames.forEach((f, i) => {
      const next = frames[i + 1]?.ts ?? Math.max(end, f.ts + 1 / this.fps)
      lines.push(`file 'frames/${f.file}'`, `duration ${Math.max(0.001, next - f.ts).toFixed(4)}`)
    })
    lines.push(`file 'frames/${frames.at(-1)!.file}'`)
    await writeFile(join(this.o.dir, 'frames.txt'), lines.join('\n') + '\n')
    await run(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'frames.txt',
      '-vf', `fps=${this.fps},scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${width}:${height}:-1:-1:color=white,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-g', String(this.fps * 2), '-movflags', '+faststart', 'take.mp4'], { cwd: this.o.dir, maxBuffer: 1 << 24 })
    await rm(join(this.o.dir, 'frames'), { recursive: true, force: true })
    await rm(join(this.o.dir, 'frames.txt'), { force: true })
    const duration = Math.round(Math.max(end, frames.at(-1)!.ts + 1 / this.fps) * 1000) / 1000
    const take: Take = {
      id: this.id, video: `${this.o.rel}/take.mp4`, duration, width, height, fps: this.fps, viewport: this.viewport,
      steps: this.steps.map(s => ({ ...s, t: Math.min(s.t, duration) })),
      events: this.events.filter(e => e.t <= duration).sort((a, b) => a.t - b.t),
      paused: this.paused, browser: this.o.browser, ...(this.url ? { url: this.url } : {}), startedAt: Math.round(this.began * 1000),
    }
    await writeFile(join(this.o.dir, 'take.json'), JSON.stringify(take, null, 1))
    this.o.log?.(`take ${this.id} (${this.o.capture.kind}): ${frames.length} frames, ${duration.toFixed(1)} s, ${take.events.length} events, ${take.steps.length} steps`)
    return take
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
