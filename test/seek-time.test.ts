import { expect, it } from 'vitest'
import { parseSeekTime } from '../src/renderer/src/lib/seekTime'
import { timecode } from '../src/renderer/src/lib/utils'

it('reads the times a person types to go somewhere exact', () => {
  expect(parseSeekTime('20')).toBe(20)
  expect(parseSeekTime(' 20.5 ')).toBe(20.5)
  expect(parseSeekTime('0:20')).toBe(20)
  expect(parseSeekTime('1:20')).toBe(80)
  expect(parseSeekTime('1:02:03.5')).toBe(3723.5)
  expect(parseSeekTime('180:00')).toBe(10800)
  expect(parseSeekTime('1h2m3s')).toBe(3723)
  expect(parseSeekTime('1h 30m')).toBe(5400)
  expect(parseSeekTime('90s')).toBe(90)
  expect(parseSeekTime('2M')).toBe(120)
})

it('refuses what is not a time', () => {
  for (const bad of ['', ' ', 'abc', '1:60', '1:2:3:4', '-5', '1:', ':20', 'h', '3s2m', '1.2.3'])
    expect(parseSeekTime(bad), bad).toBeNull()
})

it('shows hours on long films and never reads 0:60', () => {
  expect(timecode(0)).toBe('0:00.0')
  expect(timecode(20)).toBe('0:20.0')
  expect(timecode(59.96)).toBe('1:00.0')
  expect(timecode(59.96, false)).toBe('0:59')
  expect(timecode(3599.97)).toBe('1:00:00.0')
  expect(timecode(10800)).toBe('3:00:00.0')
  expect(timecode(3723.5, false)).toBe('1:02:03')
  expect(timecode(NaN)).toBe('0:00.0')
  // what it shows, typed back, goes to the same moment
  for (const t of [20, 83.4, 3723.5, 10799.9]) expect(parseSeekTime(timecode(t))).toBeCloseTo(t, 5)
})
