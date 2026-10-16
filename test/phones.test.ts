import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { app } from 'electron'
import { Phones } from '../src/main/phones'

describe('Phones', () => {
  it('keeps paired phones and the Mac id across launches, keys encrypted on disk and never listed', () => {
    const a = new Phones('Studio Mac')
    a.add({ id: 'd1', name: 'Ana’s iPhone', key: 'secret-key', pairedAt: 1 })
    a.seen('d1')
    const b = new Phones('Studio Mac')
    expect(b.mac.id).toBe(a.mac.id)
    expect(b.get('d1')).toMatchObject({ name: 'Ana’s iPhone', key: 'secret-key' })
    expect(b.list()[0]).not.toHaveProperty('key')
    expect(b.list()[0].lastSeen).toBeGreaterThan(0)
    expect(readFileSync(join(app.getPath('userData'), 'phones.json'), 'utf8')).not.toContain('"secret-key"')
    b.forget('d1')
    expect(new Phones('Studio Mac').get('d1')).toBeUndefined()
  })
})
