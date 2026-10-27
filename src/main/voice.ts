// A voice note from the phone becomes a note: what was said, without the ums and uhs speech recognition keeps (its
// prompt asks for them, for editing by text), the spaces tidied, a capital to start.
export function voiceText(said: string) {
  const t = said
    .replace(/(^|[\s,.])(?:um+|uh+|erm+|hmm+|ah+)(?=[\s,.!?]|$)[,.]?/gi, '$1')
    .replace(/\s+([,.!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}
