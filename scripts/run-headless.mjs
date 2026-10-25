// Runs a command on a virtual display (xvfb-run) on Linux when one is installed, so a long end-to-end run doesn't put
// app windows on the developer's screen, where closing one ends the run. Elsewhere, or without xvfb, runs it as is.
import { spawnSync } from 'node:child_process'

const [cmd, ...args] = process.argv.slice(2)
const headless = process.platform === 'linux' && !process.env.CI && spawnSync('which', ['xvfb-run']).status === 0
const run = headless ? spawnSync('xvfb-run', ['-a', cmd, ...args], { stdio: 'inherit' }) : spawnSync(cmd, args, { stdio: 'inherit' })
process.exit(run.status ?? 1)
