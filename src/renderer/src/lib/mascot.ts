import type { AgentState } from './agui'

export type MascotState = 'idle' | 'thinking' | 'working' | 'speaking' | 'waiting' | 'success' | 'error' | 'sleeping'
export type MascotActivity = { state: MascotState; label: string; detail: string }

const jobs: Record<string, string> = {
  ffmpeg: 'Rendering your edit', rerender_timeline: 'Rendering your film', render_clip: 'Rendering a motion clip',
  create_clip: 'Making a motion clip', propose_version: 'Preparing your before / after',
  analyze_video: 'Watching your footage', look: 'Looking at the frames', find_subjects: 'Finding the subjects',
  speakers: 'Listening for the speakers', transcript: 'Reading the transcript', analyze_music: 'Finding the beat',
  bash: 'Working on your edit', read: 'Reading a project file', write: 'Making something for your film',
  edit: 'Refining the edit', probe: 'Getting to know your footage', project_state: 'Looking at your project',
}

/** Use execution IDs, not old tool cards, so a finished tool never keeps the mascot busy. */
export function mascotActivity(agent: AgentState, needsConsent = false): MascotActivity {
  if (agent.error) return { state: 'error', label: 'Something needs attention', detail: 'Your work is safe. Check the message above.' }
  if (!agent.busy) return { state: 'idle', label: 'Ready when you are', detail: 'Your little editing companion.' }
  const running = new Set(agent.running)
  const calls = agent.messages.flatMap(m => m.role === 'assistant' ? m.toolCalls || [] : [])
  const active = calls.filter(c => running.has(c.id))
  const pending = Object.values(agent.pending)
  if (needsConsent || active.some(c => c.function.name === 'ask_user')) {
    return { state: 'waiting', label: 'Over to you', detail: 'Manul is waiting for your answer.' }
  }
  if (active.length || running.size) {
    const name = active.at(-1)?.function.name || ''
    return { state: 'working', label: jobs[name] || 'Working on your edit', detail: 'A little focus. A lot of fluff.' }
  }
  if (agent.streaming?.text) return { state: 'speaking', label: 'Putting it into words', detail: 'Manul is writing a reply.' }
  if (pending.length) return { state: 'thinking', label: 'Planning the next step', detail: 'Finding the right tools for your edit.' }
  return { state: 'thinking', label: 'Thinking it through', detail: 'Making a plan for your film.' }
}

export const mascotLabels: Record<MascotState, string> = {
  idle: 'Manul, a fluffy Pallas’s cat, looking around', thinking: 'Manul thinking, with a curious head tilt',
  working: 'Manul working, tapping its little paws', speaking: 'Manul talking', waiting: 'Manul waiting for your answer',
  success: 'Manul celebrating with a little hop', error: 'Manul looking concerned', sleeping: 'Manul dozing, with closed eyes',
}
