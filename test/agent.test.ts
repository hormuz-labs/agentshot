// The real pi-durable harness (no model needed): conversations per project, switching, and surviving a restart.
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codingExtension, editorExtension, startAgent, type Bridge } from '../src/main/agent'
import { Memory } from '../src/main/memory'
import { Skills } from '../src/main/skills'
import { isWithinDir } from '../src/main/paths'

const root = mkdtempSync(join(tmpdir(), 'agentshot-agent-'))
const dir = join(root, 'project')
const bridge = { project: () => undefined } as unknown as Bridge
const deps = () => ({
  dbPath: join(root, 'agent.sqlite'), bridge,
  memory: new Memory(join(root, 'memory')),
  skills: new Skills({ bundled: join(root, 'none'), profiles: join(root, 'profiles') }),
})

describe('native coding tools', () => {
  afterEach(() => vi.unstubAllEnvs())
  it('replaces Bash with PowerShell only on Windows, keeping the coding extension name', () => {
    const windows = codingExtension('win32')
    expect(windows.name).toBe('coding-tools')
    expect(windows.tools?.map(t => t.name)).toEqual(['read', 'write', 'edit', 'powershell'])
    expect(codingExtension('linux').tools?.map(t => t.name)).toEqual(['read', 'write', 'edit', 'bash'])
  })

  it('runs only absolute built-in PowerShell, ignoring cwd decoys and PATH', async () => {
    vi.stubEnv('SystemRoot', 'D:\\Windows')
    vi.stubEnv('PATH', dir)
    mkdirSync(dir, { recursive: true })
    for (const name of ['pwsh.exe', 'powershell.exe']) writeFileSync(join(dir, name), 'project decoy')
    const tool = codingExtension('win32').tools!.find(t => t.name === 'powershell')!
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
    const calls: unknown[] = []
    const api = { env: { cwd: dir, exec: async (...args: unknown[]) => {
      calls.push(args)
      return { ok: true, value: { exitCode: 0 } }
    } }, output: () => {}, diagnostic: () => {} }
    await tool.execute({ command: 'bsk status' } as never, api as never, BACKGROUND_CONTEXT)
    expect(calls).toHaveLength(1)
    expect((calls[0] as unknown[])[0]).toEqual(['D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', expect.stringContaining('bsk status')])
    expect((calls[0] as unknown[])[2]).toBe(BACKGROUND_CONTEXT)
  })

  it('does not fall back to cwd or PATH when built-in PowerShell cannot start', async () => {
    vi.stubEnv('SystemRoot', undefined)
    vi.stubEnv('PATH', dir)
    const tool = codingExtension('win32').tools!.find(t => t.name === 'powershell')!
    const exec = vi.fn(async (_command: string[]) => ({ ok: false, error: { code: 'spawn_error', message: 'missing system executable' } }))
    await expect(tool.execute({ command: 'Get-Location' } as never,
      { env: { cwd: dir, exec }, output: () => {}, diagnostic: () => {} } as never, {} as never)).rejects.toMatchObject({ code: 'spawn_error' })
    expect(exec).toHaveBeenCalledOnce()
    expect(exec.mock.calls[0][0][0]).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  })

  it('rejects a relative SystemRoot rather than resolve it against the project', () => {
    vi.stubEnv('SystemRoot', '.\\decoy')
    expect(() => codingExtension('win32')).toThrow(/absolute Windows drive path/)
  })

  it('gives Windows shell and optional-Python instructions', async () => {
    const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    try {
      const ext = editorExtension({} as never, () => dir)
      const prompt = await ext.sections![0].render({} as never, {} as never)
      expect(prompt).toMatch(/powershell tool, not Bash/)
      expect(prompt).toMatch(/Python is optional/)
    } finally { platform.mockRestore() }
  })

  it('rejects sibling-prefix paths in editor tools', async () => {
    const ext = editorExtension({ project: () => ({ dir }) } as never, () => dir)
    const tool = ext.tools!.find(t => t.name === 'probe')!
    await expect(tool.execute({ path: `${dir}-sibling/film.mp4` }, { conversationId: '1' } as never, {} as never)).rejects.toThrow(/inside the project/)
    await expect(tool.execute({ path: '../film.mp4' }, { conversationId: '1' } as never, {} as never)).rejects.toThrow(/inside the project/)
  })

  it('uses a relative-path boundary that handles Windows drives, casing, separators and siblings', () => {
    expect(isWithinDir('C:\\Project', 'c:\\project\\downloads\\song.mp3', 'win32')).toBe(true)
    expect(isWithinDir('C:\\Project', 'C:/Project/downloads/song.mp3', 'win32')).toBe(true)
    expect(isWithinDir('C:\\Project', 'C:\\Project-other\\song.mp3', 'win32')).toBe(false)
    expect(isWithinDir('C:\\Project', 'D:\\Project\\song.mp3', 'win32')).toBe(false)
    expect(isWithinDir('C:\\Project', 'C:\\Project\\..\\song.mp3', 'win32')).toBe(false)
    expect(isWithinDir('C:\\Project', 'C:\\Project', 'win32')).toBe(false)
  })

  it('passes the third context abortSignal to ffmpeg, not the API object', async () => {
    const ext = editorExtension({ project: () => ({ dir: root }) } as never, () => root)
    const tool = ext.tools!.find(t => t.name === 'ffmpeg')!
    const controller = new AbortController()
    controller.abort()
    await expect(tool.execute({ args: ['-version'] }, { conversationId: '1' } as never, { abortSignal: controller.signal } as never)).rejects.toThrow(/abort/i)
  })
})

describe('conversations', () => {
  it('opens, starts new ones, switches, and keeps them across a restart', async () => {
    const threads: string[] = []
    let agent = await startAgent({ ...deps(), onEvent: (_d, e) => { if ((e as { threadId?: string }).threadId) threads.push((e as { threadId: string }).threadId) } })
    const a = await agent.open(dir)
    const b = await agent.newConversation(dir)
    expect(b).not.toBe(a)
    expect(agent.current(dir)).toBe(b)
    expect(await agent.open(dir, a)).toBe(a)
    expect(agent.current(dir)).toBe(a)
    await agent.shutdown()

    agent = await startAgent({ ...deps(), onEvent: () => {} })
    expect(await agent.open(dir, b)).toBe(b) // the same durable conversation after a restart
    await agent.shutdown()
  })

  it('stores conversations inside <projectDir>/.agent.sqlite when project.json exists so synced folders carry their history', async () => {
    const projDir = join(root, 'portable-project')
    mkdirSync(projDir, { recursive: true })
    writeFileSync(join(projDir, 'project.json'), JSON.stringify({ id: 'p1', title: 'Portable', dir: projDir }))
    const machine1 = await startAgent({ ...deps(), dbPath: join(root, 'machine1-global.sqlite'), onEvent: () => {} })
    const conv1 = await machine1.open(projDir)
    const conv2 = await machine1.newConversation(projDir)
    await machine1.shutdown()
    expect(existsSync(join(projDir, '.agent.sqlite'))).toBe(true)

    // Machine 2 has its own empty global dbPath, yet opening the synced project folder recovers conv1 and conv2
    const machine2 = await startAgent({ ...deps(), dbPath: join(root, 'machine2-global.sqlite'), onEvent: () => {} })
    expect(await machine2.open(projDir, conv1)).toBe(conv1)
    expect(await machine2.open(projDir, conv2)).toBe(conv2)
    await machine2.shutdown()
  })
})

describe('viewers (the phone)', () => {
  it('replay to themselves only, follow conversation switches, and stop when unsubscribed', async () => {
    const main: string[] = []
    const agent = await startAgent({ ...deps(), dbPath: join(root, 'viewers.sqlite'), onEvent: (_d, e) => main.push(e.type) })
    const a: string[] = [], b: string[] = []
    const offA = agent.subscribe(dir, e => a.push(e.type))
    expect(a).toEqual([]) // not open yet

    await agent.open(dir)
    expect(a).toContain('MESSAGES_SNAPSHOT') // replayed once it opened
    const mainAfterOpen = main.length, aAfterOpen = a.length

    const offB = agent.subscribe(dir, e => b.push(e.type))
    expect(b).toContain('MESSAGES_SNAPSHOT') // already open: replayed at once
    expect(a.length).toBe(aAfterOpen) // …to the new viewer only
    expect(main.length).toBe(mainAfterOpen) // and not to the window

    await agent.newConversation(dir)
    expect(a.length).toBeGreaterThan(aAfterOpen) // followed the switch
    const bAfterSwitch = b.length

    offB()
    await agent.newConversation(dir)
    expect(b.length).toBe(bAfterSwitch)
    offA()
    await agent.shutdown()
  })
})
