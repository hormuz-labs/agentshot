import { useSyncExternalStore } from 'react'

export type CatSound = 'purr' | 'chirrup' | 'growl'
const key = 'manul.mascot.sound'
let enabled = true
try { enabled = localStorage.getItem(key) !== '0' } catch { /* private mode */ }
const listeners = new Set<() => void>()
let context: AudioContext | null = null, lastVoice = -Infinity
const playing = new Set<AudioBufferSourceNode>()

export function useMascotSound() {
  const on = useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn) }, () => enabled)
  return [on, () => {
    enabled = !enabled
    try { localStorage.setItem(key, enabled ? '1' : '0') } catch { /* private mode */ }
    if (!enabled) { playing.forEach(source => source.stop()); playing.clear(); void context?.suspend() }
    listeners.forEach(fn => fn())
  }] as const
}

/** Small, original synthesized cat vocals. Created only after a pet/keyboard gesture; no remote audio. */
export async function catVoice(kind: CatSound, userGesture = false) {
  if (!enabled || document.hidden) return false
  // Don't speak over the user's film. Background agent transitions never unlock audio.
  if (Array.from(document.querySelectorAll('video, audio')).some(el => !(el as HTMLMediaElement).paused && !(el as HTMLMediaElement).muted)) return false
  if (!context && !userGesture) return false
  try {
    if (!context) context = new AudioContext()
    if (context.state !== 'running') {
      if (!userGesture) return false
      await context.resume()
    }
    if (context.state !== 'running' || !enabled) return false
    const now = context.currentTime
    if (now - lastVoice < (userGesture ? .32 : 8)) return false
    lastVoice = now
    playing.forEach(source => source.stop()); playing.clear()
    const duration = kind === 'growl' ? .9 : kind === 'purr' ? 1.15 : .38
    const length = Math.ceil(context.sampleRate * duration)
    const buffer = context.createBuffer(1, length, context.sampleRate)
    const samples = buffer.getChannelData(0)
    let phase = 0, lowNoise = 0, seed = 781
    for (let i = 0; i < length; i++) {
      const t = i / context.sampleRate, u = t / duration
      seed = (seed * 1664525 + 1013904223) >>> 0
      lowNoise += (((seed / 4294967296) * 2 - 1) - lowNoise) * .18
      const frequency = kind === 'growl' ? 92 - 27 * u + Math.sin(t * 32) * 5 : kind === 'chirrup' ? 330 + Math.sin(u * Math.PI) * 260 - 100 * u : 46 + Math.sin(t * 4) * 3
      phase += 2 * Math.PI * frequency / context.sampleRate
      const glottal = Math.sin(phase) + .45 * Math.sin(phase * 2) + .2 * Math.sin(phase * 3)
      const flutter = kind === 'purr' ? .3 + .7 * Math.pow((Math.sin(t * Math.PI * 2 * 25) + 1) / 2, 2) : .7 + .3 * Math.sin(t * 43)
      const envelope = Math.min(1, t / .045) * Math.pow(Math.sin(Math.PI * u), .8)
      samples[i] = (glottal * .23 + lowNoise * (kind === 'growl' ? .6 : .2)) * flutter * envelope
    }
    const source = context.createBufferSource(); source.buffer = buffer
    const throat = context.createBiquadFilter(); throat.type = 'lowpass'; throat.frequency.value = kind === 'chirrup' ? 1800 : 850
    const volume = context.createGain(); volume.gain.value = kind === 'growl' ? .22 : .16
    source.connect(throat); throat.connect(volume); volume.connect(context.destination)
    playing.add(source)
    source.onended = () => { playing.delete(source); source.disconnect(); throat.disconnect(); volume.disconnect() }
    source.start(now)
    return true
  } catch { return false }
}
