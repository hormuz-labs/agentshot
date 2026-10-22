import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { describe, expect, it, vi } from 'vitest'
import { FFMPEG } from '../src/main/media'
import { renderOutput, TimelineRenders } from '../src/main/timeline-renders'
import { applyEdit, fromMedia } from '../src/shared/timeline'
import { cameraLayout } from '../src/shared/demo'
import type { Project, Version } from '../src/shared/types'

const run = promisify(execFile)
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => { resolve = r })
  return { promise, resolve }
}
function fixture() {
  const timeline = { ...fromMedia('media/screen.mp4', 24, { width: 320, height: 180, fps: 25 }), demo: {
    screen: 'media/screen.mp4', camera: 'media/camera.mp4', cameraDuration: 24,
    sync: { offset: 1.76, rate: 0.99998, confidence: 0.984, reliable: true, residual: 0.00009, anchors: [], overlap: [1.76, 24] as [number, number], method: 'fixture' },
    layout: cameraLayout(320, 180, { shape: 'rounded', width: 80 }), audio: 'screen' as const,
  } }
  const p: Project = { id: 'p', title: 'Demo', dir: '/test', createdAt: 0, current: 'original', notes: [], media: {},
    versions: [{ id: 'original', path: 'renders/old.mp4', title: 'Original demo', by: 'agent', createdAt: 0, timeline: structuredClone(timeline) }],
    timeline: applyEdit(timeline, { op: 'camera', layout: { shape: 'circle', framing: { fit: 'cover', zoom: 1.26, x: 0.14, y: -0.08 } } }),
  }
  const gate = deferred()
  const render = vi.fn(async () => { await gate.promise; return { final: 'renders/new.mp4' } })
  const addVersion = vi.fn(async (project: Project, file: string, title: string, by: Version['by'], tl: Project['timeline'], dry?: string) => {
    const v: Version = { id: `v${project.versions.length}`, path: relative(project.dir, file), title, by, createdAt: 1, timeline: tl, dry }
    project.versions.push(v)
    return v
  })
  const checkpoint = vi.fn(async () => {}), preview = vi.fn()
  return { p, gate, render, addVersion, checkpoint, preview, renders: new TimelineRenders({ render, addVersion, checkpoint, preview }) }
}

describe('timeline render coordination', () => {
  it('shares a chat layout render with Save/Export and preserves the linked sync, framing and cuts', async () => {
    const f = fixture(), expected = structuredClone(f.p.timeline)
    const chat = f.renders.request(f.p, f.p.timeline!, 'Layout adjusted')
    const save = f.renders.request(f.p, f.p.timeline!, 'Save', 'user', false)
    const exportRender = f.renders.request(f.p, f.p.timeline!, 'Export', 'user', false)
    expect(save).toBe(chat)
    expect(exportRender).toBe(chat)
    f.gate.resolve()
    const [a, b, c] = await Promise.all([chat, save, exportRender])
    expect(a).toBe(b); expect(a).toBe(c)
    expect(f.render).toHaveBeenCalledTimes(1)
    expect(f.p.versions).toHaveLength(2)
    expect(f.p.current).toBe(a)
    expect(f.p.proposal).toBeUndefined()
    expect(f.p.timeline).toEqual(expected)
    expect(f.p.versions[1].timeline).toEqual(expected)
    expect(f.p.versions[1].by).toBe('user')
    expect(f.preview).toHaveBeenCalledTimes(1)
  })
  it('retains Accept/Reject proposals for a chat-only render', async () => {
    const f = fixture(), before = structuredClone(f.p.timeline)
    const chat = f.renders.request(f.p, f.p.timeline!, 'Adjusted')
    f.gate.resolve()
    const id = await chat
    expect(f.p.current).toBe('original')
    expect(f.p.proposal).toBe(id)
    expect(f.p.timeline).toEqual(before)
  })
  it.each([true, false])('keeps newer live edits when an earlier render completes (proposal=%s)', async propose => {
    const f = fixture(), expected = structuredClone(f.p.timeline)
    const work = f.renders.request(f.p, f.p.timeline!, 'Adjusted', propose ? 'agent' : 'user', propose)
    f.p.timeline!.demo!.layout.width = 110 // even an in-place mutation must not alter the render snapshot
    f.gate.resolve()
    const id = await work
    expect(f.p.timeline!.demo!.layout.width).toBe(110)
    expect(f.p.current).toBe('original')
    expect(f.p.proposal).toBeUndefined()
    expect(f.p.versions.find(v => v.id === id)?.timeline).toEqual(expected)
  })
  it('does not switch back to an earlier version when the user switches during rendering', async () => {
    const f = fixture()
    const work = f.renders.request(f.p, f.p.timeline!, 'Adjusted', 'user', false)
    f.p.current = 'other-version'
    f.gate.resolve()
    await work
    expect(f.p.current).toBe('other-version')
  })
  it('does not let an older proposal supersede a newer render completed first', async () => {
    const f = fixture(), second = deferred()
    f.render.mockImplementationOnce(async () => { await f.gate.promise; return { final: 'renders/one.mp4' } })
    f.render.mockImplementationOnce(async () => { await second.promise; return { final: 'renders/two.mp4' } })
    const one = f.renders.request(f.p, f.p.timeline!, 'One')
    const twoTimeline = structuredClone(f.p.timeline!); twoTimeline.demo!.layout.width = 110
    const two = f.renders.request(f.p, twoTimeline, 'Two')
    second.resolve()
    const newer = await two
    f.gate.resolve()
    await one
    expect(f.p.proposal).toBe(newer)
  })
  it('clears a failed shared job so the same edit can be retried', async () => {
    const f = fixture()
    f.render.mockRejectedValueOnce(new Error('Encoding failed'))
    const chat = f.renders.request(f.p, f.p.timeline!, 'Adjusted')
    const save = f.renders.request(f.p, f.p.timeline!, 'Save', 'user', false)
    await expect(chat).rejects.toThrow('Encoding failed')
    await expect(save).rejects.toThrow('Encoding failed')
    expect(f.p.versions).toHaveLength(1)
    expect(f.preview).not.toHaveBeenCalled()
    f.gate.resolve()
    await f.renders.request(f.p, f.p.timeline!, 'Retry')
    expect(f.render).toHaveBeenCalledTimes(2)
  })
})

describe('private render files', () => {
  it('publishes concurrent real FFmpeg renders to distinct complete files without overwriting earlier versions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manul-render-race-'))
    try {
      const old = await renderOutput(dir, 'timeline', false, async o => {
        await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=blue:s=160x90:r=25:d=1', '-c:v', 'libx264', join(dir, o.final)])
      })
      const original = await readFile(join(dir, old.final)), gate = deferred(), started = deferred()
      const first = renderOutput(dir, 'timeline', true, async o => {
        await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=160x90:r=25:d=1', '-c:v', 'libx264', join(dir, o.out)])
        started.resolve(); await gate.promise
        await run(FFMPEG, ['-v', 'error', '-i', join(dir, o.out), '-c', 'copy', join(dir, o.final)])
      })
      const second = renderOutput(dir, 'timeline', false, async o => {
        await run(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'color=green:s=160x90:r=25:d=1', '-c:v', 'libx264', join(dir, o.final)])
      })
      await started.promise
      const b = await second
      expect((await readdir(join(dir, 'renders'))).filter(f => f.endsWith('.mp4'))).toHaveLength(2)
      gate.resolve()
      const a = await first
      expect(new Set([old.final, a.final, a.dry, b.final]).size).toBe(4)
      expect(await readFile(join(dir, old.final))).toEqual(original)
      expect((await readdir(join(dir, 'renders'))).some(f => f.startsWith('.'))).toBe(false)
      for (const rel of [old.final, a.final, a.dry!, b.final]) {
        const decoded = await run(FFMPEG, ['-v', 'error', '-xerror', '-i', join(dir, rel), '-f', 'null', '-'])
        expect(decoded.stderr).toBe('')
      }
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
  it('removes partial outputs after encoding fails', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manul-render-fail-'))
    try {
      let partial = ''
      await expect(renderOutput(dir, 'timeline', false, async o => {
        partial = join(dir, o.final)
        await writeFile(partial, 'partial MP4')
        throw new Error('Encoding stopped')
      })).rejects.toThrow('Encoding stopped')
      expect(existsSync(partial)).toBe(false)
      expect(await readdir(join(dir, 'renders'))).toEqual([])
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})
