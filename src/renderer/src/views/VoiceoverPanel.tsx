import { useEffect, useRef, useState } from 'react'
import { Check, Crown, Loader2, Mic, Paperclip, Pause, Play, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { mediaUrl, timecode } from '@/lib/utils'
import type { Project } from '../../../shared/types'
import type { LiveVoiceover } from './VoiceoverTimeline'
import { useVoiceoverAccess } from '@/lib/voiceoverAccess'

const clean = (e: unknown) => String((e as Error)?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function Waveform({ peaks }: { peaks: number[] }) {
  // Join amplitude samples into a continuous, mirrored envelope rather than separate bars.
  const points = peaks.map((v, i) => ({ x: peaks.length === 1 ? 300 : i * 600 / (peaks.length - 1), h: Math.max(.6, Math.min(1, v) * 18) }))
  const contour = (samples: typeof points, side: number) => samples.map((p, i) => {
    const next = samples[i + 1]
    return next ? `Q${p.x},${20 + side * p.h} ${(p.x + next.x) / 2},${20 + side * (p.h + next.h) / 2}` : `L${p.x},${20 + side * p.h}`
  }).join(' ')
  const shape = points.length ? `M0,20 L0,${20 - points[0].h} ${contour(points, -1)} L600,20 L600,${20 + points.at(-1)!.h} ${contour([...points].reverse(), 1)} Z` : ''
  return <svg viewBox="0 0 600 40" preserveAspectRatio="none" className="h-10 w-full" aria-label="Recorded audio waveform" role="img">
    <path d="M0 20H600" stroke="currentColor" strokeWidth="0.5" opacity="0.25" />
    {shape && <path data-waveform-envelope d={shape} fill="currentColor" opacity="0.8" />}
  </svg>
}

type Take = { token: string; audio: Uint8Array; peaks: number[] }
export function VoiceoverRecorder({ project, time, duration, active, onRecording, onLive, onSaved, onClose }: {
  project: Project; time: number; duration: number; active: boolean
  onRecording(on: boolean, paused?: boolean): void; onSaved(p: Project, src: string): void; onClose(): void
  onLive(take: LiveVoiceover | null): void
}) {
  const access = useVoiceoverAccess()
  const [phase, setPhase] = useState<'checking' | 'ready' | 'recording' | 'paused' | 'saving'>('ready')
  const [error, setError] = useState('')
  const [seconds, setSeconds] = useState(0)
  const [take, setTake] = useState<Take | null>(null)
  const mounted = useRef(false), pending = useRef(false)
  const callbacks = useRef({ onRecording, onSaved, onLive })
  callbacks.current = { onRecording, onSaved, onLive }
  const session = useRef<{ recorder: MediaRecorder; stream: MediaStream; ctx: AudioContext; timer: number; token: string; keep: boolean; elapsed: number; resumedAt: number; sample(): void } | null>(null)
  const tokenRef = useRef<string | null>(null)
  const finish = (keep: boolean) => {
    const s = session.current
    if (!s) return
    s.keep = keep
    if (s.recorder.state !== 'inactive') s.recorder.stop()
  }
  const pause = () => {
    const s = session.current
    if (!s || s.recorder.state !== 'recording') return
    s.elapsed += performance.now() - s.resumedAt
    s.recorder.pause()
    s.stream.getAudioTracks().forEach(t => { t.enabled = false })
    s.sample()
    setPhase('paused')
    callbacks.current.onRecording(true, true)
  }
  const resume = () => {
    const s = session.current
    if (!s || s.recorder.state !== 'paused') return
    s.resumedAt = performance.now()
    s.stream.getAudioTracks().forEach(t => { t.enabled = true })
    s.recorder.resume()
    setPhase('recording')
    callbacks.current.onRecording(true, false)
  }
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const s = session.current
      if (s) { s.keep = false; window.clearInterval(s.timer); s.stream.getTracks().forEach(t => t.stop()); void s.ctx.close(); if (s.recorder.state !== 'inactive') s.recorder.stop() }
      callbacks.current.onRecording(false)
      callbacks.current.onLive(null)
      if (tokenRef.current) void window.agentshot.voiceover.cancel(tokenRef.current)
    }
  }, [])
  useEffect(() => { if (!active) finish(true) }, [active])
  const save = async (next: Take) => {
    setPhase('saving'); setError(''); setTake(next)
    try {
      const result = await window.agentshot.voiceover.save(next.token, next.audio, next.peaks)
      tokenRef.current = null
      if (mounted.current) { setTake(null); callbacks.current.onSaved(result.project, result.src); onClose() }
    } catch (e) { if (mounted.current) { setError(clean(e)); setPhase('ready') } }
  }
  const start = async () => {
    if (pending.current || session.current) return
    pending.current = true; setError(''); setPhase('checking')
    let stream: MediaStream | undefined, ctx: AudioContext | undefined
    try {
      const token = await window.agentshot.voiceover.begin(project.dir, time)
      tokenRef.current = token
      if (!mounted.current) { await window.agentshot.voiceover.cancel(token); return }
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      if (!mounted.current) { stream.getTracks().forEach(t => t.stop()); return }
      const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {})
      ctx = new AudioContext()
      const analyser = ctx.createAnalyser(); analyser.fftSize = 512
      ctx.createMediaStreamSource(stream).connect(analyser)
      const silent = ctx.createGain(); silent.gain.value = 0
      analyser.connect(silent).connect(ctx.destination)
      await ctx.resume()
      const samples = new Uint8Array(analyser.fftSize), levels: number[] = [], chunks: Blob[] = []
      const limit = Math.min(900, duration - time)
      const s = { recorder, stream, ctx, timer: 0, token, keep: true, elapsed: 0, resumedAt: performance.now(), sample: () => {} }
      session.current = s
      s.sample = () => {
        const paused = recorder.state === 'paused'
        if (!paused) {
          analyser.getByteTimeDomainData(samples)
          levels.push(Math.min(1, Math.max(...samples.map(v => Math.abs(v - 128))) / 128 * 2.5))
        }
        const elapsed = (s.elapsed + (paused ? 0 : performance.now() - s.resumedAt)) / 1000
        setSeconds(elapsed); callbacks.current.onLive({ start: time, duration: elapsed, peaks: [...levels], paused })
        if (elapsed >= limit) finish(true)
      }
      s.timer = window.setInterval(() => {
        if (recorder.state === 'recording') s.sample()
      }, 100)
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onstop = async () => {
        window.clearInterval(s.timer); s.stream.getTracks().forEach(t => t.stop()); if (s.ctx.state !== 'closed') void s.ctx.close()
        session.current = null
        callbacks.current.onRecording(false)
        callbacks.current.onLive(null)
        if (!mounted.current) return
        if (s.keep && chunks.length) await save({ token, audio: new Uint8Array(await new Blob(chunks).arrayBuffer()), peaks: levels })
        else { await window.agentshot.voiceover.cancel(token); tokenRef.current = null; setPhase('ready') }
      }
      recorder.onerror = () => { setError('The microphone stopped. Try recording again.'); finish(false) }
      setSeconds(0); setPhase('recording')
      callbacks.current.onLive({ start: time, duration: 0, peaks: [] })
      recorder.start(250); callbacks.current.onRecording(true)
    } catch (e) {
      stream?.getTracks().forEach(t => t.stop()); if (ctx && ctx.state !== 'closed') void ctx.close()
      if (tokenRef.current) void window.agentshot.voiceover.cancel(tokenRef.current)
      tokenRef.current = null
      if (mounted.current) { setError(clean(e)); setPhase('ready') }
    } finally { pending.current = false }
  }
  return <section className="rounded-lg border border-amber/30 bg-amber-soft p-3" data-voiceover-recorder>
    <div className="flex items-center gap-2"><Mic className="size-4 text-amber" /><strong className="flex-1">Voiceover <span className="text-xs text-amber">PRO</span></strong>
      <Button size="iconSm" variant="ghost" aria-label="Close voiceover" disabled={phase === 'saving'} onClick={onClose}><X /></Button>
    </div>
    <Dialog open={access.state === 'locked' || access.state === 'error'} onOpenChange={open => { if (!open && !access.busy) onClose() }} title="Voiceover is a premium feature" description="Record your own voice over the film, edit each take, and reuse it in chat. Included with Pro and Max.">
      {access.error && <p role="alert" className="mb-3 text-xs text-bad">{access.error}</p>}
      {access.busy === 'signin' && <p role="status" className="mb-3 text-xs text-dim">Finish signing in in your browser. We’ll continue automatically.</p>}
      {access.awaitingCheckout && <p role="status" className="mb-3 text-xs text-dim">Complete checkout in your browser. Voiceover will unlock automatically when your plan is ready.</p>}
      <div className="flex flex-wrap gap-2">
        {!access.account?.email && <Button disabled={!!access.busy || access.account?.available === false} onClick={access.signIn}>{access.busy === 'signin' && <Loader2 className="animate-spin" />}Sign in</Button>}
        <Button variant="primary" disabled={!!access.busy || access.awaitingCheckout} onClick={access.upgrade}>{access.busy === 'checkout' ? <Loader2 className="animate-spin" /> : <Crown />}Upgrade to Pro</Button>
        {access.state === 'error' && <Button disabled={!!access.busy} onClick={access.check}>Try again</Button>}
      </div>
    </Dialog>
    {access.state === 'unavailable' && <p role="status" className="py-3 text-xs text-dim">Restart AgentShot to finish loading the voiceover update.</p>}
    {access.account?.localPro && <p className="my-2 text-xs text-amber">Pro · local testing</p>}
    {access.state === 'checking' || phase === 'checking' || phase === 'saving' ? <p role="status" className="flex items-center gap-2 py-3 text-xs"><Loader2 className="size-4 animate-spin" />{phase === 'saving' ? 'Saving your voiceover…' : 'Getting voiceover ready…'}</p> : phase === 'recording' || phase === 'paused' ? <>
      <p role="status" data-recording-seconds={seconds} className="my-2 text-xs">{phase === 'paused' ? 'Ⅱ Paused' : '● Recording'} · {timecode(seconds)} · {phase === 'paused' ? 'Resume when you’re ready' : 'stops at the end of the film'}</p>
      <div className="flex flex-wrap gap-2">
        {phase === 'paused' ? <Button aria-label="Resume voiceover" onClick={resume}><Play />Resume</Button> : <Button aria-label="Pause voiceover" onClick={pause}><Pause />Pause</Button>}
        <Button variant="primary" onClick={() => finish(true)}><Square />Stop & add to video</Button>
        <Button variant="ghost" onClick={() => finish(false)}>Discard</Button>
      </div>
    </> : phase === 'ready' && access.state === 'ready' && <>
      <p className="my-2 text-xs text-dim">Record from {timecode(time)}. The picture plays silently while you speak.</p>
      {take ? <Button onClick={() => save(take)}>Retry saving take</Button> : <Button variant="primary" disabled={!active || time >= duration} onClick={start}><Mic />Record voiceover</Button>}
    </>}
    {error && <p role="alert" className="mt-2 text-xs text-bad">{error}</p>}
  </section>
}

/** Kept beside the conversation's files, even when its take is no longer on the timeline. */
export function ConversationVoiceovers({ project, onAttach }: { project: Project; onAttach(src: string): void }) {
  const assets = (project.voiceovers || []).filter(v => v.conversation === project.conversation && project.files?.[v.src])
  if (!assets.length) return null
  return <section data-conversation-voiceovers className="border-t border-line px-2 py-2">
    <h3 className="mb-2 flex items-center gap-1 text-xs font-medium"><Check className="size-3 text-ok" />Your voiceovers</h3>
    {assets.map(v => <div key={v.id} className="mb-3 space-y-1">
      <button className="flex w-full items-center gap-1 text-left text-xs text-dim hover:text-fg" title="Attach this recording to chat" onClick={() => onAttach(v.src)}><Mic className="size-3 shrink-0" /><span className="truncate">Voiceover · {new Date(v.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><Paperclip className="ml-auto size-3 shrink-0" /></button>
      <audio controls preload="none" src={mediaUrl(`${project.dir}/${v.src}`)} className="h-8 w-full" aria-label="Preview recorded voiceover" />
      <p className="text-[11px] text-dim">Voiceover added. Edit its track below the timeline or attach it to chat.</p>
    </div>)}
  </section>
}
