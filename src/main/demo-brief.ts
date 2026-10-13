// Only user-authored choices authorize a first demo layout. Model-supplied defaults are not user decisions.
import { cameraLayout, type CameraCorner, type CameraShape } from '../shared/demo'

type Choices = { corner?: CameraCorner; shape?: CameraShape; width?: number; height?: number; percent?: number; decide?: boolean }
type Brief = { choices: Choices; pending: boolean; cleanup: 'none' | 'natural' | 'tight' }
export type LayoutQuestion = { question: string; options: { label: string; description: string }[] }

export function userLayout(text: string): Choices {
  const s = text.toLowerCase(), c: Choices = {}
  const corner = /\b(top|bottom)[ -]?(right|left)\b/.exec(s)
  if (corner) c.corner = `${corner[1]}-${corner[2]}` as CameraCorner
  if (/rounded[ -]rectangle/.test(s)) c.shape = 'rounded'
  else if (/\b(circle|circular)\b/.test(s)) c.shape = 'circle'
  else if (/\bsquare\b/.test(s)) c.shape = 'square'
  else if (/\b(rectangle|rectangular)\b/.test(s)) c.shape = 'rectangle'
  const dimensions = /\b(\d{2,4})\s*[×x]\s*(\d{2,4})\b/.exec(s), pixels = /\b(\d{2,4})\s*(?:px|pixels)\b/.exec(s), percent = /\b(\d{1,2})\s*%/.exec(s)
  if (dimensions) { c.width = Number(dimensions[1]); c.height = Number(dimensions[2]) }
  else if (pixels) c.width = Number(pixels[1])
  else if (percent) c.percent = Number(percent[1])
  else if (/\bsmall\b/.test(s)) c.percent = 15
  else if (/\bmedium\b/.test(s)) c.percent = 20
  else if (/\blarge\b/.test(s)) c.percent = 25
  if (/you decide|your recommendations|choose for me|use (?:the )?defaults/.test(s)) c.decide = true
  return c
}

export class DemoBriefs {
  private briefs = new Map<string, Brief>()
  input(conversation: string, text: string) {
    const before = this.briefs.get(conversation)
    const s = text.toLowerCase()
    const cleanup = /cleanup:\s*none|keep everything|keep all|no (?:cuts|trimming|cleanup)|do not (?:cut|trim)|don't (?:cut|trim)|sync (?:and compose )?only/.test(s) ? 'none'
      : /cleanup:\s*tight|\btighter\b|\btight\b/.test(s) ? 'tight'
      : /cleanup:\s*natural|\bnatural\b|trim|stale|dead time|remove.*paus/.test(s) ? 'natural'
      : before?.pending ? before.cleanup : 'natural'
    this.briefs.set(conversation, { choices: { ...(before?.pending ? before.choices : {}), ...userLayout(text) }, pending: !!before?.pending, cleanup })
  }
  cleanup(conversation: string) { return this.briefs.get(conversation)?.cleanup || 'natural' }
  completed(conversation: string) { this.briefs.delete(conversation) }
  resolve(conversation: string, width: number, height: number): { questions?: LayoutQuestion[]; layout?: ReturnType<typeof cameraLayout>; corner?: CameraCorner } {
    const b = this.briefs.get(conversation) || { choices: {}, pending: false, cleanup: 'natural' as const }, c = b.choices
    const questions: LayoutQuestion[] = []
    if (!c.decide && !c.corner) questions.push({ question: 'Where should your face appear?', options: [
      { label: 'Top right (recommended)', description: 'Face in the top-right corner; you can drag it anywhere afterward.' },
      ...['Top left', 'Bottom right', 'Bottom left'].map(label => ({ label, description: `Place the face in the ${label.toLowerCase()} corner.` })),
    ] })
    if (!c.decide && !c.shape) questions.push({ question: 'What shape should your face video be?', options: [
      { label: 'Circle (recommended)', description: 'A circular picture-in-picture.' },
      { label: 'Square', description: 'A square face video.' }, { label: 'Rectangle', description: 'A wide rectangular face video.' },
      { label: 'Rounded rectangle', description: 'A rectangle with soft corners.' },
    ] })
    if (!c.decide && !c.width && !c.percent) questions.push({ question: 'How large should your face video be?', options: [
      { label: 'Medium · 20% (recommended)', description: `${Math.round(width * 0.2)} px wide; a balanced starting size.` },
      { label: 'Small · 15%', description: `${Math.round(width * 0.15)} px wide; more room for the screen.` },
      { label: 'Large · 25%', description: `${Math.round(width * 0.25)} px wide; a more prominent face.` },
    ] })
    this.briefs.set(conversation, { ...b, pending: true })
    if (questions.length) return { questions }
    const corner = c.corner || 'top-right'
    return { corner, layout: cameraLayout(width, height, { shape: c.shape || 'circle', width: c.width || width * (c.percent || 20) / 100, height: c.height }, corner) }
  }
}
