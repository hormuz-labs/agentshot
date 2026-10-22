// The edit, played from its pieces: nothing is rendered. Two <video> elements take turns, so the next piece is already
// loaded and sitting on its first frame when the playing one reaches its cut; at the cut they swap. Its time is the
// film's time (the edit's), whatever file and moment each piece shows. It looks like a <video> to the rest of the app
// (currentTime, duration, paused, play, pause, and play/pause/seeked/timeupdate/durationchange events).

/** One piece of the edit: a file's url and the part of it to show, at what loudness (1 = as it is). */
export type Piece = { id: string; url: string; in: number; out: number; gain: number }

/** What both a <video> and the edit player are, for the code that drives either. */
export type PlayerLike = { currentTime: number; readonly duration: number; readonly paused: boolean; play(): Promise<void>; pause(): void }

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?(cb: (now: number, meta: { mediaTime: number }) => void): number }

export class EditPlayer extends EventTarget implements PlayerLike {
  private pieces: Piece[] = []
  private begins: number[] = []
  private total = 0
  /** the piece each element holds (-1: none) */
  private slot = [-1, -1]
  private front = 0
  private playing = false
  private raf = 0
  private lastTick = 0
  private gone = false

  constructor(private els: [FrameVideo, FrameVideo], private fps = 30) {
    super()
    els.forEach((el, k) => {
      el.addEventListener('ended', () => { if (k === this.front && this.playing) this.advance() })
      // a piece that can't play (a missing file) is skipped rather than stalling the edit
      el.addEventListener('error', () => { if (k === this.front && this.playing) this.advance() })
      this.watchFrames(k)
    })
  }

  get duration() { return this.total }
  get paused() { return !this.playing }
  /** the element on screen (for stills and the picture's size) */
  get element() { return this.els[this.front] }
  get elements() { return this.els }

  get currentTime() {
    const i = this.slot[this.front]
    if (i < 0) return 0
    const p = this.pieces[i]
    return this.begins[i] + Math.min(p.out - p.in, Math.max(0, this.els[this.front].currentTime - p.in))
  }
  set currentTime(t: number) { this.seek(t) }

  /** How loud an element's piece plays (the live mix multiplies the film's level by it). */
  gainOf(el: HTMLVideoElement) {
    const i = this.slot[this.els.indexOf(el as FrameVideo)]
    return i >= 0 ? this.pieces[i].gain : 0
  }

  /** New pieces (after an edit): stays at the same film time unless told where to go. */
  setPieces(pieces: Piece[], at?: number) {
    const t = at ?? this.currentTime
    const same = pieces.length === this.pieces.length && pieces.every((p, i) => p.url === this.pieces[i].url && p.in === this.pieces[i].in && p.out === this.pieces[i].out)
    this.pieces = pieces
    let s = 0
    this.begins = pieces.map(p => { const b = s; s += p.out - p.in; return b })
    this.total = s
    this.dispatchEvent(new Event('durationchange'))
    if (same && at == null) return // only loudness changed: keep playing as is
    this.slot = [-1, -1]
    this.seek(Math.min(t, this.total))
  }

  seek(t: number) {
    if (!this.pieces.length) return
    t = Math.max(0, Math.min(this.total, t))
    let i = this.begins.findIndex((b, k) => t < b + (this.pieces[k].out - this.pieces[k].in))
    if (i < 0) i = this.pieces.length - 1
    // keep the element that already shows this piece in front (no reload)
    if (this.slot[1 - this.front] === i && this.slot[this.front] !== i) { this.els[this.front].pause(); this.front = 1 - this.front }
    this.load(this.front, i, this.pieces[i].in + (t - this.begins[i]))
    this.preload(1 - this.front, i + 1)
    this.show()
    if (this.playing) this.els[this.front].play().catch(() => {})
    this.emit('seeked')
    this.emit('timeupdate')
  }

  play() {
    if (!this.pieces.length) return Promise.resolve()
    if (this.currentTime >= this.total - 0.05) this.seek(0)
    this.playing = true
    const started = this.els[this.front].play().catch(() => {})
    this.loop()
    this.emit('play')
    return started
  }

  pause() {
    if (!this.playing) return
    this.playing = false
    this.els.forEach(e => e.pause())
    cancelAnimationFrame(this.raf)
    this.emit('pause')
    this.emit('timeupdate')
  }

  dispose() {
    this.gone = true
    this.playing = false
    cancelAnimationFrame(this.raf)
    this.els.forEach(e => { e.pause(); e.removeAttribute('src'); e.load() })
  }

  private emit(type: string) { this.dispatchEvent(new Event(type)) }

  private load(k: number, i: number, at: number) {
    const el = this.els[k], p = this.pieces[i]
    if (el.getAttribute('src') !== p.url) el.src = p.url
    // before its metadata loads this is where it starts
    if (Math.abs(el.currentTime - at) > 0.001) el.currentTime = at
    this.slot[k] = i
  }

  private preload(k: number, i: number) {
    this.els[k].pause()
    if (i < this.pieces.length) this.load(k, i, this.pieces[i].in)
    else this.slot[k] = -1
  }

  private show() { this.els.forEach((el, k) => { el.style.visibility = k === this.front ? 'visible' : 'hidden' }) }

  /** The piece in front reached its cut: the other element (on the next piece's first frame) takes over. */
  private advance() {
    const next = this.slot[this.front] + 1
    if (next >= this.pieces.length) {
      this.pause()
      this.emit('ended')
      return
    }
    const back = 1 - this.front
    if (this.slot[back] !== next) this.load(back, next, this.pieces[next].in)
    this.els[back].play().catch(() => {})
    this.els[this.front].pause()
    this.front = back
    this.show()
    this.preload(1 - this.front, next + 1)
    this.emit('timeupdate')
  }

  private reachedCut(k: number, mediaTime: number) {
    const i = this.slot[k]
    if (i < 0 || k !== this.front || !this.playing) return false
    // the next frame would be past the cut
    return mediaTime + 1 / this.fps >= this.pieces[i].out - 0.25 / this.fps
  }

  /** Frame-exact cuts where the browser reports each frame shown; the animation-frame loop covers the rest. */
  private watchFrames(k: number) {
    const el = this.els[k]
    if (!el.requestVideoFrameCallback) return
    const cb = (_now: number, meta: { mediaTime: number }) => {
      if (this.gone) return
      if (this.reachedCut(k, meta.mediaTime)) this.advance()
      el.requestVideoFrameCallback!(cb)
    }
    el.requestVideoFrameCallback(cb)
  }

  private loop() {
    cancelAnimationFrame(this.raf)
    const tick = (now: number) => {
      if (!this.playing || this.gone) return
      const el = this.els[this.front]
      if (this.reachedCut(this.front, el.currentTime - 1 / this.fps)) this.advance()
      if (now - this.lastTick > 100) { this.lastTick = now; this.emit('timeupdate') }
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }
}
