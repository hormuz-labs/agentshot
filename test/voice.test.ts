import { describe, expect, it } from 'vitest'
import { voiceText } from '../src/main/voice'

describe('a voice note, as a note', () => {
  it('keeps what was said, without the ums and uhs, tidied', () => {
    expect(voiceText(' um, tighten the opening uh and bring the title in earlier. ')).toBe('Tighten the opening and bring the title in earlier.')
    expect(voiceText('Hmm, cut the uhh second shot, um')).toBe('Cut the second shot,')
    expect(voiceText('make the music umbrella-quiet')).toBe('Make the music umbrella-quiet')
    expect(voiceText('')).toBe('')
  })

  it('hears nothing in what Whisper writes for no speech', () => {
    for (const none of [' You', 'you.', 'Thank you.', ' Thanks for watching!', '[BLANK_AUDIO]', '(music)', '♪ ♪', '[Music] you', 'Subtitles by the Amara.org community'])
      expect(voiceText(none), none).toBe('')
  })

  it('keeps real notes that contain those words', () => {
    expect(voiceText('Thank you, now cut the intro.')).toBe('Thank you, now cut the intro.')
    expect(voiceText('[BLANK_AUDIO] make it louder')).toBe('Make it louder')
    expect(voiceText('you can drop the second take')).toBe('You can drop the second take')
  })
})
