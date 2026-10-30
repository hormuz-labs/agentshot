// What each step the agent took says, in words: "Looked at IMG_0412.jpg", "Measured clip.mp4: shots, shake…". One
// wording for the desktop's step cards and the phone's (the computer sends each step's title with it).

type Args = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

/** m:ss.s (as the desktop's timecode). */
const timecode = (s: number) => {
  if (!Number.isFinite(s)) s = 0
  const m = Math.floor(s / 60)
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`
}
const file = (p: unknown, fallback: string) => String(p || '').split('/').pop() || fallback

/** A shell command as a sentence: a script's first comment, the tool and its output, or the command's first line. */
export function shellTitle(command: string) {
  const c = command.trim()
  const lines = c.split('\n')
  const word = (lines[0].split(/\s+/)[0] || '').split('/').pop() || ''
  const script = /^(python3?|node|ruby|perl|bash|sh|zsh)$/.test(word) && lines.length > 1
  if (script) {
    const comment = lines.slice(1).map(l => /^\s*(?:#|\/\/)\s*(.{4,})$/.exec(l)?.[1]).find(Boolean)
    return comment ? comment.replace(/^let'?s\s+/i, '').replace(/^./, x => x.toUpperCase()) : 'Ran a small program'
  }
  // the file a command is about: its last word that looks like one
  const named = lines[0].split(/\s+/).reverse().map(w => w.replace(/^["']|["']$/g, '')).find(w => /\.\w{2,4}$/.test(w))?.split('/').pop()
  if (word === 'ffmpeg') { const out = lines[0].trim().split(/\s+/).at(-1) || ''; return /\.\w{2,4}$/.test(out) ? `Made ${out.split('/').pop()}` : 'Worked on the video' }
  if (word === 'ffprobe') return named ? `Checked ${named}` : 'Checked a file'
  if (word === 'curl') { const host = /https?:\/\/([^/\s"']+)/.exec(c)?.[1]; return host ? `Fetched from ${host}` : 'Fetched something from the web' }
  if (word === 'bsk') return 'Used the browser'
  // the rest in words; the command itself is under Show details
  if (/^(ls|find|tree|du|stat)$/.test(word)) return 'Looked through the project’s files'
  if (/^(cat|head|tail|less|wc|jq)$/.test(word)) return named ? `Read ${named}` : 'Read a file'
  if (/^(grep|rg|egrep|ag)$/.test(word)) return named ? `Searched ${named}` : 'Searched the files'
  if (/^(mkdir|cp|mv|rm|ln|touch|unzip|zip|tar)$/.test(word)) return 'Tidied the project’s files'
  if (/^(python3?|node)$/.test(word)) return 'Ran a small program'
  if (/^(pip3?|npm|brew|apt(-get)?)$/.test(word)) return 'Set up a tool it needed'
  return 'Worked on the computer'
}

/** What a walkthrough_record call did, as a sentence. */
export function walkthroughTitle(a: Args) {
  switch (a.action) {
    case 'start': return 'Started filming the walkthrough'
    case 'step': return a.title ? `Step: ${a.title}` : 'Next step'
    case 'type': return `Typed “${String(a.text || '').slice(0, 40)}${String(a.text || '').length > 40 ? '…' : ''}”`
    case 'scroll': return 'Scrolled'
    case 'move': return 'Moved the pointer'
    case 'pause': return 'Paused filming'
    case 'resume': return 'Filming again'
    case 'stop': return 'Stopped filming'
    default: return 'Filming the walkthrough'
  }
}

const EDIT_WORDS: Record<string, [string, string]> = {
  trim: ['trimmed a piece', 'trimmed $ pieces'], delete: ['removed a piece', 'removed $ pieces'], split: ['split a piece', 'made $ splits'],
  move: ['moved a piece', 'moved $ pieces'], insert: ['added a piece', 'added $ pieces'], level: ['changed a volume', 'changed $ volumes'],
  mix: ['changed the mix', 'changed the mix'], speed: ['changed a speed', 'changed $ speeds'],
}
/** What edits to the cut did, in words: "Edited the cut: trimmed 2 pieces, removed a piece". */
function editsTitle(edits: Args[]) {
  const counts = new Map<string, number>()
  for (const e of edits) counts.set(String(e?.op), (counts.get(String(e?.op)) || 0) + 1)
  const said = [...counts].map(([op, n]) => EDIT_WORDS[op] ? EDIT_WORDS[op][n > 1 ? 1 : 0].replace('$', String(n)) : null).filter(Boolean)
  if (!said.length) return edits.length > 1 ? `Edited the cut (${edits.length} changes)` : 'Edited the cut'
  return `Edited the cut: ${said.slice(0, 3).join(', ')}${said.length > 3 ? ', and more' : ''}`
}

const TITLES: Record<string, (a: Args) => string> = {
  sync_media: () => 'Matching your screen and camera recordings',
  analyze_screen_activity: () => 'Finding screen actions and idle stretches',
  compose_demo: () => 'Syncing, cleaning and composing your demo',
  walkthrough_record: a => walkthroughTitle(a),
  compose_walkthrough: a => `Made the walkthrough${a.narration?.some((l: string) => l?.trim()) ? ', with its voice' : ''}`,
  set_camera_layout: () => 'Adjusted your face-camera layout',
  set_video_framing: () => 'Adjusted video placement and framing',
  project_state: () => 'Looked at the project',
  decide_version: a => a.accept ? 'Used the preview as the editable version' : 'Rejected the preview',
  probe: a => `Read ${file(a.path, 'a file')}`,
  ffmpeg: a => { const out = (a.args || []).at(-1); return out ? `Made ${file(out, 'the video')}` : 'Worked on the video' },
  propose_version: a => `Proposed “${a.title || 'a new cut'}”`,
  resolve_note: a => a.reply ? `Note: ${a.reply}` : 'Resolved a note',
  create_clip: a => `Made clip “${a.title || a.id}”`,
  render_clip: a => `Re-rendered clip ${a.id}`,
  insert_clip: a => `Inserted ${a.id} at ${timecode(a.at || 0)}`,
  rerender_timeline: () => 'Rendered the film',
  transcript: a => a.search ? `Searched the transcript for “${a.search}”` : 'Read the transcript',
  seek: a => `Showed you ${timecode(a.t || 0)}`,
  bash: a => shellTitle(String(a.command || '')),
  analyze_video: a => `Measured ${file(a.media, 'the video')}: shots, shake, exposure, colour, sound`,
  speakers: a => `Found who speaks when in ${file(a.media, 'the video')}`,
  find_subjects: a => `Found the faces and subjects${a.aspect ? ` for ${a.aspect}` : ''}`,
  analyze_music: a => `Found the beat of ${file(a.media, 'the music')}`,
  look: a => a.image ? `Looked at ${file(a.image, 'a picture')}` : `Looked at ${a.times?.length || a.count || 6} frames${a.box ? ' (zoomed in)' : ''}`,
  read: a => `Read ${file(a.path, 'a file')}`,
  write: a => `Wrote ${file(a.path, 'a file')}`,
  edit: a => `Edited ${file(a.path, 'a file')}`,
  edit_timeline: a => editsTitle(Array.isArray(a.edits) ? a.edits : []),
  set_mix: () => 'Adjusted the mix',
  overlay_clip: a => `Laid ${a.id || 'a clip'} over the film${a.at != null ? ` at ${timecode(a.at)}` : ''}`,
  generate_voice: () => 'Recorded a voice-over',
  generate_music: () => 'Composed music',
  export_video: () => 'Exported the film',
  import_media: () => 'Brought in media',
  name_speakers: () => 'Named the speakers',
  browser: () => 'Used the browser',
  ask_user: () => 'Asked you',
  suggest_next: () => 'Suggested what’s next',
  memory: () => 'Checked what it remembers',
  remember: () => 'Remembered something for next time',
  forget: () => 'Forgot something',
  skills: () => 'Looked at its skills',
  demo_layout: () => 'Laid out the demo',
}

/** A step, as a line: its own words when AgentShot knows the tool, else the tool's name in words. */
export function stepTitle(name: string, args: Args = {}): string {
  try { return TITLES[name]?.(args) ?? name.replace(/_/g, ' ') } catch { return name.replace(/_/g, ' ') }
}

/** What a step shows when opened, besides its result: the command a shell step ran. */
export function stepDetail(name: string, args: Args = {}): string | undefined {
  if (name === 'bash' && args.command) return `$ ${args.command}`
  if (name === 'ffmpeg' && args.args) return `ffmpeg ${(args.args as unknown[]).join(' ')}`
  return undefined
}
