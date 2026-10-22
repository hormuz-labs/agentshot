// App updates from GitHub releases (electron-updater): checked at start and every 6 hours, downloaded in the background,
// installed on the next restart (or when the user clicks Restart). apt installs are left to apt.
import { app } from 'electron'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import electronUpdater from 'electron-updater'
import { windowsPowerShell } from './tools'
import { updateMode } from './update-mode'

const run = promisify(execFile)

export type UpdateState = { mode: string; why?: string; status: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'none' | 'error'; version?: string; progress?: number; error?: string }

export type SignatureInfo = {
  status: string
  publisher: string
  subject: string
  issuer: string
  thumbprint: string
  timestamped: boolean
}

async function readAuthenticode(file: string): Promise<SignatureInfo> {
  const escaped = file.replace(/'/g, "''")
  const script = `$s = Get-AuthenticodeSignature -LiteralPath '${escaped}'; [pscustomobject]@{` +
    `status = [string]$s.Status; ` +
    `publisher = if ($s.SignerCertificate) { [string]$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) } else { '' }; ` +
    `subject = if ($s.SignerCertificate) { [string]$s.SignerCertificate.Subject } else { '' }; ` +
    `issuer = if ($s.SignerCertificate) { [string]$s.SignerCertificate.Issuer } else { '' }; ` +
    `thumbprint = if ($s.SignerCertificate) { [string]$s.SignerCertificate.Thumbprint } else { '' }; ` +
    `timestamped = [bool]$s.TimeStamperCertificate` +
    `} | ConvertTo-Json -Compress`
  const { stdout } = await run(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000, windowsHide: true })
  return JSON.parse(stdout.trim()) as SignatureInfo
}

/** Verify a downloaded Windows update against publisherNames (CA-trusted, or self-signed pinned to the installed app's certificate thumbprint). */
export async function verifyWindowsUpdate(
  publisherNames: string[],
  updateFile: string,
  inspect: (file: string) => Promise<SignatureInfo> = readAuthenticode,
  appExe = process.execPath,
): Promise<string | null> {
  try {
    const upd = await inspect(updateFile)
    if (!upd.thumbprint || !upd.publisher) return `Update installer is not signed (${upd.status})`
    if (!upd.timestamped) return 'Update installer signature has no timestamp'
    if (!publisherNames.some(n => n === upd.publisher || n === upd.subject)) {
      return `Publisher mismatch: expected ${publisherNames.join(' | ')}, got ${upd.publisher}`
    }
    if (upd.status === 'Valid') return null
    if (upd.status === 'UnknownError' && upd.subject && upd.subject === upd.issuer) {
      const current = await inspect(appExe)
      if (current.thumbprint && current.thumbprint === upd.thumbprint) return null
      return `Self-signed certificate thumbprint mismatch (${upd.thumbprint})`
    }
    return `Invalid Authenticode signature status: ${upd.status}`
  } catch (e) {
    return `Signature verification failed: ${(e as Error).message || e}`
  }
}

export function startUpdates(onState: (s: UpdateState) => void, beforeInstall: () => Promise<void> = async () => {}) {
  const m = updateMode({ packaged: app.isPackaged, platform: process.platform, exe: process.execPath, env: process.env })
  let state: UpdateState = { mode: m.mode, why: m.why, status: 'idle' }
  const set = (patch: Partial<UpdateState>) => { state = { ...state, ...patch }; onState(state) }
  set({})
  if (m.mode !== 'self') return { state: () => state, check: async () => state, install: () => {} }

  const { autoUpdater } = electronUpdater
  if (process.platform === 'win32' && 'verifyUpdateCodeSignature' in autoUpdater) {
    ;(autoUpdater as unknown as { verifyUpdateCodeSignature: typeof verifyWindowsUpdate }).verifyUpdateCodeSignature = verifyWindowsUpdate
  }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-available', i => set({ status: 'downloading', version: i.version, progress: 0 }))
  autoUpdater.on('update-not-available', () => set({ status: 'none' }))
  autoUpdater.on('download-progress', p => set({ status: 'downloading', progress: p.percent / 100 }))
  autoUpdater.on('update-downloaded', i => set({ status: 'ready', version: i.version }))
  autoUpdater.on('error', e => set({ status: 'error', error: e.message }))
  const check = async () => { await autoUpdater.checkForUpdates().catch(e => set({ status: 'error', error: String(e.message || e) })); return state }
  setTimeout(check, 10_000)
  setInterval(check, 6 * 3600_000).unref?.()
  return { state: () => state, check, install: async () => { await beforeInstall(); autoUpdater.quitAndInstall() } }
}
