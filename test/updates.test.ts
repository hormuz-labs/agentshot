import { describe, expect, it } from 'vitest'
import { updateMode } from '../src/main/update-mode'

describe('who updates Manul', () => {
  it('development builds never update', () => {
    expect(updateMode({ packaged: false, platform: 'darwin', exe: '/x', env: {} })).toEqual({ mode: 'off', why: 'development build' })
  })
  it('macOS (direct download or Homebrew cask, which is marked auto_updates) updates itself', () => {
    expect(updateMode({ packaged: true, platform: 'darwin', exe: '/Applications/Manul.app/Contents/MacOS/Manul', env: {} }).mode).toBe('self')
  })
  it('an AppImage updates itself', () => {
    expect(updateMode({ packaged: true, platform: 'linux', exe: '/tmp/.mount_x/manul', env: { APPIMAGE: '/home/a/Manul.AppImage' } }).mode).toBe('self')
  })
  it('the Windows NSIS installation updates itself', () => {
    expect(updateMode({ packaged: true, platform: 'win32', exe: 'C:\\Users\\Alice\\AppData\\Local\\Programs\\Manul\\Manul.exe', env: {} }).mode).toBe('self')
  })
  it('a .deb install is updated by apt, not by the app', () => {
    expect(updateMode({ packaged: true, platform: 'linux', exe: '/opt/Manul/manul', env: {} })).toEqual({ mode: 'package-manager', why: 'installed with apt: sudo apt upgrade manul' })
  })
  it('MANUL_NO_UPDATE turns it off (managed installs, CI)', () => {
    expect(updateMode({ packaged: true, platform: 'darwin', exe: '/x', env: { MANUL_NO_UPDATE: '1' } }).mode).toBe('off')
  })
})
