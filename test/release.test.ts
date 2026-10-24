import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module
import { renderCask } from '../scripts/homebrew-cask.mjs'

describe('Homebrew cask', () => {
  const cask = renderCask({ version: '0.3.0', arm64: 'a'.repeat(64), x64: 'b'.repeat(64) }) as string

  it('points each Mac at its own build, with checksums', () => {
    expect(cask).toContain('version "0.3.0"')
    expect(cask).toMatch(/on_arm do\s+sha256 "a{64}"\s+url "https:\/\/github\.com\/hormuz-labs\/agentshot\/releases\/download\/v#\{version\}\/AgentShot-#\{version\}-arm64\.dmg"/)
    expect(cask).toMatch(/on_intel do\s+sha256 "b{64}"\s+url "[^"]+AgentShot-#\{version\}-x64\.dmg"/)
  })

  it('lets the app update itself and needs macOS 12+', () => {
    expect(cask).toContain('auto_updates true')
    expect(cask).toContain('depends_on macos: :monterey')
    expect(cask).toContain('app "AgentShot.app"')
  })

  it('leaves Gatekeeper on: releases are notarized, so nothing strips the quarantine flag', () => {
    expect(cask).not.toContain('com.apple.quarantine')
    expect(cask).not.toContain('postflight')
  })

  it('cleans up on zap', () => {
    expect(cask).toContain('~/Library/Application Support/AgentShot')
    expect(cask).toMatch(/zap trash:/)
  })

  it('refuses bad input', () => {
    expect(() => renderCask({ version: 'x', arm64: 'a'.repeat(64), x64: 'b'.repeat(64) })).toThrow(/version/)
    expect(() => renderCask({ version: '1.0.0', arm64: 'nope', x64: 'b'.repeat(64) })).toThrow(/sha256/)
  })
})

describe('Linux package', () => {
  it('depends on ALSA, so the app starts on a clean Debian or Ubuntu', async () => {
    const { readFileSync } = await import('node:fs')
    const yml = readFileSync(new URL('../electron-builder.yml', import.meta.url), 'utf8')
    expect(yml).toMatch(/depends: \[[^\]]*"libasound2t64 \| libasound2"/)
    expect(yml).toMatch(/depends: \[[^\]]*libnss3/)
  })
})

describe.each(['README.md', 'RELEASING.md', 'scripts/apt-repo.sh'])('APT install instructions in %s', (file) => {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const command = (file.endsWith('.sh')
    ? source.match(/<pre[^>]*>([\s\S]*?)<\/pre>/)![1].replaceAll('&amp;', '&')
    : source.match(/```bash\n(curl -fsSL https:\/\/apt\.agentshot\.si[\s\S]*?)\n```/)![1])
  // Run the published command without network access, sudo or changes to the host's APT configuration.
  const shell = `
curl() { printf 'public key\\n'; }
sudo() { "$@"; }
gpg() {
  while [ "$1" = --batch ] || [ "$1" = --yes ]; do shift; done
  [ "$*" = '--dearmor -o /usr/share/keyrings/manul.gpg' ] || return 2
  read -r key
  [ "$key" = 'public key' ] || return 2
  printf 'key\\n'
  [ "$FAIL_AT" != key ]
}
tee() {
  [ "$*" = /etc/apt/sources.list.d/manul.list ] || return 2
  read -r source
  [ "$source" = 'deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main' ] || return 2
  printf 'source\\n'
}
apt() { printf '%s\\n' "$*"; [ "$FAIL_AT" != "$1" ]; }
`

  it.each([false, true])('installs when copied with flattened newlines: %s', (flatten) => {
    const result = spawnSync('bash', ['-c', shell + (flatten ? command.replaceAll('\n', ' ') : command)], {
      encoding: 'utf8', env: { ...process.env, FAIL_AT: '' },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('key\nsource\nupdate\ninstall manul\n')
  })

  it.each(['key', 'update'])('stops if %s fails instead of attempting installation', (failAt) => {
    const result = spawnSync('bash', ['-c', shell + command.replaceAll('\n', ' ')], {
      encoding: 'utf8', env: { ...process.env, FAIL_AT: failAt },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stdout).toBe(failAt === 'key' ? 'key\n' : 'key\nsource\nupdate\n')
  })
})
