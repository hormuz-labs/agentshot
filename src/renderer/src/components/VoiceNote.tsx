// Saying a note instead of typing it: the mic beside Send. Hold it and talk (let go to hear it), or click it to talk
// hands-free and click the tick when done. The recording goes to this computer's speech recognition and the words
// land in the message box to look over before sending.
import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Mic, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

type Stage = 'idle' | 'recording' | 'hearing'
const HOLD_MS = 350
const LONGEST_S = 15 * 60

function useVoiceNote(dir: string, onText: (text: string) => void) {
  const [stage, setStage] = useState<Stage>('idle')
  const [levels, setLevels] = useState<number[]>([])
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<{ why: string; note: Blob } | null>(null)
  const live = useRef<{ recorder: MediaRecorder; stream: MediaStream; audio: AudioContext; chunks: Blob[]; started: number; timer: number; keep: boolean } | null>(null)

  const close = () => {
    const l = live.current
    if (!l) return
    live.current = null
    window.clearInterval(l.timer)
    l.stream.getTracks().forEach(t => t.stop())
    void l.audio.close()
    setLevels([])
  }
  useEffect(() => close, [])

  const hear = async (note: Blob) => {
    setStage('hearing')
    setError(null)
    try {
      const text = await window.agentshot.agent.hear(dir, new Uint8Array(await note.arrayBuffer()))
      if (text.trim()) onText(text.trim())
      else setError({ why: 'Nothing was heard in that note.', note })
    } catch (e) {
      setError({ why: (e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), note })
    } finally {
      setStage('idle')
    }
  }

  const start = async () => {
    if (live.current) return
    setError(null)
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setError({ why: 'AgentShot can’t use the microphone. Allow it in your system settings.', note: new Blob() })
      return
    }
    const recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? { mimeType: 'audio/webm;codecs=opus' } : {})
    const audio = new AudioContext()
    const analyser = audio.createAnalyser()
    analyser.fftSize = 512
    audio.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const l = { recorder, stream, audio, chunks: [] as Blob[], started: Date.now(), keep: false, timer: 0 }
    l.timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const v of samples) peak = Math.max(peak, Math.abs(v - 128) / 128)
      setLevels(ls => [...ls.slice(-39), Math.min(1, peak * 2.5)])
      const s = Math.floor((Date.now() - l.started) / 1000)
      setSeconds(s)
      if (s >= LONGEST_S) finish()
    }, 90)
    recorder.ondataavailable = e => { if (e.data.size) l.chunks.push(e.data) }
    recorder.onstop = () => {
      const note = new Blob(l.chunks, { type: recorder.mimeType })
      const enough = Date.now() - l.started > 600
      close()
      if (l.keep && enough) void hear(note)
      else setStage('idle')
    }
    live.current = l
    setSeconds(0)
    setStage('recording')
    recorder.start(250)
  }

  const end = (keep: boolean) => {
    const l = live.current
    if (!l) return
    l.keep = keep
    if (l.recorder.state !== 'inactive') l.recorder.stop()
  }
  const finish = () => end(true)
  const cancel = () => end(false)

  return { stage, levels, seconds, error, start, finish, cancel, retry: () => error?.note.size && hear(error.note), dismiss: () => setError(null) }
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** The mic button, and while it listens, the strip that replaces the message box's buttons. */
export function VoiceNote({ dir, onText, children }: { dir: string; onText(text: string): void; children(mic: React.ReactNode, strip: React.ReactNode | null, problem: React.ReactNode | null): React.ReactNode }) {
  const v = useVoiceNote(dir, onText)

  useEffect(() => {
    if (v.stage !== 'recording') return
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); v.cancel() }
      if (e.key === 'Enter') { e.preventDefault(); v.finish() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [v.stage]) // eslint-disable-line react-hooks/exhaustive-deps

  const mic = (
    <Button
      size="iconSm"
      variant="secondary"
      className="rounded-full"
      aria-label="Say a note"
      title="Say a note: hold to talk, or click to talk hands-free"
      data-voice-mic
      disabled={v.stage === 'hearing'}
      onPointerDown={e => {
        if (e.button !== 0) return
        const at = Date.now()
        // the strip takes the button's place as it listens, so letting go is heard on the window: a quick click keeps
        // listening (hands-free, done with the tick), a hold ends when let go
        window.addEventListener('pointerup', () => { if (Date.now() - at >= HOLD_MS) v.finish() }, { once: true })
        void v.start()
      }}
    >
      {v.stage === 'hearing' ? <Loader2 className="animate-spin" /> : <Mic />}
    </Button>
  )

  const strip = v.stage === 'recording' ? (
    <div className="flex flex-1 items-center gap-2" data-voice-recording>
      <button onClick={v.cancel} title="Throw it away (Esc)" aria-label="Throw the note away" className="flex size-7 items-center justify-center rounded-full text-dim hover:bg-hover hover:text-fg"><X className="size-4" /></button>
      <span className="size-2 animate-pulse rounded-full bg-red-500" />
      <span className="w-10 text-[12px] text-dim tabular">{clock(v.seconds)}</span>
      <div className="flex h-6 flex-1 items-center gap-[3px] overflow-hidden">
        {v.levels.map((l, i) => <span key={i} className="w-[3px] shrink-0 rounded-full bg-amber" style={{ height: `${Math.max(12, l * 100)}%`, opacity: 0.45 + l * 0.55 }} />)}
      </div>
      <Button size="iconSm" variant="primary" className="rounded-full" onClick={v.finish} title="Done (Enter)" aria-label="Done talking"><Check /></Button>
    </div>
  ) : v.stage === 'hearing' ? (
    <span className="flex-1 px-1 text-[12px] text-dim" data-voice-hearing>Listening to your note…</span>
  ) : null

  const problem = v.error ? (
    <div className="flex items-center gap-2 px-3 pb-2 text-[12px] text-bad" data-voice-problem>
      <span className="flex-1">{v.error.why}</span>
      {v.error.note.size > 0 && <button className="font-medium text-fg hover:underline" onClick={() => void v.retry()}>Try again</button>}
      <button className="text-faint hover:text-fg" onClick={v.dismiss} aria-label="Dismiss"><X className="size-3" /></button>
    </div>
  ) : null

  return <>{children(mic, strip, problem)}</>
}
