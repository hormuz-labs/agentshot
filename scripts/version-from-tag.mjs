import { spawnSync } from 'node:child_process'

const tag = process.env.TAG || process.env.GITHUB_REF_NAME
if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag || '')) throw new Error(`Invalid release tag: ${tag}`)
// npm's JS entry point works on Windows without spawning npm.cmd through a shell.
const result = spawnSync(process.execPath, [process.env.npm_execpath, 'version', '--no-git-tag-version', '--allow-same-version', tag.slice(1)], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
