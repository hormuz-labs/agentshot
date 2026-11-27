// A file the user chose in the editor page (dropped, or picked on this device) into their AgentShot space: the server
// gives a link for that one file (upload_start), and the page sends it there, saying how far it has got. Only where
// the server takes files (AgentShot in the cloud); on a computer, files are added in the app.
import type { ToolResult } from './host'

export type Sent = { folder: string; title?: string }

export async function sendFile(tool: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>, file: File, project: string | undefined, progress: (done: number) => void): Promise<Sent> {
  const started = await tool('upload_start', { name: file.name, size: file.size, ...(project ? { project } : {}) })
  const url = (started.structuredContent as { url?: string } | undefined)?.url
  if (!url) throw new Error('AgentShot didn’t say where to send the file.')
  return new Promise<Sent>((ok, fail) => {
    const x = new XMLHttpRequest()
    x.open('PUT', url)
    x.setRequestHeader('content-type', file.type || 'application/octet-stream')
    x.upload.onprogress = e => { if (e.lengthComputable) progress(e.loaded / e.total) }
    x.onload = () => {
      let body: { folder?: string; title?: string; error?: string } = {}
      try { body = JSON.parse(x.responseText) } catch { /* not JSON */ }
      if (x.status === 200 && body.folder) ok({ folder: body.folder, ...(body.title ? { title: body.title } : {}) })
      else fail(new Error(body.error || `The file didn’t arrive (${x.status}).`))
    }
    x.onerror = () => fail(new Error('The file didn’t arrive: the connection dropped. Try again.'))
    x.send(file)
  })
}

/** The files a drop or a picker gave, videos and pictures and sounds first in the order given. */
export const filesOf = (list: FileList | null | undefined) => Array.from(list || []).filter(f => f.size > 0)
