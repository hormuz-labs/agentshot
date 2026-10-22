import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { beforeEach, describe, expect, it } from 'vitest'
import { newestProjects } from '../src/shared/project-order'
import { load, recent } from '../src/main/projects'
import type { Project } from '../src/shared/types'

describe('stable project order', () => {
  it('sorts newest created first regardless of last-opened order, without mutating input', () => {
    const projects = [{ dir: 'old', createdAt: 10, openedAt: 900 }, { dir: 'new', createdAt: 30, openedAt: 100 }, { dir: 'middle', createdAt: 20, openedAt: 500 }]
    expect(newestProjects(projects).map(p => p.dir)).toEqual(['new', 'middle', 'old'])
    expect(projects.map(p => p.dir)).toEqual(['old', 'new', 'middle'])
    expect(newestProjects([...projects].reverse()).map(p => p.dir)).toEqual(['new', 'middle', 'old'])
  })

  it('uses a deterministic path tie-breaker when creation timestamps match', () => {
    const projects = [{ dir: '/z', createdAt: 42 }, { dir: '/a', createdAt: 42 }, { dir: '/m', createdAt: 42 }]
    expect(newestProjects(projects).map(p => p.dir)).toEqual(['/a', '/m', '/z'])
    expect(newestProjects([...projects].reverse())).toEqual(newestProjects(projects))
  })

  it('puts unknown or invalid dates at the end without using a changing openedAt fallback', () => {
    expect(newestProjects([{ dir: 'b' }, { dir: 'new', createdAt: 5 }, { dir: 'a', createdAt: NaN }, { dir: 'c', createdAt: Infinity }]).map(p => p.dir)).toEqual(['new', 'a', 'b', 'c'])
    expect(newestProjects([])).toEqual([])
  })

  it('keeps open projects in chronological position instead of promoting them above recent projects', () => {
    const open = [{ dir: 'old-open', createdAt: 10 }]
    const recent = [{ dir: 'new-closed', createdAt: 30 }, { dir: 'middle-closed', createdAt: 20 }]
    expect(newestProjects([...open, ...recent]).map(p => p.dir)).toEqual(['new-closed', 'middle-closed', 'old-open'])
  })
})

describe('recent project creation dates', () => {
  const root = mkdtempSync(join(tmpdir(), 'manul-project-order-'))
  const recentFile = join(app.getPath('userData'), 'recent.json')
  const fixture = (name: string, createdAt: number) => {
    const dir = join(root, name)
    mkdirSync(dir, { recursive: true })
    const p = { id: name, dir, title: name, createdAt, versions: [], current: '', media: {}, notes: [], timeline: { width: 320, height: 240, fps: 25, items: [] } } as Project
    writeFileSync(join(dir, 'project.json'), JSON.stringify(p))
    return p
  }
  beforeEach(() => writeFileSync(recentFile, '[]'))

  it('hydrates legacy entries from project.json and ignores deleted projects', () => {
    const old = fixture('old', 100), fresh = fixture('fresh', 200)
    writeFileSync(recentFile, JSON.stringify([
      { id: old.id, dir: old.dir, title: old.title, openedAt: 900 },
      { id: fresh.id, dir: fresh.dir, title: fresh.title, openedAt: 400 },
      { id: 'missing', dir: join(root, 'missing'), title: 'missing', openedAt: 1000 },
    ]))
    expect(recent().map(p => [p.id, p.createdAt])).toEqual([['fresh', 200], ['old', 100]])
  })

  it('does not juggle projects when an older project is repeatedly opened or renamed', async () => {
    const old = fixture('old', 100), fresh = fixture('fresh', 200)
    await load(old.dir)
    await load(fresh.dir)
    const order = recent().map(p => p.dir)
    await load(old.dir)
    await load(old.dir)
    expect(recent().map(p => p.dir)).toEqual(order)
    old.title = 'Renamed old project'
    writeFileSync(join(old.dir, 'project.json'), JSON.stringify(old))
    await load(old.dir)
    expect(recent().map(p => p.dir)).toEqual([fresh.dir, old.dir])
    expect(recent()[1]).toMatchObject({ title: old.title, createdAt: 100 })
  })

  it('keeps other entries usable when one legacy project JSON is corrupt', () => {
    const old = fixture('broken', 100), fresh = fixture('valid', 200)
    writeFileSync(join(old.dir, 'project.json'), '{broken')
    writeFileSync(recentFile, JSON.stringify([old, fresh].map(p => ({ id: p.id, title: p.title, dir: p.dir, openedAt: 999 }))))
    expect(recent().map(p => p.id)).toEqual(['valid', 'broken'])
  })
})
