// Who updates this copy of AgentShot: the app itself (macOS .dmg/.zip and Homebrew cask, Linux AppImage), the package manager
// (apt for the .deb), or nobody (development, or turned off).
export type UpdateMode = { mode: 'self' | 'package-manager' | 'off'; why?: string }

export function updateMode(o: { packaged: boolean; platform: string; exe: string; env: Record<string, string | undefined> }): UpdateMode {
  if (!o.packaged) return { mode: 'off', why: 'development build' }
  if (o.env.MANUL_NO_UPDATE) return { mode: 'off', why: 'turned off with MANUL_NO_UPDATE' }
  if (o.platform === 'darwin') return { mode: 'self' }
  if (o.platform === 'linux') return o.env.APPIMAGE ? { mode: 'self' } : { mode: 'package-manager', why: 'installed with apt: sudo apt upgrade manul' }
  return { mode: 'self' }
}
