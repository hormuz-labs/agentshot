import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { History } from '../src/main/history'

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'agentshot-hist-'))
  mkdirSync(join(dir, 'clips', 'title'), { recursive: true })
  mkdirSync(join(dir, 'media'))
  writeFileSync(join(dir, 'project.json'), '{"v":1}')
  writeFileSync(join(dir, 'clips', 'title', 'clip.html'), '<h1>One</h1>')
  writeFileSync(join(dir, 'media', 'big.mp4'), Buffer.alloc(1024))
  return dir
}

describe('project history', () => {
  it('records project.json and clip HTML, never media', async () => {
    const dir = project()
    const h = new History(dir)
    await h.record('Imported')
    const files = await h.files((await h.log())[0].id)
    expect(files.sort()).toEqual(['clips/title/clip.html', 'project.json'])
  })

  it('logs newest first with messages and times', async () => {
    const dir = project(); const h = new History(dir)
    await h.record('Imported')
    writeFileSync(join(dir, 'project.json'), '{"v":2}')
    await h.record('Accepted “Fillers removed”')
    const log = await h.log()
    expect(log.map(e => e.message)).toEqual(['Accepted “Fillers removed”', 'Imported'])
    expect(log[0].at).toBeGreaterThan(0)
  })

  it('skips a record when nothing changed', async () => {
    const dir = project(); const h = new History(dir)
    await h.record('Imported')
    await h.record('Nothing')
    expect((await h.log())).toHaveLength(1)
  })

  it('restores an earlier point and says which clips changed', async () => {
    const dir = project(); const h = new History(dir)
    await h.record('Imported')
    const first = (await h.log())[0].id
    writeFileSync(join(dir, 'project.json'), '{"v":2}')
    writeFileSync(join(dir, 'clips', 'title', 'clip.html'), '<h1>Two</h1>')
    await h.record('Edited title')
    const r = await h.restore(first)
    expect(readFileSync(join(dir, 'project.json'), 'utf8')).toBe('{"v":1}')
    expect(readFileSync(join(dir, 'clips', 'title', 'clip.html'), 'utf8')).toBe('<h1>One</h1>')
    expect(r.clips).toEqual(['title'])
    expect((await h.log())[0].message).toMatch(/^Restored/) // the restore is itself a point you can go back from
  })
})
