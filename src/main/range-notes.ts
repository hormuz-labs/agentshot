import { rangeNotesSchema, type RangeNote } from '../shared/range-notes'

/** Validate the whole batch before saving anything; submit all notes in one agent turn. */
export async function rangeNotesContent(input: RangeNote[], save: (note: RangeNote) => Promise<{ id: string }>): Promise<string> {
  const notes = rangeNotesSchema.parse(input)
  const lines = []
  for (const note of notes) {
    const saved = await save(note)
    lines.push(`[note ${saved.id} @ ${note.anchor.t0.toFixed(3)}–${note.anchor.t1.toFixed(3)} seconds] ${note.text}`)
  }
  return ['Apply these range-specific instructions together. All timestamps refer to the same film before these edits; account for time shifts caused by cuts.', ...lines].join('\n\n')
}
