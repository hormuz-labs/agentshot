// The editor with no projects yet (AgentShot in the cloud): bring a video in by dropping it here or choosing it, and
// the editor opens on it. A link given in the chat works too (add_video), so it says so.
import { useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { filesOf, type Sent } from './upload'
import logo from './logo.png'

export function StartScreen({ send, onDone }: { send(file: File, progress: (done: number) => void): Promise<Sent>; onDone(sent: Sent, name: string): void }) {
  const picker = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [sending, setSending] = useState<{ name: string; done: number } | null>(null)
  const [problem, setProblem] = useState('')

  const take = async (files: File[]) => {
    const file = files[0]
    if (!file || sending) return
    setProblem(''); setSending({ name: file.name, done: 0 })
    try { onDone(await send(file, done => setSending({ name: file.name, done })), file.name) }
    catch (e) { setProblem((e as Error).message); setSending(null) }
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
        <p className="text-lg font-semibold">Bring in a video to edit</p>
        <p className="mt-1 text-sm text-dim">Drop it here, or choose it. You can also paste a link to it in the chat.</p>
      </div>
      {sending ? (
        <div className="w-full max-w-sm space-y-2">
          <p className="flex items-center justify-center gap-2 text-sm"><Loader2 className="size-4 animate-spin text-amber" />Sending {sending.name}… {Math.round(sending.done * 100)}%</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-hover"><div className="h-full bg-amber transition-[width]" style={{ width: `${sending.done * 100}%` }} /></div>
        </div>
      ) : (
        <Button variant="primary" onClick={() => picker.current?.click()}><Upload />Choose a video</Button>
      )}
      {problem && <p role="alert" className="text-sm text-red-400">{problem}</p>}
      <input ref={picker} type="file" accept="video/*,audio/*,image/*" hidden onChange={e => { void take(filesOf(e.target.files)); e.target.value = '' }} />
    </div>
  )
}
