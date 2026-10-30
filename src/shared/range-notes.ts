import { z } from 'zod'

/** Each instruction belongs to its own range on the film shown when selected. */
export const rangeNoteSchema = z.object({
  anchor: z.object({ t0: z.number().finite().min(0).max(86400), t1: z.number().finite().min(0).max(86400) }).strict()
    .refine(a => a.t1 > a.t0, 'End must be after start'),
  text: z.string().trim().min(1).max(100_000),
}).strict()
export const rangeNotesSchema = z.array(rangeNoteSchema).max(100)
export type RangeNote = z.infer<typeof rangeNoteSchema>

/** Explicit seconds, with the instruction following the colon on the same line. */
export function appendRange(text: string, t0: number, t1: number): string {
  return `${text.trimEnd()}${text.trim() ? '\n' : ''}From ${t0.toFixed(3)}s to ${t1.toFixed(3)}s: `
}

/** Also recognize drafts written with the earlier start:end notation. */
export const rangeMarkers = (text: string) => [...text.matchAll(/^(?:(?:Note · )?From (\d+(?:\.\d+)?)s to (\d+(?:\.\d+)?)s:|(\d+(?:\.\d+)?):(\d+(?:\.\d+)?))(?=\s|$)/gm)]

export function parseRangeNotes(text: string): RangeNote[] {
  const markers = rangeMarkers(text)
  return markers.map((m, i) => ({
    anchor: { t0: Number(m[1] ?? m[3]), t1: Number(m[2] ?? m[4]) },
    text: text.slice(m.index! + m[0].length, markers[i + 1]?.index ?? text.length).trim(),
  }))
}

/** Opens a message of several notes given together (the phone's batch), for the agent and for showing it back. */
export const NOTES_TOGETHER = 'These notes go together: make all of them, then one new cut.'
