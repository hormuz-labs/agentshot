import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { run, spawn } = vi.hoisted(() => ({ run: vi.fn(), spawn: vi.fn() }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const { promisify } = await import('node:util')
  return { ...actual, spawn, execFile: Object.assign(vi.fn(), { [promisify.custom]: run }) }
})

process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), 'manul-tools-'))
const Tools = await import('../src/main/tools')
const mark = (id: string) => { mkdirSync(join(process.env.MANUL_TOOLS!, id), { recursive: true }); writeFileSync(join(process.env.MANUL_TOOLS!, id, '.installed.json'), '{"version":"t"}') }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); run.mockReset(); spawn.mockReset() })
afterAll(() => rmSync(process.env.MANUL_TOOLS!, { recursive: true, force: true }))

describe('on-demand tools', () => {
  beforeEach(async () => { for (const t of ['whisper', 'uv']) await Tools.remove(t).catch(() => {}) })

  it('plans dependencies first', () => {
    expect(Tools.plan('whisper').map(d => d.id)).toEqual(['uv', 'whisper'])
  })

  it('skips what is already installed', () => {
    mark('uv')
    expect(Tools.plan('whisper').map(d => d.id)).toEqual(['whisper'])
    mark('whisper')
    expect(Tools.plan('whisper')).toEqual([])
  })

  it('asks once with the total size, and does nothing when declined', async () => {
    const asked: number[] = []
    await expect(Tools.ensure('whisper', async (_t, _b, size) => { asked.push(size); return false })).rejects.toThrow(/declined/)
    expect(asked).toEqual([370])
    expect(Tools.isInstalled('whisper')).toBe(false)
  })

  it('does not ask when installed', async () => {
    mark('uv'); mark('whisper')
    let asked = false
    await Tools.ensure('whisper', async () => { asked = true; return true })
    expect(asked).toBe(false)
  })

  it('refuses to remove a tool another one needs', async () => {
    mark('uv'); mark('whisper')
    await expect(Tools.remove('uv')).rejects.toThrow(/need/)
  })

  it('lists tools with install state', async () => {
    mark('uv')
    const list = await Tools.listTools()
    expect(list.find(t => t.id === 'uv')).toMatchObject({ installed: true, version: 't' })
    expect(list.find(t => t.id === 'whisper')).toMatchObject({ installed: false, needs: ['uv'] })
  })

  it('counts nested files without du or following symlinked directories', async () => {
    mark('uv')
    const root = join(process.env.MANUL_TOOLS!, 'uv')
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'nested', 'data'), '12345')
    symlinkSync(root, join(root, 'nested', 'cycle'), process.platform === 'win32' ? 'junction' : 'dir')
    expect((await Tools.listTools()).find(t => t.id === 'uv')?.diskBytes).toBe(Buffer.byteLength('{"version":"t"}') + 5)
    expect(run).not.toHaveBeenCalled()
  })

  it('uses Scripts/python.exe for Windows managed environments and bin/python elsewhere', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    expect(Tools.uvBin()).toBe(join(process.env.MANUL_TOOLS!, 'uv', 'uv.exe'))
    expect(Tools.venvPython('whisper')).toBe(join(process.env.MANUL_TOOLS!, 'whisper', 'venv', 'Scripts', 'python.exe'))
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux')
    expect(Tools.venvPython('whisper')).toBe(join(process.env.MANUL_TOOLS!, 'whisper', 'venv', 'bin', 'python'))
  })

  it('pins Windows x64 and arm64 ZIPs to the existing upstream version and hashes', () => {
    expect(Tools.UV_VERSION).toBe('0.12.23')
    expect(Tools.UV_BUILDS['win32-x64']).toEqual({ target: 'x86_64-pc-windows-msvc', sha256: '75d05de6762778c31ee183398de7dd15093fad0ed90b1f236d8205ea5ec00c90' })
    expect(Tools.UV_BUILDS['win32-arm64']).toEqual({ target: 'aarch64-pc-windows-msvc', sha256: '13294e232ececbe709c06b74e6ced06f2a225ea5591476685362f22be56a50d5' })
  })

  it('installs the optional Windows Python engine using uv.exe and Scripts/python.exe', async () => {
    const { EventEmitter } = await import('node:events')
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    spawn.mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
      queueMicrotask(() => child.emit('close', 0))
      return child
    })
    const installer = Tools.plan('whisper').find(t => t.id === 'whisper')!
    await installer.install({ progress: () => {}, done: () => {}, fail: () => {}, id: 'test' })
    const options = expect.objectContaining({ windowsHide: true, env: expect.objectContaining({ UV_NO_CONFIG: '1', PYTHONUNBUFFERED: '1' }) })
    expect(spawn.mock.calls.map(c => c[0])).toEqual([Tools.uvBin(), Tools.uvBin(), Tools.uvBin(), Tools.venvPython('whisper')])
    expect(spawn).toHaveBeenNthCalledWith(1, Tools.uvBin(), ['python', 'install', '3.12'], options)
    expect(spawn).toHaveBeenNthCalledWith(3, Tools.uvBin(), ['pip', 'install', '--python', Tools.venvPython('whisper'), 'faster-whisper==1.2.1', 'av==16.1.0'], options)
    expect(spawn).toHaveBeenNthCalledWith(4, Tools.venvPython('whisper'), [Tools.scriptPath('transcribe.py'), '--download-only', '--model', 'base'], options)
  })

  it('checks the ZIP checksum before .NET literal extraction, including brackets and quotes in profile paths', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.spyOn(process, 'arch', 'get').mockReturnValue('x64')
    const originalRoot = process.env.MANUL_TOOLS!
    process.env.MANUL_TOOLS = mkdtempSync(join(tmpdir(), "manul [profile] tools'quote-"))
    const build = Tools.UV_BUILDS['win32-x64'], hash = build.sha256
    const payload = Buffer.from('test ZIP payload')
    const fetched = vi.fn(async () => new Response(payload))
    vi.stubGlobal('fetch', fetched)
    const j = { progress: () => {}, done: () => {}, fail: () => {}, id: 'test' }
    const installer = Tools.plan('uv')[0]
    const uvDir = join(process.env.MANUL_TOOLS, 'uv')
    mkdirSync(uvDir)
    try {
      await expect(installer.install(j)).rejects.toThrow(/Checksum mismatch/)
      expect(run).not.toHaveBeenCalled()
      build.sha256 = createHash('sha256').update(payload).digest('hex')
      run.mockImplementation(async () => {
        expect(readFileSync(join(uvDir, 'uv.zip'))).toEqual(payload)
        writeFileSync(Tools.uvBin(), 'binary')
        return { stdout: '', stderr: '' }
      })
      expect(await installer.install(j)).toBe(Tools.UV_VERSION)
      expect(fetched).toHaveBeenCalledWith(`https://github.com/astral-sh/uv/releases/download/${Tools.UV_VERSION}/uv-x86_64-pc-windows-msvc.zip`)
      const quote = (s: string) => `'${s.replace(/'/g, "''")}'`
      expect(run).toHaveBeenCalledWith(Tools.windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command',
        `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; ` +
        `[System.IO.Compression.ZipFile]::ExtractToDirectory(${quote(join(uvDir, 'uv.zip'))}, ${quote(uvDir)})`], { windowsHide: true })
      expect(existsSync(join(uvDir, 'uv.zip'))).toBe(false)
      rmSync(Tools.uvBin())
      run.mockResolvedValue({ stdout: '', stderr: '' })
      await expect(installer.install(j)).rejects.toThrow(/expected executable/)
    } finally {
      build.sha256 = hash
      rmSync(process.env.MANUL_TOOLS, { recursive: true, force: true })
      process.env.MANUL_TOOLS = originalRoot
    }
  })

  it('rejects unknown tools', () => expect(() => Tools.plan('nope')).toThrow(/unknown/))
})
