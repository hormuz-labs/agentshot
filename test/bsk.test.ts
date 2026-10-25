import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { agentEnv, browserPrompt, chromeBsk, BskDaemon, BSK_BIN, daemonArgs, liveEnv, DEFAULT_PORT, environmentPath, extensionStorage, findUserBsk, freePort, privateHome } from '../src/main/bsk'
// @ts-expect-error plain JS module
import { CLI, EXTENSION } from '../scripts/fetch-bsk.mjs'

describe('pinned BrowserSkill', () => {
  it('pins the CLI for every platform AgentShot ships and the extension, by SHA-256', () => {
    for (const t of ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64']) {
      expect(CLI.builds[t].url).toMatch(/^https:\/\/github\.com\/Tencent\/BrowserSkill\/releases\/download\/cli-v/)
      expect(CLI.builds[t].sha256).toMatch(/^[0-9a-f]{64}$/)
    }
    expect(EXTENSION.url).toMatch(/ext-v[\d.]+\/browser-skill-extension-v[\d.]+-chrome\.zip$/)
    expect(EXTENSION.sha256).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is fetched into resources (bin/<target>/bsk and bsk-ext/)', () => {
    expect(existsSync(BSK_BIN)).toBe(true)
    const manifest = JSON.parse(readFileSync(join(BSK_BIN, '../../../bsk-ext/manifest.json'), 'utf8'))
    expect(manifest.name).toBe('BrowserSkill')
  })
})

describe("AgentShot's private bsk", () => {
  it('lives in its own home, never the user\'s ~/.bsk', () => {
    const home = join(tmpdir(), 'home'), userData = join(home, 'AgentShot')
    expect(privateHome(userData, home)).toBe(join(userData, 'bsk'))
  })

  it('moves to a short home when the socket path would be too long for macOS', () => {
    const home = join(tmpdir(), 'home'), long = join(home, 'x'.repeat(110))
    expect(dirname(privateHome(long, home, 'darwin'))).toBe(join(home, '.manul'))
    expect(privateHome(`${long}2`, home, 'darwin')).not.toBe(privateHome(long, home, 'darwin')) // two installs never share a daemon
    for (const platform of ['linux', 'win32'] as const) expect(privateHome(long, home, platform)).toBe(join(long, 'bsk'))
  })

  it('measures macOS socket limits in bytes, not characters', () => {
    const home = join(tmpdir(), 'home')
    const long = join(home, '\u00e9'.repeat(60))
    expect(dirname(privateHome(long, home, 'darwin'))).toBe(join(home, '.manul'))
  })

  it('never uses the default port, so the user\'s Chrome extension cannot find it', async () => {
    expect(() => daemonArgs(DEFAULT_PORT)).toThrow(/default port/)
    const port = await freePort()
    expect(port).not.toBe(DEFAULT_PORT)
    expect(daemonArgs(port)).toEqual(expect.arrayContaining(['daemon', 'start', '--foreground', '--port', String(port)]))
  })

  it('freePort skips a port that is taken', async () => {
    const taken = await freePort()
    const srv = createServer().listen(taken, '127.0.0.1')
    await new Promise(r => srv.once('listening', r))
    try { expect(await freePort([taken])).not.toBe(taken) } finally { srv.close() }
  })

  it("points AgentShot's embedded extension at the private port, labelled AgentShot", () => {
    expect(extensionStorage(53111)).toEqual({ bsk_daemon_port: 53111, bh_label: 'AgentShot', bh_connection_enabled: true })
  })
})

describe('which browser the agent drives', () => {
  const base = { bundledDir: join(tmpdir(), 'app', 'bin'), privateHome: join(tmpdir(), 'ud', 'bsk'), userHome: join(tmpdir(), 'user'), path: join(tmpdir(), 'system', 'bin') }
  const userBsk = join(base.userHome, '.local', 'bin', process.platform === 'win32' ? 'bsk.exe' : 'bsk')

  it("default: AgentShot's own browser — private home, no auto-start, bundled CLI first", () => {
    expect(agentEnv('manul', { ...base, userBsk })).toEqual({ BSK_HOME: base.privateHome, BSK_AUTO_START: '0', PATH: `${base.bundledDir}${delimiter}${base.path}` })
  })

  it("Chrome: the user's own bsk and daemon (their logins)", () => {
    expect(agentEnv('chrome', { ...base, userBsk })).toEqual({ BSK_HOME: join(base.userHome, '.bsk'), BSK_AUTO_START: '1', PATH: `${dirname(userBsk)}${delimiter}${base.path}` })
  })

  it('Chrome without an installed CLI falls back to the bundled one on the user\'s daemon', () => {
    expect(agentEnv('chrome', { ...base, userBsk: null })).toMatchObject({ BSK_HOME: join(base.userHome, '.bsk'), PATH: `${base.bundledDir}${delimiter}${base.path}` })
  })

  it("finds the user's own bsk, never AgentShot's bundled copy", () => {
    const home = mkdtempSync(join(tmpdir(), 'agentshot-home-'))
    mkdirSync(join(home, '.local/bin'), { recursive: true })
    expect(findUserBsk({ home, bundled: BSK_BIN, path: '' })).toBeNull()
    const bin = join(home, '.local', 'bin', process.platform === 'win32' ? 'bsk.exe' : 'bsk')
    writeFileSync(bin, '')
    expect(findUserBsk({ home, bundled: BSK_BIN, path: '' })).toBe(bin)
    expect(findUserBsk({ home: '/nowhere', bundled: BSK_BIN, path: join(BSK_BIN, '..') })).toBeNull()
    rmSync(home, { recursive: true })
  })
})

describe('the private daemon (real bundled bsk)', () => {
  const home = mkdtempSync(join(tmpdir(), 'mbsk-'))
  const d = new BskDaemon({ bin: BSK_BIN, home })
  afterAll(async () => { await d.stop(); rmSync(home, { recursive: true, force: true }) })

  it('starts on its own port in its own home and answers its own CLI', async () => {
    const { port } = await d.start()
    expect(port).not.toBe(DEFAULT_PORT)
    const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'))
    expect(info.ws_port).toBe(port)
    expect(await d.cli(['browsers', '--json'])).toEqual([]) // nothing connected yet — in particular not the user's Chrome
  })

  it('comes back by itself if it dies, and only counts as running once it answers', async () => {
    for (let i = 0; i < 3; i++) { // the window between relaunch and ready is small; poll tightly, several times
      const before = d.pid
      process.kill(before!, 'SIGKILL')
      await expect.poll(() => d.pid && d.pid !== before && d.running, { timeout: 15_000, interval: 5 }).toBeTruthy()
      expect(await d.cli(['browsers', '--json'])).toEqual([]) // the moment it says running, it answers
    }
  })

  it('stops cleanly', async () => {
    const pid = d.pid!
    await d.stop()
    expect(() => process.kill(pid, 0)).toThrow()
  })
})

describe('agent instructions and live environment', () => {
  it("AgentShot mode: AgentShot's own browser, never --browser, never touch the daemon", () => {
    const p = browserPrompt('manul')
    expect(p).toMatch(/AgentShot's own browser/)
    expect(p).toMatch(/never.*--browser/i)
    expect(p).toMatch(/BSK_HOME/)
    expect(p).toMatch(/import_media/)
  })

  it("Chrome mode: the user's real Chrome, pick the browser, ask when unsure", () => {
    const p = browserPrompt('chrome')
    expect(p).toMatch(/user's own Chrome/)
    expect(p).toMatch(/bsk browsers/)
    expect(p).toMatch(/ask_user/)
  })

  it('the shell environment follows the setting as it changes', () => {
    let mode: 'manul' | 'chrome' = 'manul'
    const env = liveEnv(() => agentEnv(mode, { bundledDir: '/b', privateHome: '/p', userHome: '/u', userBsk: null, path: '/usr/bin' }))
    expect({ ...env }.BSK_HOME).toBe('/p')
    mode = 'chrome'
    expect({ ...env }.BSK_HOME).toBe(join('/u', '.bsk'))
    expect(Object.keys(env)).toEqual(expect.arrayContaining(['BSK_AUTO_START', 'BSK_HOME', 'PATH']))
  })
})

describe("the agent's shell", () => {
  it('runs bsk commands with the environment of the current setting', async () => {
    const { NodeExecutionEnv } = await import('@earendil-works/pi-durable/env/node')
    const { BACKGROUND_CONTEXT } = await import('@earendil-works/chord/context')
    let mode: 'manul' | 'chrome' = 'manul'
    const shellEnv = liveEnv(() => agentEnv(mode, { bundledDir: join(BSK_BIN, '..'), privateHome: '/p', userHome: '/u', userBsk: null, path: process.env.PATH || '' }))
    const env = new NodeExecutionEnv({ cwd: tmpdir(), shellEnv })
    const run = async () => {
      let out = ''
      const command = process.platform === 'win32' ? ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', 'Write-Output "$env:BSK_HOME|$env:BSK_AUTO_START|$((Get-Command bsk.exe).Source)"'] : 'echo "$BSK_HOME|$BSK_AUTO_START|$(command -v bsk)"'
      const result = await env.exec(command, { onOutput: (t: string) => { out += t } }, BACKGROUND_CONTEXT)
      expect(result.ok).toBe(true)
      return out.trim()
    }
    expect(await run()).toBe(`/p|0|${BSK_BIN}`)
    mode = 'chrome'
    expect(await run()).toBe(`${join('/u', '.bsk')}|1|${BSK_BIN}`)
  })
})

describe('browserExtension', () => {
  it('import_media brings a downloaded file into the project, and only from inside it', async () => {
    const { browserExtension } = await import('../src/main/agent')
    const dir = mkdtempSync(join(tmpdir(), 'agentshot-proj-'))
    mkdirSync(join(dir, 'downloads'))
    writeFileSync(join(dir, 'downloads', 'song.mp3'), 'x')
    const got: string[] = []
    const bridge = { project: () => ({ dir }), importFiles: async (_d: string, abs: string) => { got.push(abs); return ['media/song.mp3 — audio, 3:12'] } }
    const ext = browserExtension(bridge as never, () => dir, () => 'Browser: test') as unknown as { tools: { name: string; execute: (a: object, api: object) => Promise<{ content: { text: string }[] }> }[] }
    const tool = ext.tools.find(t => t.name === 'import_media')!
    const out = await tool.execute({ path: 'downloads/song.mp3' }, { conversationId: '1' })
    expect(out.content[0].text).toContain('media/song.mp3')
    expect(got).toEqual([join(dir, 'downloads', 'song.mp3')])
    await expect(tool.execute({ path: '/etc/hosts' }, { conversationId: '1' })).rejects.toThrow(/inside the project/)
    await expect(tool.execute({ path: `${dir}-sibling/song.mp3` }, { conversationId: '1' })).rejects.toThrow(/inside the project/)
    await expect(tool.execute({ path: '../song.mp3' }, { conversationId: '1' })).rejects.toThrow(/inside the project/)
    await expect(tool.execute({ path: dir }, { conversationId: '1' })).rejects.toThrow(/inside the project/)
    await expect(tool.execute({ path: 'downloads/none.mp3' }, { conversationId: '1' })).rejects.toThrow(/No file/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe("the user's own Chrome bsk (Settings → Browser)", () => {
  it('reports no daemon without starting one', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mhome-'))
    const s = await chromeBsk({ userHome: home, bundled: BSK_BIN, path: '' })
    expect(s).toEqual({ cli: null, daemon: false, browsers: [] })
    expect(existsSync(join(home, '.bsk', 'daemon.json'))).toBe(false)
    rmSync(home, { recursive: true, force: true })
  })
})

describe('Windows browser environment', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('reads PATH case-insensitively and prefixes with the native delimiter', () => {
    expect(environmentPath({ Path: 'C:\\Windows' }, 'win32')).toBe('C:\\Windows')
    expect(agentEnv('chrome', { bundledDir: 'C:\\AgentShot\\bin', privateHome: 'C:\\data\\bsk', userHome: 'C:\\Users\\A',
      userBsk: 'D:\\My Tools\\bsk.exe', path: 'C:\\Windows;C:\\Other' }, 'win32')).toEqual({
      BSK_HOME: 'C:\\Users\\A\\.bsk', BSK_AUTO_START: '1', PATH: 'D:\\My Tools;C:\\Windows;C:\\Other',
    })
  })

  it('overrides every inherited PATH spelling when Node merges environments', () => {
    const inherited = { Path: 'old', PaTh: 'old' }
    let path = 'C:\\AgentShot;C:\\Windows'
    const env = liveEnv(() => ({ PATH: path }), 'win32', inherited)
    expect({ ...inherited, ...env }).toMatchObject({ PATH: path, Path: path, PaTh: path })
    path = 'D:\\User;C:\\Windows'
    expect({ ...env }.Path).toBe(path)
  })

  it('tells the agent to translate browser skill examples without installing Bash', () => {
    expect(browserPrompt('manul', 'win32')).toMatch(/powershell tool/)
    expect(browserPrompt('chrome', 'win32')).toMatch(/no Git Bash/)
  })
})

describe('daemon startup failure', () => {
  it('rejects a spawn error promptly and can be stopped after failed startup', async () => {
    const home = mkdtempSync(join(tmpdir(), 'mbsk-missing-'))
    const d = new BskDaemon({ bin: join(home, 'missing.exe'), home })
    const start = Date.now()
    try {
      await expect(d.start()).rejects.toThrow(/ENOENT/)
      expect(Date.now() - start).toBeLessThan(2000)
      expect(d.running).toBe(false)
      await d.stop()
    } finally { rmSync(home, { recursive: true, force: true }) }
  })
})
