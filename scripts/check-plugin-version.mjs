// Fails when plugin/ changed since [base] but its version didn't go up. Claude Code caches an installed plugin by its
// version, so a change shipped under the same version never reaches anyone who has it (code.claude.com/docs/en/plugins).
//
//   node scripts/check-plugin-version.mjs <base ref>      e.g. origin/main
//
// Only plugin/README.md may change without a new version: it isn't part of what the plugin does.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const MANIFEST = 'plugin/.claude-plugin/plugin.json'
const UNVERSIONED = new Set(['plugin/README.md'])
const SEMVER = /^\d+\.\d+\.\d+$/

/** Negative, zero or positive as [a] is below, equal to or above [b] (both major.minor.patch). */
export function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

/** What's wrong, or null. [changed]: paths changed since the base; [base]/[head]: the plugin's version there (base is
 *  undefined when the plugin is new on this branch). */
export function checkPluginVersion({ changed, base, head }) {
  if (!head) return `${MANIFEST} needs a "version".`
  if (!SEMVER.test(head)) return `The plugin's version "${head}" must be major.minor.patch, like 0.1.0.`
  const shipped = changed.filter(f => f.startsWith('plugin/') && !UNVERSIONED.has(f))
  if (!shipped.length || base === undefined) return null
  if (SEMVER.test(base) && compareVersions(head, base) > 0) return null
  return `The plugin changed (${shipped.join(', ')}), so raise "version" in ${MANIFEST} above ${base}: ` +
    'installed copies are cached by version, and people only get the change when it goes up.'
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const versionIn = text => { try { return JSON.parse(text).version } catch { return undefined } }

function main(base) {
  if (!base) { console.error('usage: node scripts/check-plugin-version.mjs <base ref>'); return 2 }
  const changed = git('diff', '--name-only', `${base}...HEAD`, '--', 'plugin').split('\n').filter(Boolean)
  let before
  try { before = versionIn(git('show', `${base}:${MANIFEST}`)) } catch { before = undefined } // not in the base yet
  const problem = checkPluginVersion({ changed, base: before, head: versionIn(readFileSync(MANIFEST, 'utf8')) })
  if (problem) { console.error(problem); return 1 }
  console.log(changed.length ? `Plugin changed and its version went up from ${before ?? 'nothing'}: fine.` : 'The plugin didn’t change.')
  return 0
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv[2])
