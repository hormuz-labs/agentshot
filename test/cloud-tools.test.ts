import { describe, expect, it } from 'vitest'
import { CLOUD_TOOLS, WORKER_URL, cloudTool } from '../src/shared/cloud-tools'

describe('cloud tools', () => {
  it('live on AgentShot’s worker', () => {
    expect(WORKER_URL).toBe('https://worker.trypitch.co')
    for (const t of CLOUD_TOOLS) expect(t.endpoint.startsWith(`${WORKER_URL}/`)).toBe(true)
  })

  it('has a place for upscaling, switched off until the worker serves it', () => {
    expect(CLOUD_TOOLS.find(t => t.id === 'upscale')).toMatchObject({ status: 'coming-soon', endpoint: `${WORKER_URL}/upscale` })
  })

  it('refuses tools that are not live yet, and unknown ones', () => {
    expect(() => cloudTool('upscale')).toThrow(/coming soon/)
    expect(() => cloudTool('nope')).toThrow(/unknown/)
  })
})
