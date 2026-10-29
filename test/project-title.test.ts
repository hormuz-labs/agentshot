import { describe, expect, it } from 'vitest'
import { machineMade, titleFromFile } from '../src/shared/project-title'

describe('project titles from file names', () => {
  const day = new Date(2026, 9, 30, 14, 0).getTime()
  it('names a project after the day when a device named the file', () => {
    for (const name of ['5959', '160', '1000012345', 'VID_20261030_142233', 'IMG_4412', 'PXL_20261030_142233123', 'PXL_20261030_142233123.TS', 'GOPR0042', 'DJI_0001', 'Screen_Recording_20261030_142233', 'screenrecording 3', 'trim.3F2A', '3f2a9c1e-7b4d-4a8e-9b1c-2d3e4f5a6b7c']) {
      expect(machineMade(name), name).toBe(true)
      expect(titleFromFile(name, day), name).toBe('Video from 30 Oct')
    }
    expect(titleFromFile('', day)).toBe('Video from 30 Oct')
  })
  it('keeps a name a person gave', () => {
    for (const name of ['Harbour walk', 'Surf session', 'trip 2024', 'IMG and friends', 'interview take 2', '2024 recap', 'vlog']) {
      expect(machineMade(name), name).toBe(false)
      expect(titleFromFile(name, day)).toBe(name)
    }
  })
})
