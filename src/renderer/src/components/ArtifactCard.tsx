import { useState } from 'react'
import { Download, File, FolderOpen, Loader2 } from 'lucide-react'
import { mediaUrl } from '@/lib/utils'

export function ArtifactCard({ dir, path }: { dir: string; path: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const image = /\.(png|jpe?g|webp|gif|avif)$/i.test(path)
  const download = async () => {
    setBusy(true); setError(''); setSaved(false)
    try { setSaved(!!await window.agentshot.project.downloadFile(dir, path)) }
    catch (e) { setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')) }
    finally { setBusy(false) }
  }
  return <div data-artifact={path} className="my-2 max-w-sm overflow-hidden rounded-xl border border-line bg-raised font-sans text-xs">
    {image && <img src={mediaUrl(`${dir}/${path}`)} alt={path.split('/').pop()} loading="lazy" className="max-h-56 w-full object-contain" onError={e => { e.currentTarget.style.display = 'none' }} />}
    <div className="flex items-center gap-2 p-3">
      <File className="size-4 shrink-0 text-dim" />
      <div className="min-w-0 flex-1"><div className="truncate font-medium" title={path}>{path.split('/').pop()}</div><div className="mt-0.5 text-faint">{saved ? 'Saved' : 'Project file'}</div></div>
      <button type="button" onClick={download} disabled={busy} className="flex items-center gap-1 rounded-md px-2 py-1.5 text-amber hover:bg-hover disabled:opacity-50" aria-label={`Download ${path.split('/').pop()}`}>
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}Download
      </button>
      <button type="button" aria-label={`Show ${path.split('/').pop()} in folder`} className="rounded p-1.5 text-dim hover:bg-hover" onClick={() => window.agentshot.project.revealFile(dir, path).catch(e => setError((e as Error).message))}><FolderOpen className="size-3.5" /></button>
    </div>
    {error && <p role="alert" className="px-3 pb-3 text-bad">{error}</p>}
  </div>
}
