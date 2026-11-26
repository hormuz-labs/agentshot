/** Editing from an agent outside AgentShot (src/main/mcp.ts), as Settings shows it. Never carries the token. */
export type OutsideStatus = {
  enabled: boolean
  running: boolean
  url?: string
  problem?: string
  /** The agents AgentShot can add itself to on this computer. */
  agents?: { claudeCode: boolean; claudeApp: boolean; codex: boolean }
}
export type OutsideAgent = 'claudeCode' | 'claudeApp' | 'codex'
/** An outside agent used a tool on a project just now. */
export type OutsideActivity = { dir: string; who: string; tool: string; at: number }

/** How long after an outside agent's last step the app stops saying it is at work. */
export const QUIET_AFTER_MS = 20_000
const DOING: [RegExp, string][] = [
  [/^(look|analyze_video|analyze_screen_activity|find_subjects|search_footage|probe|project_state)$/, 'looking at the footage'],
  [/^(transcript|speakers|name_speakers|analyze_music|sync_media)$/, 'listening'],
  [/^(propose_version|rerender_timeline|render_clip)$/, 'making a new cut'],
  [/^(export_video|export_for_editor)$/, 'exporting'],
  [/^(create_clip|insert_clip|overlay_clip)$/, 'making titles'],
  [/^(generate_voice|generate_music|set_mix|edit_voiceover)$/, 'working on the sound'],
  [/^(edit_timeline|ffmpeg|decide_version|set_video_framing|set_camera_layout|add_files)$/, 'editing'],
]
/** What the app says while an outside agent works on the film: who, and in a word what. */
export const activityLine = (a: { who: string; tool: string }) =>
  `${a.who} is ${DOING.find(([re]) => re.test(a.tool))?.[1] ?? 'working on this film'}`
