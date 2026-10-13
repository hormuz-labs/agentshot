// Files the user attaches to a message travel after its text, one line each ("- media/x.srt — what it is"), so the agent
// reads what each file is and the chat shows them as chips.
export const ATTACHED = '[attached files]'

/** A message with its attached files' lines after the text. */
export const joinAttached = (text: string, lines: string[]) =>
  lines.length ? `${text.trim()}${text.trim() ? '\n\n' : ''}${ATTACHED}\n${lines.map(l => `- ${l}`).join('\n')}` : text

const BLOCK = /(?:^|\n\n)\[attached files\]\n((?:- [^\n]*(?:\n|$))+)$/

/** The text of a message, the files attached to it, and how many more there were than it lists. */
export function splitAttached(message: string): { text: string; files: string[]; more: number } {
  // Main-process routing context is for the agent; it is not user-authored chat text.
  message = message.replace(/\n\n\[editor context\][^\n]*$/, '')
  const m = BLOCK.exec(message)
  if (!m) return { text: message, files: [], more: 0 }
  let more = 0
  const files: string[] = []
  for (const line of m[1].split('\n').filter(Boolean)) {
    const n = /^- …and (\d+) more/.exec(line)
    if (n) more += Number(n[1])
    else files.push(line.slice(2).split(' — ')[0])
  }
  return { text: message.slice(0, m.index), files, more }
}
