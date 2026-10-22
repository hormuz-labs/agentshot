// The agent's bsk wrappers (bskScript), run against a fake bsk: the user's Interrupt holds until they reply, a command
// bsk turned away as busy is sent again, and a running command leaves a mark for a take filming through bsk.
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bskScript, HALTED } from '../src/main/bsk'

let dir: string
const setup = (fake: string) => {
  dir = mkdtempSync(join(tmpdir(), 'manul-wrap-'))
  writeFileSync(join(dir, 'fake-bsk'), `#!/bin/sh\n${fake}\n`); chmodSync(join(dir, 'fake-bsk'), 0o755)
  writeFileSync(join(dir, 'bsk'), bskScript({ name: 'bsk', stateDir: join(dir, 'state') })); chmodSync(join(dir, 'bsk'), 0o755)
  writeFileSync(join(dir, 'chrome-bsk'), bskScript({ name: 'chrome-bsk', bin: join(dir, 'fake-bsk'), bskHome: join(dir, 'home'), stateDir: join(dir, 'state') })); chmodSync(join(dir, 'chrome-bsk'), 0o755)
}
const run = (cmd: string, ...args: string[]) => {
  try { return { code: 0, out: execFileSync(join(dir, cmd), args, { encoding: 'utf8', env: { ...process.env, MANUL_BSK_BIN: join(dir, 'fake-bsk') }, stdio: ['ignore', 'pipe', 'pipe'] }), err: '' } }
  catch (e) { const x = e as { status: number; stdout: string; stderr: string }; return { code: x.status, out: x.stdout, err: x.stderr } }
}
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe.skipIf(process.platform === 'win32')('the agent\'s bsk wrappers', () => {
  it('run bsk with the user\'s own bsk home for chrome-bsk, and the setting\'s bsk for bsk', () => {
    setup('echo "home=$BSK_HOME args=$*"')
    expect(run('chrome-bsk', 'observe', '--session', 'a').out).toBe(`home=${join(dir, 'home')} args=observe --session a\n`)
    expect(run('bsk', 'browsers').out).toMatch(/args=browsers/)
  })

  it('hold the user\'s Interrupt: every later command but session stop is refused until they reply', () => {
    setup(`case "$1" in observe) echo "error: operation interrupted by user" >&2; exit 1;; *) echo ok;; esac`)
    const first = run('chrome-bsk', 'observe', '--session', 'a')
    expect(first.code).toBe(1)
    expect(first.err).toContain(HALTED)
    for (const cli of ['chrome-bsk', 'bsk']) {
      const next = run(cli, 'navigate', 'https://example.com', '--session', 'a')
      expect(next.code).toBe(5)
      expect(next.err).toContain('Do not use the browser again until they reply')
    }
    expect(run('bsk', 'session', 'start', '--json').code).toBe(5) // no starting over in another window
    expect(run('chrome-bsk', 'session', 'stop', 'a').out).toBe('ok\n')
    rmSync(join(dir, 'state', 'halted')) // what Manul does when the user sends a message
    expect(run('chrome-bsk', 'navigate', 'https://example.com', '--session', 'a').out).toBe('ok\n')
  })

  it('send again a command bsk turned away as busy (it was never sent)', () => {
    setup(`n=$(cat "$0.n" 2>/dev/null || echo 0); echo $((n + 1)) > "$0.n"
if [ "$n" -lt 2 ]; then echo '{"code":"timeout","reason":"session_busy"}'; exit 4; fi; echo "clicked after $n busy"`)
    expect(run('chrome-bsk', 'click', '@e1', '--session', 'a')).toMatchObject({ code: 0, out: 'clicked after 2 busy\n' })
  })

  it('leave a mark while a command runs, for a take filming through bsk', async () => {
    setup('sleep 1; echo done')
    const p = spawn(join(dir, 'chrome-bsk'), ['wait-ms', '900', '--session', 'a'])
    const marks = () => existsSync(join(dir, 'state', 'yield')) ? readdirSync(join(dir, 'state', 'yield')).length : 0
    for (let i = 0; i < 40 && !marks(); i++) await new Promise(r => setTimeout(r, 25))
    expect(marks()).toBe(1)
    await new Promise(r => p.once('exit', r))
    expect(readdirSync(join(dir, 'state', 'yield'))).toHaveLength(0)
    expect(existsSync(join(dir, 'state', 'halted'))).toBe(false)
  })
})
