import { describe, expect, it } from 'vitest'
import * as cloud from '../src/shared/cloud-tools'

describe('cloud tools', () => {
  it('names only where the worker is: what it offers is asked of the worker, never listed ahead of it', () => {
    expect(cloud.WORKER_URL).toMatch(/^https:\/\//)
    expect(Object.keys(cloud)).toEqual(['WORKER_URL'])
  })
})
