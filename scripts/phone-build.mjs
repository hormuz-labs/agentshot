// Builds the phone app with the release's version, as GitHub and Google Play know it: the name from the tag
// (v0.4.29 → 0.4.29, on the splash and in Settings) and the version code derived from it as play.yml does
// (0.4.29 → 4029). The tag is TAG, else the one on this commit, else the newest; the kind is apk (default) or
// appbundle: `npm run phone:build -- appbundle`.
import { execFileSync, spawnSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const tags = (...args) => git('tag', '-l', 'v[0-9]*.[0-9]*.[0-9]*', '--sort=-v:refname', ...args).split('\n').filter(Boolean)
const tag = process.env.TAG || tags('--points-at', 'HEAD')[0] || tags()[0]
const m = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag || '')
if (!m) throw new Error(`No release tag to take the version from (got ${tag}); fetch the tags or set TAG=v1.2.3`)
const [major, minor, patch] = m.slice(1).map(Number)
const name = `${major}.${minor}.${patch}`, code = major * 1000000 + minor * 1000 + patch
const kind = process.argv[2] || 'apk'

console.log(`Building the phone ${kind} as ${name} (${code})`)
const flutter = spawnSync('flutter', ['build', kind, '--release', '--build-name', name, '--build-number', String(code)], { cwd: join(root, 'mobile'), stdio: 'inherit', shell: process.platform === 'win32' })
process.exit(flutter.status ?? 1)
