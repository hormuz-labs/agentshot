// The live mix: the player's own sound and the music go through Web Audio, with the same gains the render uses
// (shared/mix.ts previewGains), so moving a slider is heard at once and Apply renders exactly that. The player is a
// <video>, or the edit playing from its pieces (two <video>s taking turns, each piece at its own loudness).
import { useEffect, useRef } from 'react'
import { duckEnvelope, previewGains, type Mix, type Region } from '../../../shared/mix'
import { mediaUrl } from './utils'

type Clock = { readonly currentTime: number; readonly duration: number; readonly paused: boolean } & Pick<EventTarget, 'addEventListener' | 'removeEventListener'>
/** What plays: its clock (the film's time), the elements whose sound it is, and each element's loudness (default 1). */
export type MixSource = { clock: Clock; elements: HTMLVideoElement[]; gainOf?(el: HTMLVideoElement): number }

type Graph = { ctx: AudioContext; film: GainNode; music: GainNode; audio: HTMLAudioElement; pieces: Map<HTMLVideoElement, GainNode> }
const graphs = new WeakMap<object, Graph>()

function graphFor(src: MixSource): Graph {
  let g = graphs.get(src.clock)
  if (!g) {
    const ctx = new AudioContext()
    const film = ctx.createGain()
    film.connect(ctx.destination)
    const audio = new Audio()
    audio.crossOrigin = 'anonymous'
    audio.loop = true
    const music = ctx.createGain()
    music.gain.value = 0
    ctx.createMediaElementSource(audio).connect(music).connect(ctx.destination)
    g = { ctx, film, music, audio, pieces: new Map() }
    graphs.set(src.clock, g)
  }
  for (const el of src.elements) {
    if (g.pieces.has(el)) continue
    const piece = g.ctx.createGain()
    g.ctx.createMediaElementSource(el).connect(piece).connect(g.film)
    g.pieces.set(el, piece)
  }
  return g
}

export function useLiveMix(source: MixSource | null, dir: string, mix: Mix, regions: Region[]) {
  const live = useRef({ mix, regions })
  live.current = { mix, regions }
  useEffect(() => {
    if (!source) return
    const g = graphFor(source)
    const { clock } = source
    let raf = 0
    const sync = () => {
      const d = g.audio.duration
      if (d > 0 && Math.abs(g.audio.currentTime - (clock.currentTime % d)) > 0.12) g.audio.currentTime = clock.currentTime % d
    }
    const tick = () => {
      const { mix: m, regions: r } = live.current
      const gains = previewGains(clock.currentTime, clock.duration || 0, m, duckEnvelope(r, m.music?.duckDb || 0))
      ;(window as unknown as { __manulLiveMix?: object }).__manulLiveMix = { t: clock.currentTime, ...gains, musicPlaying: !g.audio.paused } // for tests and debugging
      g.film.gain.setTargetAtTime(gains.film, g.ctx.currentTime, 0.02)
      g.music.gain.setTargetAtTime(gains.music, g.ctx.currentTime, 0.02)
      for (const [el, node] of g.pieces) node.gain.setTargetAtTime(source.gainOf ? source.gainOf(el) : 1, g.ctx.currentTime, 0.01)
      if (!clock.paused) sync()
      raf = requestAnimationFrame(tick)
    }
    const play = () => { g.ctx.resume(); if (live.current.mix.music) { sync(); g.audio.play().catch(() => {}) } }
    const pause = () => g.audio.pause()
    clock.addEventListener('play', play)
    clock.addEventListener('pause', pause)
    clock.addEventListener('seeked', sync)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); clock.removeEventListener('play', play); clock.removeEventListener('pause', pause); clock.removeEventListener('seeked', sync); g.audio.pause() }
  }, [source])
  // the music file
  useEffect(() => {
    if (!source) return
    const g = graphFor(source)
    const src = mix.music ? mediaUrl(`${dir}/${mix.music.src}`) : ''
    if (g.audio.src !== src) { g.audio.src = src; if (src && !source.clock.paused) g.audio.play().catch(() => {}) }
    if (!src) g.audio.pause()
  }, [source, dir, mix.music?.src])
}
