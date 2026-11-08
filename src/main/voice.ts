// A voice note from the phone becomes a note: what was said, without the ums and uhs speech recognition keeps (its
// prompt asks for them, for editing by text), the spaces tidied, a capital to start.
//
// Whisper, given no speech (a tone, a hum, a breath), still writes something: a sound tag like [BLANK_AUDIO] or
// (music), or a stock line from the subtitles it learnt from ("you", "thank you", "thanks for watching"). Tags go
// wherever they are; a note that is only a stock line was nothing heard, so the person is told that instead of
// finding "You" in their message box.
const TAG = /\[[^\]]*\]|\((?:music|applause|laughter|silence|inaudible|blank_audio|no speech|noise|sighs?|breathing)[^)]*\)|[♪♫]+/gi
const STOCK = new Set(['you', 'thank you', 'thank you very much', 'thanks', 'thanks for watching', 'thank you for watching',
  'bye', 'bye bye', 'okay', 'subtitles by the amara.org community', 'please subscribe', 'so'])

export function voiceText(said: string) {
  const t = said
    .replace(TAG, ' ')
    .replace(/(^|[\s,.])(?:um+|uh+|erm+|hmm+|ah+)(?=[\s,.!?]|$)[,.]?/gi, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (STOCK.has(t.toLowerCase().replace(/[.,!?…\s]+$/g, '').replace(/^[.,!?…\s]+/, ''))) return ''
  return t.charAt(0).toUpperCase() + t.slice(1)
}
