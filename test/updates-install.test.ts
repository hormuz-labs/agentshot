import { afterEach, expect, it, vi } from 'vitest'

const updater = vi.hoisted(() => ({ on: vi.fn(), checkForUpdates: vi.fn().mockResolvedValue(null), quitAndInstall: vi.fn(), autoDownload: false, autoInstallOnAppQuit: false }))
vi.mock('electron', () => ({ app: { isPackaged: true } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: updater } }))
vi.mock('../src/main/update-mode', () => ({ updateMode: () => ({ mode: 'self' }) }))
import { startUpdates, verifyWindowsUpdate, type SignatureInfo } from '../src/main/updates'

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })
it('waits for bounded app cleanup before handing control to the update installer', async () => {
  vi.useFakeTimers()
  let cleaned!: () => void
  const cleanup = new Promise<void>(resolve => { cleaned = resolve })
  const updates = startUpdates(() => {}, () => cleanup)
  const installing = updates.install()
  expect(updater.quitAndInstall).not.toHaveBeenCalled()
  cleaned()
  await installing
  expect(updater.quitAndInstall).toHaveBeenCalledOnce()
})

it('accepts CA-valid or thumbprint-pinned self-signed Windows updates and rejects tampered or foreign signatures', async () => {
  const base: SignatureInfo = { status: 'Valid', publisher: 'Hormuz Labs', subject: 'CN=Hormuz Labs', issuer: 'CN=DigiCert', thumbprint: 'AABB', timestamped: true }
  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async () => base, 'app.exe')).toBeNull()

  const selfSigned: SignatureInfo = { status: 'UnknownError', publisher: 'Hormuz Labs', subject: 'CN=Hormuz Labs', issuer: 'CN=Hormuz Labs', thumbprint: '97BEF8', timestamped: true }
  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async () => selfSigned, 'app.exe')).toBeNull()

  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async f => f === 'app.exe' ? selfSigned : { ...selfSigned, thumbprint: 'OTHER' }, 'app.exe')).toMatch(/thumbprint mismatch/)
  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async () => ({ ...selfSigned, status: 'HashMismatch' }), 'app.exe')).toMatch(/HashMismatch/)
  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async () => ({ ...base, publisher: 'Someone Else', subject: 'CN=Someone Else' }), 'app.exe')).toMatch(/Publisher mismatch/)
  expect(await verifyWindowsUpdate(['Hormuz Labs'], 'update.exe', async () => ({ ...base, timestamped: false }), 'app.exe')).toMatch(/no timestamp/)
})
