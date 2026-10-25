import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { artifactPath } from '../src/main/artifacts'
import { artifactRelative, chatArtifacts } from '../src/shared/artifacts'
import { fileRows } from '../src/renderer/src/views/FilesPanel'
import { syncFiles } from '../src/main/projects'
import type { Project } from '../src/shared/types'

describe('generated file delivery', () => {
  it.each(['./renders/a.png', ' renders/a.png ', '<renders/a.png>', '/Users/me/project/renders/a.png', 'file:///Users/me/project/renders/a.png'])('normalizes project links: %s', path => {
    expect(artifactRelative(path, '/Users/me/project')).toBe('renders/a.png')
  })

  it.each(['', 'renders', 'renders/', 'renders//a.pdf', 'renders/./a.pdf', 'renders/%2eprivate/a.pdf', 'renders/a%00.pdf', 'renders/a%0a.pdf', 'renders\\a.pdf', 'renders/%ZZ.pdf', '/Users/me/project-other/a.pdf', 'data:text/plain,a.pdf', 'https://example.com/a.pdf', '//example.com/a.pdf'])('does not turn unsafe or incomplete links into cards: %s', path => {
    expect(artifactRelative(path, '/Users/me/project')).toBeNull()
  })

  it('decodes Unicode filenames and includes backtick references only when known', () => {
    const dir = '/Users/me/project'
    expect(artifactRelative('documents/caf%C3%A9%20notes.pdf', dir)).toBe('documents/café notes.pdf')
    expect(chatArtifacts('`unknown.pdf` `documents/café notes.pdf` [Report](documents/caf%C3%A9%20notes.pdf) [Website](https://example.com/report.pdf)', dir, ['documents/café notes.pdf'])).toEqual(['documents/café notes.pdf'])
    expect(chatArtifacts('[Report](documents/report', dir)).toEqual([])
  })

  it('finds linked files, images, and known backtick paths without duplicate cards', () => {
    const dir = '/Users/me/Movies/Manul/intro'
    const text = '[Download thumbnail](renders/my%20thumbnail.png) ![Preview](renders/my%20thumbnail.png) `outputs/report.pdf` [Report](<documents/my report.pdf>)'
    expect(chatArtifacts(text, dir, ['outputs/report.pdf'])).toEqual(['renders/my thumbnail.png', 'outputs/report.pdf', 'documents/my report.pdf'])
    expect(artifactRelative(`${dir}/renders/a.png`, dir)).toBe('renders/a.png')
    expect(artifactRelative(`file://${dir}/renders/a.png`, dir)).toBe('renders/a.png')
    for (const path of ['https://example.com/a.pdf', 'javascript:alert(1)', '../secret.txt', '%2e%2e/secret.txt', '/etc/passwd', 'renders/../../x.pdf', 'renders/.secret.pdf']) expect(artifactRelative(path, dir)).toBeNull()
  })

  it('restricts download sources to real project files, including symlink targets', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'agentshot-artifacts-'))
    const dir = join(parent, 'project')
    await mkdir(join(dir, 'renders'), { recursive: true })
    await writeFile(join(dir, 'renders', 'report.pdf'), 'report')
    await writeFile(join(parent, 'secret.pdf'), 'secret')
    await writeFile(join(dir, 'renders', '.secret.pdf'), 'hidden')
    await mkdir(join(dir, '.private'))
    await writeFile(join(dir, '.private', 'secret.pdf'), 'hidden directory')
    let fileLinks = true
    try {
      await symlink(join(parent, 'secret.pdf'), join(dir, 'renders', 'escape.pdf'))
      await symlink(join(dir, 'renders', 'report.pdf'), join(dir, 'renders', 'alias.pdf'))
    } catch { fileLinks = false }
    await symlink(join(dir, '.private'), join(dir, 'renders', 'private'), process.platform === 'win32' ? 'junction' : 'dir')
    await symlink(parent, join(dir, 'renders', 'escape-dir'), process.platform === 'win32' ? 'junction' : 'dir')
    expect(await artifactPath(dir, 'renders/report.pdf')).toBe(await realpath(join(dir, 'renders', 'report.pdf')))
    await expect(artifactPath(dir, '../secret.pdf')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders/escape-dir/secret.pdf')).rejects.toThrow(/inside this project/)
    if (fileLinks) await expect(artifactPath(dir, 'renders/escape.pdf')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders')).rejects.toThrow(/not a file/)
    await expect(artifactPath(dir, 'missing.pdf')).rejects.toThrow()
    await expect(artifactPath(dir, '.')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders/.secret.pdf')).rejects.toThrow(/inside this project/)
    await expect(artifactPath(dir, 'renders/private/secret.pdf')).rejects.toThrow(/inside this project/)
    if (fileLinks) expect(await artifactPath(dir, 'renders/alias.pdf')).toBe(await realpath(join(dir, 'renders', 'report.pdf')))
    expect(await artifactPath(dir, join(dir, 'renders', 'report.pdf'))).toBe(await realpath(join(dir, 'renders', 'report.pdf')))
  })

  it.each(['renders', 'exports', 'documents', 'outputs', 'downloads', 'generated'])('discovers nested deliverables in %s without exposing scripts, hidden files or partial downloads', async folder => {
    const dir = await mkdtemp(join(tmpdir(), 'agentshot-discovery-'))
    const out = join(dir, folder, 'nested')
    await mkdir(join(out, '.private'), { recursive: true })
    for (const name of ['report.pdf', 'notes.txt', 'data.csv', 'page.html', 'bundle.zip', 'build.py', 'script.js', 'model.bin', 'report.pdf.part', '.hidden.txt']) await writeFile(join(out, name), 'fixture')
    await writeFile(join(out, '.private', 'secret.txt'), 'hidden')
    const p = { dir, files: {}, media: {} } as Project
    expect(await syncFiles(p)).toBe(true)
    expect(Object.keys(p.files!).sort()).toEqual(['bundle.zip', 'data.csv', 'notes.txt', 'page.html', 'report.pdf'].map(name => `${folder}/nested/${name}`))
    expect(await syncFiles(p)).toBe(false)
  })

  it('removes stale deliverables and old thumbnail entries without replacing existing imported metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentshot-discovery-refresh-'))
    await mkdir(join(dir, 'media'))
    await mkdir(join(dir, 'outputs'))
    await writeFile(join(dir, 'media', 'notes.txt'), 'imported')
    await writeFile(join(dir, 'outputs', 'report.pdf'), 'generated')
    await writeFile(join(dir, 'thumb.jpg'), 'internal')
    const imported = { kind: 'text' as const, summary: 'User metadata' }
    const p = { dir, files: { 'media/notes.txt': imported, 'thumb.jpg': { kind: 'image', summary: 'old entry' } }, media: {} } as Project
    expect(await syncFiles(p)).toBe(true)
    expect(p.files!['media/notes.txt']).toBe(imported)
    expect(p.files!['thumb.jpg']).toBeUndefined()
    await rm(join(dir, 'outputs', 'report.pdf'))
    expect(await syncFiles(p)).toBe(true)
    expect(Object.keys(p.files!)).toEqual(['media/notes.txt'])
    expect(await syncFiles(p)).toBe(false)
  })

  it('discovers generated deliverables and groups nested output folders in Files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentshot-generated-'))
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
