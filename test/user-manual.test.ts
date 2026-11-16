import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { USER_GUIDE } from '../src/main/menu'
import { SHORTCUTS, shown } from '../src/shared/shortcuts'

const root = join(import.meta.dirname, '..')
const manual = join(root, 'docs', 'user-manual.md')

describe('the user guide', () => {
  it('is the file Help → User Guide opens, and the README links to it', () => {
    expect(USER_GUIDE.endsWith('/blob/main/docs/user-manual.md')).toBe(true)
    expect(existsSync(manual)).toBe(true)
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('](docs/user-manual.md)')
  })
  it('links only to images and pages that exist', () => {
    const text = readFileSync(manual, 'utf8')
    for (const [, target] of text.matchAll(/\]\(((?!https?:|mailto:|#)[^)\s]+)\)/g)) {
      expect(existsSync(join(root, 'docs', target.split('#')[0])), target).toBe(true)
    }
  })
  it('names every shortcut the app has, as the app has it', () => {
    const text = readFileSync(manual, 'utf8')
    // projects 2 to 8 may be written as a range ("⌘1 to ⌘9")
    const keys = Object.entries(SHORTCUTS).filter(([id]) => !/^tab\.[2-8]$/.test(id)).map(([, a]) => a)
    const missing = keys.filter(a => !text.includes(shown(a, true)) && !text.includes(shown(a, false)))
    expect(missing).toEqual([])
  })
})
