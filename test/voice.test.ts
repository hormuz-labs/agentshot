import { describe, expect, it } from 'vitest'
import { voiceText } from '../src/main/voice'

describe('a voice note, as a note', () => {
  it('keeps what was said, without the ums and uhs, tidied', () => {
    expect(voiceText(' um, tighten the opening uh and bring the title in earlier. ')).toBe('Tighten the opening and bring the title in earlier.')
    expect(voiceText('Hmm, cut the uhh second shot, um')).toBe('Cut the second shot,')
    expect(voiceText('make the music umbrella-quiet')).toBe('Make the music umbrella-quiet')
    expect(voiceText('')).toBe('')
  })
})
