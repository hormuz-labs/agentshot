import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

const { files } = vi.hoisted(() => ({ files: new Set<string>() }))
vi.mock('node:fs', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs')>(), existsSync: (path: string) => files.has(path),
}))

vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
const { BSK_BIN, findUserBsk } = await import('../src/main/bsk')
afterAll(() => vi.restoreAllMocks())
afterEach(() => { files.clear(); vi.unstubAllEnvs() })

describe('Windows BSK discovery', () => {
  it('uses bsk.exe for the bundled CLI', () => {
    expect(BSK_BIN).toBe(join(import.meta.dirname, '..', 'resources', 'bin', `win32-${process.arch}`, 'bsk.exe'))
  })

  it('uses native delimiters and a case-insensitive Path, including quoted directories', () => {
    const bin = 'D:\\My Tools\\bsk.exe'
    files.add(bin)
    vi.stubEnv('PATH', undefined)
    vi.stubEnv('Path', 'C:\\Windows;"D:\\My Tools"')
    expect(findUserBsk({ home: 'C:\\Users\\A', bundled: 'C:\\Manul\\bin\\bsk.exe' })).toBe(bin)
  })

  it('never returns a case variant of the bundled directory', () => {
    files.add('c:\\manul\\BIN\\bsk.exe')
    expect(findUserBsk({ home: 'C:\\Users\\A', bundled: 'C:\\Manul\\bin\\bsk.exe', path: 'c:\\manul\\BIN' })).toBeNull()
  })

  it('discovers a per-user .exe but not extensionless Unix binaries', () => {
    files.add('C:\\Users\\A\\.local\\bin\\bsk')
    expect(findUserBsk({ home: 'C:\\Users\\A', bundled: 'C:\\Manul\\bin\\bsk.exe', path: '' })).toBeNull()
    files.add('C:\\Users\\A\\.local\\bin\\bsk.exe')
    expect(findUserBsk({ home: 'C:\\Users\\A', bundled: 'C:\\Manul\\bin\\bsk.exe', path: '' })).toBe('C:\\Users\\A\\.local\\bin\\bsk.exe')
  })
})
