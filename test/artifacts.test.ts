import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactPath } from '../src/main/artifacts'
import { artifactRelative, chatArtifacts } from '../src/shared/artifacts'
import { fileRows } from '../src/renderer/src/views/FilesPanel'
import { syncFiles } from '../src/main/projects'
import type { Project } from '../src/shared/types'

describe('generated file delivery', () => {
  it('finds linked files, images, and known backtick paths without duplicate cards', () => {
    const dir = '/Users/me/Movies/Manul/intro'
    const text = '[Download thumbnail](renders/my%20thumbnail.png) ![Preview](renders/my%20thumbnail.png) `outputs/report.pdf` [Report](<documents/my report.pdf>)'
    expect(chatArtifacts(text, dir, ['outputs/report.pdf'])).toEqual(['renders/my thumbnail.png', 'outputs/report.pdf', 'documents/my report.pdf'])
    expect(artifactRelative(`${dir}/renders/a.png`, dir)).toBe('renders/a.png')
    expect(artifactRelative(`file://${dir}/renders/a.png`, dir)).toBe('renders/a.png')
    for (const path of ['https://example.com/a.pdf', 'javascript:alert(1)', '../secret.txt', '%2e%2e/secret.txt', '/etc/passwd', 'renders/../../x.pdf', 'renders/.secret.pdf']) expect(artifactRelative(path, dir)).toBeNull()
  })

  it('restricts download sources to real project files, including symlink targets', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'manul-artifacts-'))
    const dir = join(parent, 'project')
    await mkdir(join(dir, 'renders'), { recursive: true })
    await writeFile(join(dir, 'renders', 'report.pdf'), 'report')
    await writeFile(join(parent, 'secret.pdf'), 'secret')
    await symlink(join(parent, 'secret.pdf'), join(dir, 'renders', 'escape.pdf'))
    expect(await artifactPath(dir, 'renders/report.pdf')).toBe(await realpath(join(dir, 'renders', 'report.pdf')))
    await expect(artifactPath(dir, '../secret.pdf')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders/escape.pdf')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders')).rejects.toThrow(/not a file/)
    await expect(artifactPath(dir, 'missing.pdf')).rejects.toThrow()
  })

  it('discovers generated deliverables and groups nested output folders in Files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manul-generated-'))
    await mkdir(join(dir, 'renders', 'docs'), { recursive: true })
    await writeFile(join(dir, 'renders', 'docs', 'report.txt'), 'Generated report')
    await writeFile(join(dir, 'renders', 'build.py'), 'internal script')
    await writeFile(join(dir, 'renders', '.partial.txt'), 'incomplete')
    await writeFile(join(dir, 'summary.md'), 'Summary')
    await writeFile(join(dir, 'thumb.jpg'), 'internal project thumbnail')
    const p = { dir, files: {}, media: {} } as Project
    expect(await syncFiles(p)).toBe(true)
    expect(Object.keys(p.files!).sort()).toEqual(['renders/docs/report.txt', 'summary.md'])
    expect(await syncFiles(p)).toBe(false)
    expect(fileRows(Object.keys(p.files!))).toEqual([
      { kind: 'folder', name: 'renders', rels: ['renders/docs/report.txt'], depth: 0 },
      { kind: 'folder', name: 'renders/docs', rels: ['renders/docs/report.txt'], depth: 1 },
      { kind: 'file', rel: 'renders/docs/report.txt', depth: 2 },
      { kind: 'file', rel: 'summary.md', depth: 0 },
    ])
  })
})
