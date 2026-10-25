// Cloud tools: jobs too heavy for most computers, run on AgentShot's own worker instead of on demand.
// Only the clip a tool needs is sent. They show in Tools as "Coming soon" until the worker serves them.
export const WORKER_URL = 'https://worker.trypitch.co'

export type CloudTool = {
  id: string
  name: string
  description: string
  endpoint: string
  status: 'coming-soon' | 'live'
}

export const CLOUD_TOOLS: CloudTool[] = [
  {
    id: 'upscale', name: 'Upscale (Real-ESRGAN)', endpoint: `${WORKER_URL}/upscale`, status: 'coming-soon',
    description: 'Sharper, higher-resolution footage, 2× or 4× (up to 4K). Runs on AgentShot’s worker, so your computer stays free; only the shot you upscale is sent.',
  },
]

/** The tool, if it can be used now. */
export function cloudTool(id: string): CloudTool {
  const t = CLOUD_TOOLS.find(t => t.id === id)
  if (!t) throw new Error(`unknown cloud tool: ${id}`)
  if (t.status !== 'live') throw new Error(`${t.name} is coming soon`)
  return t
}
