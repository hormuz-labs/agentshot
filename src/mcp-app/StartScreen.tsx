// The editor with no projects yet (AgentShot in the cloud): bring videos in by dropping them here or choosing them; the
// first starts the project, the rest go into it, and the editor opens on it. A link given in the chat works too (add_video), so it says so.
import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { filesOf, type Sent } from './upload'
import logo from './logo.png'

export function StartScreen({ send, onDone }: { send(file: File, progress: (done: number) => void, into?: string): Promise<Sent>; onDone(sent: Sent): void }) {
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [sending, setSending] = useState<{ name: string; done: number; n: number; of: number } | null>(null)
  const [problem, setProblem] = useState('')
  // some arrived before one failed: they're a project already, to open when the user has read what went wrong
  const [partly, setPartly] = useState<Sent | undefined>()

  const take = async (files: File[]) => {
    if (!files.length || sending) return
    setProblem('')
    let made: Sent | undefined
    for (const [i, file] of files.entries()) {
      setSending({ name: file.name, done: 0, n: i + 1, of: files.length })
      try { made = await send(file, done => setSending({ name: file.name, done, n: i + 1, of: files.length }), made?.folder) }
      catch (e) {
        setProblem(`${file.name} didn’t arrive: ${(e as Error).message}${made ? ` The ${i === 1 ? 'one' : i} before it did.` : ''}`)
        setPartly(made)
        setSending(null)
        return
      }
    }
    if (made) onDone(made)
  }

  return (
    <div
      className={cn('flex h-[420px] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-line bg-canvas p-8 text-center text-fg', over && 'border-amber bg-amber-soft')}
      onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (e.currentTarget === e.target) setOver(false) }}
      onDrop={e => { e.preventDefault(); setOver(false); void take(filesOf(e.dataTransfer.files)) }}
    >
      <img src={logo} alt="" className="size-12 rounded-xl" />
      <div>
        <p className="text-lg font-semibold">Bring in your videos to edit</p>
        <p className="mt-1 text-sm text-dim">Drop them here, or choose them: videos, pictures, music. You can also paste a link in the chat.</p>
      </div>
      {sending ? (
        <div className="w-full max-w-sm space-y-2">
          <p className="flex items-center justify-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-amber" />Sending {sending.of > 1 ? `${sending.n} of ${sending.of}: ` : ''}{sending.name}… {Math.round(sending.done * 100)}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-amber transition-[width]" style={{ width: `${sending.done * 100}%` }} /></div>
        </div>
      ) : partly ? (
        <Button variant="primary" onClick={() => onDone(partly)}>Open what arrived</Button>
      ) : (
        <Button variant="primary" onClick={() => picker.current?.click()}><Upload />Choose files</Button>
      )}
      {problem && <p role="alert" className="text-sm text-red-400">{problem}</p>}
      <input ref={picker} type="file" multiple accept="video/*,audio/*,image/*" hidden onChange={e => { void take(filesOf(e.target.files)); e.target.value = '' }} />
    </div>
  )
}
