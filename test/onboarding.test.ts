import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { OnboardingStore } from '../src/main/onboarding'

const dirs: string[] = []
afterEach(() => { dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })) })
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'manul-onboarding-'))
  dirs.push(dir)
  return join(dir, 'onboarding.sqlite')
}

describe('Settings first-open database', () => {
  it('records the first open once and preserves the timestamp across store instances', () => {
    const file = setup()
    const first = new OnboardingStore(file).opened()
    expect(first.firstOpen).toBe(true)
    expect(first.state.tourStatus).toBe('pending')
    expect(first.state.firstOpenedAt).toBeGreaterThan(0)
    expect(new OnboardingStore(file).opened()).toEqual({ firstOpen: false, state: first.state })
    const db = new DatabaseSync(file)
    try { expect(db.prepare('SELECT COUNT(*) AS count FROM settings_onboarding').get()?.count).toBe(1) }
    finally { db.close() }
  })

  it.each(['completed', 'skipped'] as const)('persists %s so Settings does not repeat its tour', status => {
    const file = setup()
    const store = new OnboardingStore(file)
    const first = store.opened()
    store.finish(status)
    expect(new OnboardingStore(file).opened()).toEqual({ firstOpen: false, state: { ...first.state, tourStatus: status } })
  })
})
