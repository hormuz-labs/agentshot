// Manul's agent: a pi-durable Harness on SQLite, so conversations, tool calls and their output survive a crash or quit.
// One durable conversation per project. Every view change goes through the AG-UI adapter to the renderer.
// Extensions:
//   coding   read / write / edit / native shell in the project folder (bundled ffmpeg and ffprobe are on PATH)
//   editor   Manul's own tools: project state, probe, ffmpeg, propose a version, seek, resolve a note, ask the user
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { createRegistry, defineExtension, defineTool, Harness, section } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { CodingTools, createPowerShellTool } from '@earendil-works/pi-durable/tools'
import type { BaseEvent } from '@ag-ui/core'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { AguiAdapter } from './agui'
import { liveEnv } from './bsk'
import { isWithinDir } from './paths'
import { chooseModel, describeModels } from './models'
import { buildProviders, listProviders } from './providers'
import { manulProvider } from './gateway'
import type { Memory } from './memory'
import type { Skills } from './skills'
import { BIN, FFMPEG, FONTS_DIR, MODELS_DIR, VISION, probe } from './media'
import { FencedEnv, fencedArgv, fenceFor, realish, type Fence } from './fence'
import { windowsPowerShell } from './tools'
import { homedir } from 'node:os'
import { analyze, contactSheet, report, sheetFrames } from './analysis'
import { analyzeMusic, musicReport } from './music'
import { syncMedia } from './sync'
import { analyzeScreen } from './screen-activity'
import { asJob } from './jobs'
import type { DemoOptions } from './demo'
import { demoCleanup } from '../shared/demo'
import { DemoBriefs } from './demo-brief'
import { inspectionTimes, InspectionGuard } from './inspection'
import type { DemoSummary } from '../shared/demo'
import { generate } from './generate'
import { VOICES } from '../../account/src/media.ts'
import { cachedSpeakers, speakersReport, withSentences } from './speakers'
import { nameOf, speakerOfSegments, type SpeakerNames, type Speakers } from '../shared/speakers'
import { findSubjects, shotSubjects, subjectsReport, track } from './subjects'
import { fileLine } from './files'
import { ATTACHED } from '../shared/attached'
import { mkdir, readFile } from 'node:fs/promises'
import { batch, duration as timelineDuration, sameCut, starts, timelineOfFile, type Edit, type Timeline } from '../shared/timeline'
import type { ClipInfo, Project, Transcript } from '../shared/types'
import { ASPECTS } from '../shared/motion-formats'
import { example as galleryExample } from './gallery'
import type { GalleryExample } from '../shared/types'
import type { Recorder } from './take'
import type { ComposeRequest } from './walkthrough'
import type { Take } from '../shared/walkthrough'

type Any = Record<string, any>
const text = (t: unknown) => ({ content: [{ type: 'text' as const, text: typeof t === 'string' ? t : JSON.stringify(t, null, 1) }] })
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`

/** What the agent needs from the rest of the app. */
export type Bridge = {
  composeDemo(dir: string, req: DemoOptions, signal?: AbortSignal): Promise<{ version: string; duration: number; removed: number; sync: unknown; warning?: string; summary?: DemoSummary }>
  project(dir: string): Project | undefined
  decideVersion(dir: string, accept: boolean): Promise<Project>
  proposeVersion(dir: string, absPath: string, title: string): Promise<string>
  resolveNote(dir: string, id: string, reply: string): Promise<void>
  seek(dir: string, t: number): void
  /** Makes the transcript if needed (may ask the user to download speech recognition). */
  transcript(dir: string, mediaRel: string): Promise<Transcript | null>
  /** Who speaks when (made if needed; with count, for exactly that many people), its file and the names given. */
  speakers(dir: string, mediaRel: string, count?: number): Promise<{ result: Speakers; file: string; names: SpeakerNames }>
  /** Name voices (id → name, "" clears); the same name on two voices makes them one person. */
  nameSpeakers(dir: string, mediaRel: string, names: SpeakerNames): Promise<SpeakerNames>
  saveClip(dir: string, id: string, title: string, html: string, dur: number, overlay: boolean): Promise<ClipInfo & { frames: number }>
  overlayClip(dir: string, id: string, at: number, dur: number | undefined, title: string): Promise<string>
  bakeClip(dir: string, id: string): Promise<ClipInfo & { frames: number }>
  insertClip(dir: string, id: string, at: number, title: string): Promise<string>
  rerenderTimeline(dir: string, title: string): Promise<string>
  /** Change the edit at once (no render); the user can undo it. */
  editTimeline(dir: string, edits: Edit[]): Promise<Project>
  /** A sentence on what happened (a new version, or the mix kept with an edit not rendered yet). */
  setMix(dir: string, mix: { filmDb: number; music?: { src: string; db: number; duckDb: number } }): Promise<string>
  /** Copy a file, folder or .zip (e.g. a download) into media/ and add it to the project; a line per new file. */
  importFiles(dir: string, absPath: string): Promise<string[]>
  exportFilm(dir: string, req: { preset: 'original' | 'landscape' | 'vertical' | 'square'; fit?: 'pad' | 'crop'; captions: 'none' | 'burn' | 'srt'; captionColor?: string }): Promise<{ file: string; srt?: string }>
  /** Start filming the tab the agent's bsk session drives (Manul's browser or the user's Chrome, per the setting). */
  startTake(dir: string, o: { session: string }): Promise<Recorder>
  /** The take recording in this project, if any. */
  take(dir: string): Recorder | undefined
  stopTake(dir: string): Promise<Take>
  /** Why the browser is off limits until the user replies (they pressed Interrupt in it), or null. */
  browserHalted(): string | null
  /** Voice, condense and draw a take, and propose the film. */
  composeWalkthrough(dir: string, req: ComposeRequest, title: string, signal?: AbortSignal): Promise<{ version: string; duration: number; outline: string[]; cut: number; spedUp: number; held: number; voiced: number }>
}

const MOTION_POINTER = `Motion clips (title cards, lower thirds, kinetic text, charts…) are HTML + GSAP that Manul renders frame-exact: ` +
  `full-frame cards go between shots with insert_clip; lower thirds, captions, callouts and logos are made with overlay: true and laid over ` +
  `the footage with overlay_clip. Read the motion-design skill first when it is enabled.`

/** For a motion video (no footage): what it is, the gallery example's prompt, the reference, and how to make it. */
export function motionBrief(p?: Project, lookup: (id: string) => GalleryExample | undefined = galleryExample) {
  const m = p?.motion
  if (!m) return ''
  const ex = m.example ? lookup(m.example.id) : undefined
  const { width, height } = ASPECTS[m.aspect]
  return `\n\nThis project is a MOTION VIDEO made from nothing: there is no footage. The film is ${m.aspect} (${width}x${height}, 60 fps)` +
    `${m.length ? `, about ${m.length} s` : ''}, and it starts as one second of blank canvas (${m.canvas}) that your scenes replace.\n` +
    (m.example ? `The user started from a gallery example, "${m.example.title}" by @${m.example.handle}${m.example.post ? ` (${m.example.post})` : ''}. ` +
      `Make the user's video the way that one was made: its look, pacing, structure and taste, with the user's own content. ` +
      (ex?.prompt ? `This is the prompt that made it:\n<example_prompt>\n${ex.prompt}\n</example_prompt>\n` +
        `Follow its direction, structure, rules and gotchas. Where it asks the user for inputs, ask for the ones the user hasn't given (one ask_user). ` +
        `Where it says how to build or render (one HTML file, seek(t), Playwright, ffmpeg, a framework), use Manul's motion clips instead: ` +
        `the same ideas, made with create_clip.\n`
        : ex?.skill ? `It was made with a skill (${ex.skill}); you don't have that skill, so work from the video.\n` : '')
      : '') +
    (m.reference ? `Reference video: ${m.reference}. Take its grammar (palette, type, pacing, shot lengths, transitions, camera moves, texture, ` +
      `how text enters and leaves), never its content, logos or characters. Study it first: analyze_video, then look at frames every 0.5 s.\n` : '') +
    `If what the user asks for is really a walkthrough or demo of a real website or web app (filmed, not animated), ` +
    `make that instead: read the product-walkthrough skill.\n` +
    `How to make it (read the motion-design skill first):\n` +
    `1. If something essential is missing (what it's about, the words on screen, brand colour, logo), ask once with ask_user. ` +
    `Otherwise don't ask; choose well.\n` +
    `2. Storyboard before any code: a beat sheet (one line per scene: time, what's on screen, how it moves${m.reference ? ', and a short style guide from the reference' : ''}). ` +
    `Send it and ask_user to approve it or change it, then stop. Write no clips before the user approves.\n` +
    `3. Build one clip per scene (create_clip, full-frame, never overlay), check the frame each returns, fix what's off.\n` +
    `4. Put the scenes in order with edit_timeline/insert_clip and cut the blank canvas piece out, so the film is only your scenes. ` +
    `Add music or sound when it helps (music-generation skill), with scene changes on its beats.\n` +
    `5. rerender_timeline to propose the film. Then the user directs with notes on the picture: change only the scene a note is on.`
}

/** For a product walkthrough made from nothing: the product is filmed in the browser, then narrated. */
export function walkthroughBrief(p?: Project) {
  if (!p?.walkthrough) return ''
  return `\n\nThis project is a PRODUCT WALKTHROUGH made from nothing: there is no footage yet. The film is a blank 16:9 canvas ` +
    `(${p.walkthrough.canvas}) until you propose the walkthrough you filmed. Read the product-walkthrough skill first and follow it: ` +
    `explore the product with bsk (not filmed), send a storyboard (one line per step: what is shown and what is said) and ask_user to approve it, ` +
    `then film it in one take with walkthrough_record and make the film with compose_walkthrough.`
}

/** A clip tool's answer: what was rendered, plus the middle frame so the model can see its design. */
async function clipResult(p: Project, c: ClipInfo & { frames: number }) {
  const poster = await readFile(join(p.dir, c.poster)).catch(() => null)
  return {
    content: [
      { type: 'text' as const, text: `Rendered clip "${c.id}" (${c.title}): ${c.duration} s, ${c.frames} frames → ${c.video}. Middle frame attached.` },
      ...(poster ? [{ type: 'image' as const, data: poster.toString('base64'), mimeType: 'image/jpeg' }] : []),
    ],
  }
}

export function codingExtension(platform = process.platform) {
  return platform === 'win32' ? defineExtension({ ...CodingTools, tools: [
    ...CodingTools.tools!.filter(t => t.name !== 'bash'), createPowerShellTool({ programs: [windowsPowerShell()] }),
  ] }) : CodingTools
}

const Option = Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) })
const FramingSchema = Type.Object({ fit: Type.Optional(Type.Union([Type.Literal('contain'), Type.Literal('cover')])), zoom: Type.Optional(Type.Number({ minimum: 0.25, maximum: 4 })), x: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })), y: Type.Optional(Type.Number({ minimum: -2, maximum: 2 })) })
const CameraLayoutSchema = Type.Object({
  shape: Type.Optional(Type.Union(['circle', 'square', 'rectangle', 'rounded'].map(s => Type.Literal(s)))),
  x: Type.Optional(Type.Number({ minimum: 0 })), y: Type.Optional(Type.Number({ minimum: 0 })),
  width: Type.Optional(Type.Number({ minimum: 2 })), height: Type.Optional(Type.Number({ minimum: 2 })),
  border: Type.Optional(Type.Number({ minimum: 0, maximum: 12 })), hidden: Type.Optional(Type.Boolean()),
  framing: Type.Optional(FramingSchema),
  crop: Type.Optional(Type.Union([Type.Null(), Type.Object({ x: Type.Number({ minimum: 0, maximum: 1 }), y: Type.Number({ minimum: 0, maximum: 1 }), w: Type.Number({ minimum: 0.01, maximum: 1 }), h: Type.Number({ minimum: 0.01, maximum: 1 }) })])),
})

/** The edit's pieces, one line each: id, where it sits in the film, what it is. */
export function piecesOf(tl: Timeline) {
  const at = starts(tl)
  const r = (n: number) => Math.round(n * 100) / 100
  return tl.items.map((i, k) => {
    const where = `${r(at[k])}–${r(at[k] + (i.kind === 'media' ? i.out - i.in : i.dur))} s`
    if (i.kind === 'clip') return `${i.id} ${where}: clip ${i.clip}`
    const level = i.muted ? ' (muted)' : i.db ? ` (${i.db > 0 ? '+' : ''}${i.db} dB)` : ''
    return `${i.id} ${where}: ${i.src} ${r(i.in)}–${r(i.out)}${level}`
  })
}

/** The edit was changed (by hand or with edit_timeline) since the version on screen was rendered. */
export function editedOf(p: Project) {
  const v = p.versions.find(x => x.id === p.current)
  return !!v && !!p.timeline && !!p.media[v.path] && !sameCut(p.timeline, v.timeline ?? timelineOfFile(v.path, p.media[v.path]))
}

/** Text plus a JPEG the model can see. */
async function imageResult(caption: string, path: string) {
  const data = await readFile(path)
  return { content: [{ type: 'text' as const, text: caption }, { type: 'image' as const, data: data.toString('base64'), mimeType: 'image/jpeg' }] }
}

/** Where the agent may go, per project (src/main/fence.ts): Manul's resources read-only, plus extra folders. */
export type FenceConfig = { resources: string; extraRw?: string[]; extraRo?: string[] }

export function editorExtension(bridge: Bridge, dirOf: (convId: string) => string, fenceConfig?: FenceConfig, briefs = new DemoBriefs(), inspections = new InspectionGuard()) {
  const proj = (api: Any) => {
    const dir = dirOf(api.conversationId)
    const p = bridge.project(dir)
    if (!p) throw new Error('This project is not open.')
    return p
  }
  const inProject = (p: Project, path: string) => {
    const abs = isAbsolute(path) ? path : resolve(p.dir, path)
    if (!isWithinDir(p.dir, abs) || !isWithinDir(realish(p.dir), realish(abs))) throw new Error('Paths must stay inside the project folder.')
    return abs
  }
  /** Run a bundled program inside the agent's fence (its paths come from the model). */
  const fencedExec = (p: Project, bin: string, args: string[]): [string, string[]] => {
    if (!fenceConfig) return [bin, args]
    const argv = fencedArgv(fenceFor({ project: p.dir, ...fenceConfig }), [bin, ...args], { home: homedir(), fenceBin: join(BIN, 'manul-fence') })
    return argv ? [argv[0], argv.slice(1)] : [bin, args]
  }
  return defineExtension({
    name: 'editor',
    sections: [section('manul', (input: Any) =>
      `You are Manul, an agentic video editor. The user drops in a video and tells you what they want; you do it.\n` +
      `The project folder is ${input.env?.cwd || 'the working directory'}: project.json (versions, notes, media info), media/ (imported files), ` +
      `renders/ (your outputs), notes/ (frame stills).\n` +
      `When delivering a generated file (image, document, spreadsheet, audio, video, or archive), save it under renders/ and include a Markdown link such as [Download thumbnail](renders/thumbnail.png) in your reply. Manul shows linked project files as downloadable cards in chat and lists generated outputs in Files.\n` +
      `How to work:\n` +
      `- Start with project_state to see the versions, the current one, open notes and media details.\n` +
      `Use project_state rather than bash/Python to inspect project.json, current, proposal or media. Do not run ls .., ` +
      `search parent folders, or investigate Manul's installation to recover from an edit error. Bash works inside the project; ` +
      `"Operation not permitted" outside it is a sandbox refusal, not a broken shell.\n` +
      `- Know the footage before deciding anything about it. Measure first: analyze_video gives the shots (cut times), camera shake and motion, ` +
      `exposure, contrast, colour cast, black/frozen frames, loudness and silence, plus one frame per shot to see what each shot shows; ` +
      `the transcript tool gives speech; speakers gives who speaks when; find_subjects gives where faces and objects are per shot (and crops that follow them). Then look (frames at chosen times, a zoomed box, or an image file) only for what numbers can't tell: ` +
      `what is in a shot, where faces or text are, whether a render looks right. Never write scripts (Python or other) to analyse pixels or sound, ` +
      `and never use another ffmpeg: the bundled one has what you need (vidstabdetect/vidstabtransform for shake, rubberband for speed, scdet, signalstats, ebur128…).\n` +
      `- Frame inspections have a finite information limit. Never inspect sub-frame windows repeatedly. For "trim tighter", read transcript ` +
      `and measured silence/activity, plan word-safe cuts, and apply them; use at most a few look calls for uncertain action boundaries. ` +
      `If look says no new information, stop inspecting and edit with the evidence already available.\n` +
      `- Open-ended requests (make it cinematic, clean it up, fix it, turn it into a promo/short): analyze_video first, then say in 2–4 short lines what you found ` +
      `and offer the fixes you'd make as ask_user with multiple: true — one option per fix, its description saying what changes and where ` +
      `(e.g. "Stabilise shots 2 and 4 — strong handheld shake"). Apply the chosen ones together in one render. Precise requests ("cut the first 5 s") need no questions.\n` +
      `- Edit with the ffmpeg tool (bundled; also on PATH for the shell). Read the current version, write new files to renders/. Never overwrite media/.\n` +
      (process.platform === 'win32' ? `- Shell commands use the powershell tool, not Bash. Use PowerShell syntax and built-in commands; translate Unix examples in skills. Do not require Git Bash, WSL, which, du or other Unix utilities. Quote paths with spaces; use & to run a quoted executable path. Python is optional, not assumed installed.\n` : '') +
      `- Files the user gives you (more footage, music, voice-over, logos, photos, subtitles, fonts, LUTs) are in media/ and listed ` +
      `in project_state under files, each with what it is; a message lists the ones attached to it under "${ATTACHED}" (files, and also ` +
      `versions of the film and motion clips the user pointed at; "@name" in the message means the attached one of that name). Use them when the request ` +
      `touches them, and say so. Subtitles: read them for the words and times, and burn, restyle or retime them (video-editing skill, ` +
      `references/inputs.md). If a file's use isn't clear, ask.\n` +
      `- For anything about speech (cut ums or pauses, remove a sentence, find a moment, captions) read the transcript tool first and cut on word times. ` +
      `Each word's start and end are cut points already placed in the quiet around it: cut exactly on them (to drop words a–b, cut from a's start to b's end). ` +
      `To cut many pieces, build one ffmpeg command with trim/atrim + concat (or select/aselect) from the word times.\n` +
      `- Get it right in one render: plan every cut from the transcript first. Check a render at most once (e.g. the transcript of the output) ` +
      `and only when unsure; never re-render just to polish. The user will ask if they want more.\n` +
      `- When a cut is ready, call propose_version: the user sees it as a before/after and accepts or rejects it. One proposal per request.\n` +
      `- The film is also an edit: pieces of files in order (project_state → timeline.pieces). The user can split, cut, trim, move and ` +
      `set the volume of pieces by hand; so can you, with edit_timeline: it changes the edit at once, without rendering, and the user ` +
      `can undo it. Prefer it to ffmpeg for plain cuts, trims, reordering and volume (cut ums or pauses with word times and src). ` +
      `When timeline.edited is set, the current version's file doesn't have those changes yet: work on the edit (edit_timeline, ` +
      `insert_clip, overlay_clip), or call rerender_timeline first before using ffmpeg on the film.\n` +
      `If a proposal is pending, do not call edit_timeline/set_camera_layout yet. Use project_state; if the user explicitly asks ` +
      `to revise the proposed result, call decide_version accept:true to use it as the starting point, then edit it. ` +
      `If they reject it, accept:false. If their intent is unclear, ask whether to edit the preview or the current version.\n` +
      `- Notes arrive as "[note <id> @ start–end, box x,y,w,h]" plus a still of the frame with the box drawn on it. The box is in 0–1 fractions of the picture ` +
      `(x,y = top-left). Act on exactly that moment and region; when done, call resolve_note with a one-line reply. ` +
      `A note on "clip <id> element <name>" is about that element (data-manul-id) of clips/<id>/clip.html: edit only it (read + edit tools), ` +
      `then render_clip and rerender_timeline.\n` +
      `- Skills: read video-editing before any edit, and the skill for the kind of video (talking-head, short-form, promos-and-montages, ` +
      `tutorials, demo-editor, cleanup-and-repair, motion-design, music-generation, voiceover) — see the skills list.\n` +
      `- Separate screen and face-camera recordings: read demo-editor, sync_media first, then compose_demo to keep linked source tracks editable. ` +
      `Use edit_timeline for later cuts and set_camera_layout for layout changes. Static screen with speech, or silent meaningful screen action, is not dead time.\n` +
      `Before first demo composition call demo_layout to ask all missing position, shape and size choices in one card. ` +
      `Defaults only when the user explicitly says "You decide". End with measured summary.message from compose_demo, including seconds of stale footage removed, and short **Audio sync** / **Layout** bullets.\n` +
      `Demo creation includes natural dead-time cleanup by default; "please sync it" does not disable cleanup. ` +
      `Use cleanup:none only when the user explicitly chooses Keep everything, no trimming, or sync only. ` +
      `When cleanup was skipped, say it was skipped rather than claiming there were no stale sections.\n` +
      `After a demo output ask if the user wants to adjust face position, shape, size or framing. The chat displays an adjustment question ` +
      `and inline toolbox with live controls; refer them to "Yes, adjust layout". Changes are on the linked timeline; rerender_timeline renders them.\n` +
      `- Product walkthroughs and demos of a website or web app (filmed in the browser, narrated): read the product-walkthrough skill first. ` +
      `They are filmed in the user's own Chrome: drive it with chrome-bsk (bsk's commands, on their Chrome and logins). ` +
      `walkthrough_record films the tab your session drives in one continuous take; compose_walkthrough cuts the idle time, voices one line per step ` +
      `and adds the zoom and a cursor. Never record the screen any other way.\n` +
      `- Voice and music: generate_voice and generate_music (they use the user's own key or their Manul key; never call voice or music APIs with curl).\n` +
      `- Fonts for text you draw with ffmpeg: ${FONTS_DIR} (Inter-Regular.ttf, Inter-Bold.ttf; drawtext fontfile=…, subtitles fontsdir=…). ` +
      `Fonts the user added are in the project's fonts/ folder with Inter: then use fontsdir=fonts (never fontsdir=media).\n` +
      `- Prefer one well-built ffmpeg command over many small ones. Keep codecs sensible: libx264 -crf 18 -preset veryfast, aac 192k, -movflags +faststart.\n` +
      `- When you need a decision from the user, call ask_user with 2–5 options and stop.\n` +
      `API keys the user saved in Manul are already in your shell's environment (e.g. $ELEVENLABS_API_KEY, $GEMINI_API_KEY): use them in commands as they are; ` +
      `never print, echo, measure or log a key or any part of it, and never look for keys elsewhere (other shells, files).\n` +
      `Your files and shell are fenced to the project folder (plus temp folders and Manul's bundled tools, skills, models and fonts, ` +
      `read-only); anything else is refused, so don't look elsewhere. Files the user adds are already copied into media/ (never look for the originals).\n` +
      `Stay inside the project folder. Never inspect, run or search Manul's own program files, other folders or system processes; ` +
      `if a tool fails, read its error and fix your input instead of investigating the app.\n` +
      `Write replies in short plain Markdown. Say what you did, not how.\n\n` + MOTION_POINTER +
      motionBrief(input.env?.cwd ? bridge.project(input.env.cwd) : undefined) +
      walkthroughBrief(input.env?.cwd ? bridge.project(input.env.cwd) : undefined), { tag: false })],
    tools: [
      defineTool({
        name: 'decide_version',
        description: 'Resolve a pending preview before changing its timeline. accept:true uses the proposed result as the editable starting point, when the user explicitly asks to revise/use it. accept:false discards the preview when requested. Check project_state first; never silently decide an ambiguous request.',
        parameters: Type.Object({ accept: Type.Boolean() }),
        execute: async (args: Any, api: Any) => {
          const p = await bridge.decideVersion(proj(api).dir, args.accept)
          return text({ current: p.current, proposal: p.proposal || null, message: args.accept ? 'Preview is now the editable starting point.' : 'Preview rejected; current edit retained.' })
        },
      }),
      defineTool({
        name: 'demo_layout',
        description: 'Before composing a first demo, ask missing user choices for face position, shape and size in one card. User-specified choices are retained; You decide authorizes recommendations. Ends the turn when questions are needed. Call again after their answer, then compose_demo.',
        parameters: Type.Object({ screen: Type.String() }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api), info = p.media[args.screen]
          if (!info?.width) throw new Error('Choose the screen recording first.')
          const result = briefs.resolve(String(api.conversationId), info.width, info.height)
          return result.questions ? { ...text(result), control: { terminate: true } } : text(result)
        },
      }),
      defineTool({
        name: 'sync_media',
        description: 'Match separate screen and face-camera recordings using common audio. Returns measured offset, clock drift, overlap and confidence. Cached. Never guess alignment from file lengths. If unreliable, ask for the same word/clap time in both recordings.',
        parameters: Type.Object({ screen: Type.String(), camera: Type.String() }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          inProject(p, args.screen); inProject(p, args.camera)
          return text(await asJob('Matching your recordings', 'render', () => syncMedia(p.dir, args.screen, args.camera, api.signal), { project: p.dir }))
        },
      }),
      defineTool({
        name: 'analyze_screen_activity',
        description: 'Measure meaningful local changes across a complete screen recording (typing, scrolling, UI changes), rather than camera movement. Returns active intervals. Combine with narration: silence OR a static screen alone is not a reason to cut.',
        parameters: Type.Object({ media: Type.String() }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api); inProject(p, args.media)
          const a = await analyzeScreen(p.dir, args.media, api.signal)
          return text({ duration: a.duration, active: a.active, samplingFps: a.fps })
        },
      }),
      defineTool({
        name: 'compose_demo',
        description: 'Create and propose a synced, editable screen + face-camera demo. Measures sync (cached), transcribes narration, removes only jointly idle intervals, applies one shared cut plan to all tracks, renders FFmpeg and checks duration. Ask for missing layout preferences once; default top-right circle 20% width, natural cleanup. Screen-only footage outside camera coverage is retained. manual_offset is only for an alignment explicitly supplied by the user: screen event time minus camera event time.',
        parameters: Type.Object({ screen: Type.String(), camera: Type.String(), layout: Type.Optional(CameraLayoutSchema),
          corner: Type.Optional(Type.Union(['top-right', 'top-left', 'bottom-right', 'bottom-left'].map(s => Type.Literal(s)))),
          cleanup: Type.Optional(Type.String({ description: 'natural (default), tight, or none (keep everything). keep-all / keep-everything / off are aliases for none.' })),
          audio: Type.Optional(Type.Union([Type.Literal('screen'), Type.Literal('camera')])),
          overlap_only: Type.Optional(Type.Boolean()), manual_offset: Type.Optional(Type.Number()),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api); inProject(p, args.screen); inProject(p, args.camera)
          const chosen = p.timeline?.demo ? undefined : briefs.resolve(String(api.conversationId), p.media[args.screen]?.width || 1920, p.media[args.screen]?.height || 1080)
          // Enforce the brief even if the model tries to skip demo_layout and supplies its own guessed defaults.
          if (chosen?.questions) return { ...text(chosen), control: { terminate: true } }
          const layout = chosen?.layout ? { ...args.layout, ...chosen.layout } : args.layout
          const result = await bridge.composeDemo(p.dir, { screen: args.screen, camera: args.camera, layout, corner: chosen?.corner || args.corner,
            cleanup: demoCleanup(args.cleanup), audio: args.audio, overlapOnly: args.overlap_only, manualOffset: args.manual_offset }, api.signal)
          briefs.completed(String(api.conversationId))
          return text({ ...result, instruction: 'Tell the user summary.message verbatim (measured stale footage removed), original → final duration, then concise **Audio sync** and **Layout** bullets. Do not invent removed time.' })
        },
      }),
      defineTool({
        name: 'set_video_framing',
        description: 'Adjust a timeline video piece: fit/fill, zoom and x/y placement without changing source timing. x/y are fractions of the output viewport; positive y moves the picture downward. Live, undoable; rerender_timeline proposes the result. For a face inside its circle use set_camera_layout with framing instead.',
        parameters: Type.Object({ ids: Type.Array(Type.String(), { minItems: 1 }), framing: FramingSchema }),
        execute: async (args: Any, api: Any) => text((await bridge.editTimeline(proj(api).dir, [{ op: 'frame', ids: args.ids, framing: args.framing }])).timeline),
      }),
      defineTool({
        name: 'set_camera_layout',
        description: 'Change the linked face-camera shape, size, position, border, crop, source framing or visibility. layout x/y move the shape in output pixels; framing x/y move the source INSIDE the shape by fractions of its width/height, zoom resizes the source. Use framing to fix a cropped head. Keeps sync and cuts, live and undoable; rerender_timeline proposes it.',
        parameters: CameraLayoutSchema,
        execute: async (args: Any, api: Any) => {
          const p = await bridge.editTimeline(proj(api).dir, [{ op: 'camera', layout: args }])
          return text({ layout: p.timeline?.demo?.layout, message: 'Camera layout updated live. Sync and cuts preserved.' })
        },
      }),
      defineTool({
        name: 'project_state',
        description: 'The project: versions (which one is current, which is proposed), notes with their anchors, the files the user added (what each is), and media details (duration, size, fps, audio).',
        parameters: Type.Object({}),
        execute: async (_args: Any, api: Any) => {
          const p = proj(api)
          const cur = p.versions.find(v => v.id === p.current)
          return text({
            title: p.title, folder: p.dir,
            current: cur && { ...cur, ...p.media[cur.path] },
            proposal: p.proposal,
            timeline: p.timeline && { size: `${p.timeline.width}x${p.timeline.height}`, fps: p.timeline.fps, duration: timelineDuration(p.timeline),
              ...(editedOf(p) ? { edited: 'changed since the current version was rendered (by the user by hand, or edit_timeline): the version\'s file does not have these changes yet' } : {}),
              pieces: piecesOf(p.timeline),
              demo: p.timeline.demo,
              overlays: (p.timeline.overlays || []).map(o => `overlay ${o.clip} at ${o.start}s for ${o.dur}s`) },
            clips: Object.values(p.clips || {}).map(c => ({ id: c.id, title: c.title, duration: c.duration })),
            versions: p.versions.map(v => ({ id: v.id, title: v.title, path: v.path, by: v.by })),
            notes: p.notes.filter(n => n.status === 'open').map(n => ({ id: n.id, at: `${fmt(n.anchor.t0)}${n.anchor.t1 != null ? `–${fmt(n.anchor.t1)}` : ''}`, box: n.anchor.box, text: n.text })),
            files: Object.keys(p.files || {}).map(rel => fileLine(rel, p.files!, p.subtitles)),
            media: p.media,
          })
        },
      }),
      defineTool({
        name: 'probe',
        description: 'Read a media file\'s details (duration, size, fps, codec, audio) with ffprobe. Path relative to the project folder.',
        parameters: Type.Object({ path: Type.String() }),
        execute: async (args: Any, api: Any) => text(await probe(inProject(proj(api), args.path))),
      }),
      defineTool({
        name: 'analyze_video',
        description: 'Measure a video before editing it: every shot (cut times), camera shake and motion per shot, exposure, contrast, saturation and colour cast, ' +
          'black and frozen frames, loudness (LUFS, peak) and silences — then a contact sheet with one frame per shot (labelled #shot and time). ' +
          'Deterministic and cached; call it first for any request that depends on what the footage is like.',
        parameters: Type.Object({ media: Type.Optional(Type.String({ description: 'project-relative path; default the current version' })) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const rel = args.media || p.versions.find(v => v.id === p.current)!.path
          const file = inProject(p, rel)
          const a = await analyze(p.dir, file, api.signal)
          if (!a.shots.length) return text(report(a, rel))
          const sheet = join(p.dir, '.cache', 'analysis', `sheet-${Date.now()}.jpg`)
          await contactSheet(file, sheetFrames(a), sheet, { signal: api.signal })
          return imageResult(report(a, rel) + '\nContact sheet attached (one frame per shot).', sheet)
        },
      }),
      defineTool({
        name: 'analyze_music',
        description: 'The rhythm of music (a music file, or any video\'s soundtrack): tempo, how steady it is, every bar\'s downbeat with its loudness, ' +
          'where the energy lifts, drops or breaks, and the strongest hits. Every beat time is saved to a JSON file you can read. ' +
          'Call it before cutting picture to music, placing music under picture, or timing titles, speed ramps or transitions to the music.',
        parameters: Type.Object({ media: Type.String({ description: 'project-relative audio or video file, e.g. media/song.mp3' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const { music, beatsFile } = await analyzeMusic(p.dir, inProject(p, args.media), api.signal)
          return text(musicReport(music, args.media, beatsFile.slice(p.dir.length + 1)))
        },
      }),
      defineTool({
        name: 'generate_voice',
        description: 'Say a script in a generated voice (voiceover, narration, a read line) and save it to generated/. Read the voiceover skill first. ' +
          'Costs the user money: only when they asked for a voice, or after ask_user. One take; split scripts over 5,000 characters. ' +
          `Voices: ${Object.entries(VOICES).map(([n, v]) => `${n} (${v.about})`).join('; ')}.`,
        parameters: Type.Object({
          text: Type.String({ description: 'exactly what to say' }),
          voice: Type.Optional(Type.String({ description: 'one of the voices; default narrator' })),
          style: Type.Optional(Type.String({ description: 'how to say it, e.g. "calm and warm", "excited", "whispering"' })),
          name: Type.String({ description: 'short file name, e.g. intro' }),
          provider: Type.Optional(Type.String({ description: 'only when the user asks for one of their own keys: elevenlabs, gemini or openai' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const { rel, by } = await generate('voice', { text: args.text, voice: args.voice, style: args.style }, p.dir, args.name, args.provider, api.signal)
          const d = await probe(join(p.dir, rel)).then(i => i.duration).catch(() => 0)
          return text(`Saved ${rel} (${d.toFixed(1)} s), made by ${by}. import_media it to use it in the edit.`)
        },
      }),
      defineTool({
        name: 'generate_music',
        description: 'Make original music (a bed, a score, a sting, a jingle) to a length, optionally in timed sections that land on the film\'s moments, ' +
          'and save it to generated/. Read the music-generation skill first. Costs the user money: only when they asked for music, or after ask_user. One take.',
        parameters: Type.Object({
          prompt: Type.String({ description: 'genre, mood, lead instruments, BPM, key, the energy curve; never a named artist or song' }),
          seconds: Type.Number({ description: '3–600' }),
          instrumental: Type.Optional(Type.Boolean({ description: 'default true' })),
          sections: Type.Optional(Type.Array(Type.Object({
            name: Type.String({ description: 'e.g. Intro, Build, Drop, Outro' }),
            seconds: Type.Number({ description: '3–120; all sections add up to seconds' }),
            description: Type.Optional(Type.String()),
            lyrics: Type.Optional(Type.String({ description: 'only when not instrumental' })),
          }))),
          name: Type.String({ description: 'short file name, e.g. bed' }),
          provider: Type.Optional(Type.String({ description: 'only when the user asks for one of their own keys: elevenlabs or gemini' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const req = { prompt: args.prompt, seconds: args.seconds, instrumental: args.instrumental, sections: args.sections }
          const { rel, by } = await generate('music', req, p.dir, args.name, args.provider, api.signal)
          const d = await probe(join(p.dir, rel)).then(i => i.duration).catch(() => 0)
          return text(`Saved ${rel} (${d.toFixed(1)} s; asked for ${args.seconds} s), made by ${by}. Check it with analyze_music before using it.`)
        },
      }),
      defineTool({
        name: 'speakers',
        description: 'Who speaks when: speaker turns (A, B, C… in order of first speaking) with talk time per speaker and, when there is a transcript, ' +
          'what each turn says. For podcasts, interviews and any clip with several people: cutting or cropping to the speaker, reactions, ' +
          'lower thirds, picking one person\'s answers. Pass speakers when you know how many people talk (much more accurate).',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative path; default the current version' })),
          speakers: Type.Optional(Type.Number({ description: 'how many people speak, if known' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const rel = args.media || p.versions.find(v => v.id === p.current)!.path
          inProject(p, rel)
          let { result, file, names } = await bridge.speakers(p.dir, rel, args.speakers)
          const t = await bridge.transcript(p.dir, rel).catch(() => null)
          if (t) result = withSentences(result, t)
          return text(speakersReport(result, rel, file, 120, names))
        },
      }),
      defineTool({
        name: 'name_speakers',
        description: 'Name the voices speakers found (e.g. {"A": "Tony Stark", "C": "Ultron"}), once you know who is who (people addressing each other ' +
          'in the transcript, faces with look). The user sees the names in the transcript. Give two voices the same name when they are one person ' +
          '(diarization splits a person when the sound changes, most of all in films); an empty name clears one. Only name people you are sure of.',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative path; default the current version' })),
          names: Type.Record(Type.String(), Type.String(), { description: 'voice letter → name' }),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const rel = args.media || p.versions.find(v => v.id === p.current)!.path
          inProject(p, rel)
          const now = await bridge.nameSpeakers(p.dir, rel, args.names || {})
          return text(`Names for ${rel}: ${Object.entries(now).map(([id, n]) => `${id} = ${n}`).join(', ') || 'none'}`)
        },
      }),
      defineTool({
        name: 'find_subjects',
        description: 'Where the subject is, per shot: faces and objects (people, cars, animals, everyday things), how big, how often seen, and for a narrower ' +
          'shape (9:16 by default) a crop that follows the main subject smoothly, with its ready-made ffmpeg crop filter. Use for vertical/square ' +
          'versions, for keeping text off faces, and for knowing who/what is where without guessing from frames.',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative video; default the current version' })),
          t0: Type.Optional(Type.Number()), t1: Type.Optional(Type.Number()),
          aspect: Type.Optional(Type.Union([Type.Literal('9:16'), Type.Literal('1:1'), Type.Literal('4:5')], { description: 'the target shape; default 9:16' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const rel = args.media || p.versions.find(v => v.id === p.current)!.path
          const file = inProject(p, rel)
          if (!existsSync(VISION) || !existsSync(join(MODELS_DIR, 'faces-yunet.onnx')) || !existsSync(join(MODELS_DIR, 'objects-yolox-tiny.onnx'))) {
            const info = await probe(file), t0 = Math.max(0, args.t0 ?? 0), t1 = Math.min(info.duration, args.t1 ?? info.duration)
            const times = Array.from({ length: 6 }, (_, i) => t0 + (t1 - t0) * (i + 0.5) / 6)
            const out = join(p.dir, '.cache', 'look', `subjects-fallback-${Date.now()}.jpg`)
            await mkdir(join(p.dir, '.cache', 'look'), { recursive: true })
            await contactSheet(file, times.map(t => ({ t, label: fmt(t) })), out, { signal: api.signal })
            return imageResult('Automatic face detection is unavailable in this installation. These sampled frames are provided instead; inspect them with look and choose a stable crop. Continue the demo with compose_demo; face detection is optional. Do not invent detection coordinates.', out)
          }
          const found = await findSubjects(p.dir, file, { t0: args.t0, t1: args.t1, signal: api.signal })
          const shots = await analyze(p.dir, file, api.signal).then(a => a.shots.map(sh => ({ s: sh.s, e: sh.e })), () => [{ s: 0, e: found.info.duration }])
          const ranges = shots.map(sh => ({ s: Math.max(sh.s, found.t0), e: Math.min(sh.e, found.t1) })).filter(sh => sh.e - sh.s > 0.2)
          const [aspect, ratio] = ({ '9:16': ['9/16', 9 / 16], '1:1': ['1', 1], '4:5': ['4/5', 4 / 5] } as Record<string, [string, number]>)[args.aspect || '9:16']
          const cw = (found.info.height * ratio) / found.info.width // the crop's width as a fraction of the frame's
          const tracks = track(found.dets)
          return text(subjectsReport(rel, ranges.map(r => shotSubjects(tracks, r.s, r.e, found.fps, cw, found.dets)), { aspect, fps: found.fps, cw, file: found.file.slice(p.dir.length + 1) }))
        },
      }),
      defineTool({
        name: 'look',
        description: 'See frames of a video, labelled with their times: at given times, or `count` frames spread over t0–t1; `box` (0–1 fractions, x,y = top-left) zooms every frame ' +
          'into that region to read text or check a detail. Or see an image file in the project (`image`). Use after analyze_video, for what measurements can\'t tell.',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative video; default the current version' })),
          times: Type.Optional(Type.Array(Type.Number(), { maxItems: 16, description: 'seconds' })),
          t0: Type.Optional(Type.Number()), t1: Type.Optional(Type.Number()),
          count: Type.Optional(Type.Number({ description: 'frames between t0 and t1 (default 6, max 16)' })),
          box: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() })),
          image: Type.Optional(Type.String({ description: 'project-relative image to look at instead of a video' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const out = join(p.dir, '.cache', 'look', `${Date.now()}.jpg`)
          await mkdir(join(p.dir, '.cache', 'look'), { recursive: true })
          if (args.image) {
            const src = inProject(p, args.image)
            if (!existsSync(src)) throw new Error(`No file at ${args.image}.`)
            await new Promise<void>((ok, fail) => execFile(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-frames:v', '1',
              '-vf', 'scale=min(1568\\,iw):-2', '-q:v', '3', out], { signal: api.signal }, err => (err ? fail(new Error(`Can't read ${args.image} as an image.`)) : ok())))
            return imageResult(args.image, out)
          }
          const rel = args.media || p.versions.find(v => v.id === p.current)!.path
          const file = inProject(p, rel)
          const info = await probe(file), sample = inspectionTimes(info, args)
          if (!sample.times.length) throw new Error('Give finite frame times inside this video.')
          const guard = inspections.inspect(String(api.conversationId), rel, sample.times, args.box)
          if (guard.blocked) return { ...text('No new picture information: this moment has already been inspected repeatedly. Do not call look again for this region. For tighter trimming, use transcript word timings plus measured silence/activity and apply the planned cuts. If no safe cut is supported, keep the content and explain why.'),
            ...(guard.stop ? { control: { terminate: true } } : {}) }
          const label = (t: number) => `${t.toFixed(3)} s`
          await contactSheet(file, sample.times.map(t => ({ t, label: label(t) })), out, { box: args.box, signal: api.signal })
          return imageResult(`${rel}: ${sample.times.length} distinct frame-grid samples at ${sample.times.map(label).join(', ')}${args.box ? ' (zoomed into the box)' : ''}.${sample.note ? `\n${sample.note}` : ''}`, out)
        },
      }),
      defineTool({
        name: 'ffmpeg',
        description: 'Run the bundled ffmpeg in the project folder. Pass the arguments after "ffmpeg" (no shell quoting needed; -y is added). Paths are relative to the project folder; write outputs to renders/.',
        parameters: Type.Object({ args: Type.Array(Type.String(), { description: 'e.g. ["-i","media/a.mp4","-ss","5","-c:v","libx264","renders/cut.mp4"]' }) }),
        execute: async (args: Any, api: Any, context) => {
          const p = proj(api)
          const out = await new Promise<string>((ok, fail) => {
            const [bin, argv] = fencedExec(p, FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args.args])
            execFile(bin, argv, { cwd: p.dir, maxBuffer: 1 << 24, signal: context?.abortSignal ?? api.signal, windowsHide: true },
              (err, _o, stderr) => (err ? fail(new Error(`ffmpeg failed: ${stderr.slice(-3000) || err.message}`)) : ok(stderr.slice(-1500))))
          })
          return text(out || 'done')
        },
      }),
      defineTool({
        name: 'transcript',
        description: 'What is said in a media file, with word timings (seconds), fillers (um, uh) included. Word starts and ends are cut points already placed in the quiet around each word: cut exactly on them, no extra room needed. Made on first use; if no speech recognition is installed the user is asked to download it. ' +
          'Lines are "start–end  text" per sentence, then each word as word@start-end. Use t0/t1 to read part of a long file, search to find words.',
        parameters: Type.Object({
          media: Type.Optional(Type.String({ description: 'project-relative path; default the current version' })),
          t0: Type.Optional(Type.Number()), t1: Type.Optional(Type.Number()),
          search: Type.Optional(Type.String({ description: 'only sentences containing this (case-insensitive)' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const media = args.media || p.versions.find(v => v.id === p.current)!.path
          inProject(p, media)
          const t = await bridge.transcript(p.dir, media)
          if (!t) return text('No transcript: speech recognition is not installed.')
          const q = args.search?.toLowerCase()
          // who says each sentence, when speakers has been worked out already (never waits for it)
          const sp = await cachedSpeakers(p.dir, join(p.dir, media), p.speakers?.[media] && join(p.dir, p.speakers[media]))
          const who = sp ? speakerOfSegments(t.segments, sp.result.turns) : []
          const names = p.speakerNames?.[media] || {}
          const segs = t.segments.map((s, i) => ({ ...s, who: who[i] })).filter(s => (args.t0 == null || s.e >= args.t0) && (args.t1 == null || s.s <= args.t1) && (!q || s.text.toLowerCase().includes(q)))
          const n = (x: number) => x.toFixed(2)
          return text(`${media} · ${t.language} · ${t.model} · ${t.segments.length} sentences${sp ? ' · [speaker] before each sentence' : ''}\n` +
            segs.map(s => `${n(s.s)}–${n(s.e)}  ${s.who ? `[${nameOf(s.who, names)}] ` : ''}${s.text}\n  ${s.words.map(w => `${w.w}@${n(w.s)}-${n(w.e)}`).join(' ')}`).join('\n'))
        },
      }),
      defineTool({
        name: 'create_clip',
        description: 'Make a motion clip (title card, lower third, chart, kinetic text, explainer…) from HTML + GSAP and render it. Returns the middle frame as an image so you can check the design.',
        parameters: Type.Object({
          id: Type.String({ description: 'short kebab-case, e.g. "title-card"; reusing an id replaces that clip' }),
          title: Type.String({ description: 'what it is, e.g. "Opening title"' }),
          duration: Type.Number({ description: 'seconds' }),
          html: Type.String({ description: 'body markup + <style> + <script> using gsap (see the motion-design skill)' }),
          overlay: Type.Optional(Type.Boolean({ description: 'true for things laid OVER the footage (lower thirds, captions, callouts, logos): transparent background, placed with overlay_clip. false/omitted for full-frame cards placed with insert_clip.' })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const c = await bridge.saveClip(p.dir, args.id, args.title, args.html, args.duration, !!args.overlay)
          return clipResult(p, c)
        },
      }),
      defineTool({
        name: 'render_clip',
        description: 'Render clips/<id>/clip.html again after you edited it (read/edit tools). If the clip is in the timeline, also call rerender_timeline to propose the updated film.',
        parameters: Type.Object({ id: Type.String() }),
        execute: async (args: Any, api: Any) => { const p = proj(api); return clipResult(p, await bridge.bakeClip(p.dir, args.id)) },
      }),
      defineTool({
        name: 'insert_clip',
        description: 'Open a gap in the film at a time (seconds on the current timeline) and put a clip there; renders the film and proposes it (before/after). at = 0 for the start, at = the duration for the end.',
        parameters: Type.Object({ id: Type.String(), at: Type.Number(), title: Type.String({ description: 'the proposal title, e.g. "Opening title added"' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const v = await bridge.insertClip(p.dir, args.id, args.at, args.title)
          const tl = bridge.project(p.dir)?.versions.find(x => x.id === v)?.timeline
          return text(`Proposed as version ${v}${tl ? `: the film is now ${timelineDuration(tl).toFixed(1)} s` : ''}.`)
        },
      }),
      defineTool({
        name: 'overlay_clip',
        description: 'Lay an overlay clip (made with overlay: true) over the film from `at` seconds, for its duration or `duration`. The film keeps its length; renders and proposes it.',
        parameters: Type.Object({ id: Type.String(), at: Type.Number(), duration: Type.Optional(Type.Number()), title: Type.String({ description: 'the proposal title' }) }),
        execute: async (args: Any, api: Any) => text(`Proposed as version ${await bridge.overlayClip(proj(api).dir, args.id, args.at, args.duration, args.title)}.`),
      }),
      defineTool({
        name: 'edit_timeline',
        description: 'Change the edit at once, without rendering: the user sees and plays it straight away and can undo it (⌘Z). ' +
          'Pieces are timeline.pieces in project_state (id, where it sits in the film, which part of which file). Times are seconds of the film ' +
          'as it is before this call, so give all of a request\'s edits in one call. ' +
          'cut {from, to} takes that span out and closes the gap; with src, from/to are times in that file (e.g. word times from its transcript) and every part of the film showing them goes. ' +
          'split {at} cuts a piece in two. delete {ids}. move {id, before} puts a piece before another (no before: at the end). ' +
          'trim {id, in, out}: the part of its file a piece shows (a clip: out = its length). level {ids, db, muted}: louder or quieter (-40…+12 dB), or silent. ' +
          'insert {at, src, in, out}: a file (or part of it) put into the film at that time. The edit renders when the user exports it or saves it as a version.',
        parameters: Type.Object({
          edits: Type.Array(Type.Object({
            op: Type.Union(['cut', 'split', 'delete', 'move', 'trim', 'level', 'insert'].map(o => Type.Literal(o))),
            from: Type.Optional(Type.Number()), to: Type.Optional(Type.Number()), at: Type.Optional(Type.Number()),
            src: Type.Optional(Type.String({ description: 'cut: a file whose times from/to are; insert: the file to put in' })),
            id: Type.Optional(Type.String()), ids: Type.Optional(Type.Array(Type.String())), before: Type.Optional(Type.String()),
            in: Type.Optional(Type.Number()), out: Type.Optional(Type.Number()),
            db: Type.Optional(Type.Number()), muted: Type.Optional(Type.Boolean()),
          })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const need = (e: Any, ...keys: string[]) => { for (const k of keys) if (e[k] == null) throw new Error(`${e.op} needs ${keys.join(', ')}.`) }
          const edits = (args.edits as Any[]).map((e): Parameters<typeof batch>[1][number] => {
            switch (e.op) {
              case 'cut': need(e, 'from', 'to'); return { op: 'cut', from: e.from, to: e.to, ...(e.src ? { src: e.src } : {}) }
              case 'split': need(e, 'at'); return { op: 'split', at: e.at }
              case 'delete': return { op: 'delete', ids: e.ids || (e.id ? [e.id] : []) }
              case 'move': need(e, 'id'); return { op: 'move', id: e.id, before: e.before }
              case 'trim': need(e, 'id'); return { op: 'trim', id: e.id, in: e.in, out: e.out }
              case 'level': return { op: 'level', ids: e.ids || (e.id ? [e.id] : []), db: e.db, muted: e.muted }
              case 'insert': {
                need(e, 'at', 'src')
                const info = p.media[e.src]
                if (!info) throw new Error(`${e.src} is not in the project.`)
                return { op: 'insert', at: e.at, src: e.src, in: e.in ?? 0, out: e.out ?? info.duration }
              }
              default: throw new Error(`Unknown op ${e.op}.`)
            }
          })
          const after = await bridge.editTimeline(p.dir, batch(p.timeline!, edits))
          const tl = after.timeline!
          return text(`The edit is now ${timelineDuration(tl).toFixed(2)} s (not rendered; the user can undo):\n${piecesOf(tl).join('\n')}`)
        },
      }),
      defineTool({
        name: 'rerender_timeline',
        description: 'Render the current timeline (the edit) and propose it: after a clip in it changed, or to turn an edit not rendered yet (timeline.edited) into a version.',
        parameters: Type.Object({ title: Type.String() }),
        execute: async (args: Any, api: Any) => text(`Proposed as version ${await bridge.rerenderTimeline(proj(api).dir, args.title)}.`),
      }),
      defineTool({
        name: 'set_mix',
        description: 'Set the film\'s mix: its own audio level (dB), and optional background music (an audio file already in the project, e.g. media/song.mp3) with its level and how far it dips under speech. Music loops to the film\'s length with a 1 s fade in and 2 s fade out. Applies at once (the user hears it and can undo from History).',
        parameters: Type.Object({
          film_db: Type.Number({ description: '0 = as is; e.g. -3 quieter, +3 louder' }),
          music: Type.Optional(Type.Object({
            src: Type.String({ description: 'project-relative audio file' }),
            db: Type.Number({ description: 'music level, typically -18 to -10 under speech-heavy films' }),
            duck_db: Type.Number({ description: 'how far the music dips while someone speaks; 8–14 is natural, 0 = no ducking' }),
          })),
        }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const mix = { filmDb: args.film_db, ...(args.music ? { music: { src: args.music.src, db: args.music.db, duckDb: args.music.duck_db } } : {}) }
          if (mix.music && !p.media[mix.music.src]) throw new Error(`${mix.music.src} is not in the project; the user can add music with Add media.`)
          return text(await bridge.setMix(p.dir, mix))
        },
      }),
      defineTool({
        name: 'export_video',
        description: 'Export the version on screen as a finished MP4 into the project\'s exports/ folder: a size preset (original, landscape 16:9, vertical 9:16 for Shorts/Reels/TikTok, square 1:1) and captions from the transcript (burned in, or an .srt file next to it).',
        parameters: Type.Object({
          preset: Type.Union([Type.Literal('original'), Type.Literal('landscape'), Type.Literal('vertical'), Type.Literal('square')]),
          fit: Type.Optional(Type.Union([Type.Literal('pad'), Type.Literal('crop')], { description: 'other shapes: blurred fill behind the picture (pad, default) or centre crop' })),
          captions: Type.Union([Type.Literal('none'), Type.Literal('burn'), Type.Literal('srt')]),
          caption_color: Type.Optional(Type.String({ description: '#rrggbb, default white; follow the user\'s remembered caption style' })),
        }),
        execute: async (args: Any, api: Any) => {
          const r = await bridge.exportFilm(proj(api).dir, { preset: args.preset, fit: args.fit, captions: args.captions, captionColor: args.caption_color })
          return text(`Exported ${r.file}${r.srt ? ` and ${r.srt}` : ''}.`)
        },
      }),
      defineTool({
        name: 'propose_version',
        description: 'Show a finished cut to the user as a before/after against the current version, with Accept / Reject.',
        parameters: Type.Object({ path: Type.String({ description: 'the rendered file, relative to the project folder' }), title: Type.String({ description: 'short, e.g. "Ums removed"' }) }),
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const abs = inProject(p, args.path)
          if (!existsSync(abs)) throw new Error(`${args.path} does not exist`)
          const id = await bridge.proposeVersion(p.dir, abs, args.title)
          return text(`Proposed as version ${id}. The user will accept or reject it.`)
        },
      }),
      defineTool({
        name: 'resolve_note',
        description: 'Mark a note as handled, with a one-line reply the user sees on the note.',
        parameters: Type.Object({ id: Type.String(), reply: Type.String() }),
        execute: async (args: Any, api: Any) => { await bridge.resolveNote(proj(api).dir, args.id, args.reply); return text('resolved') },
      }),
      defineTool({
        name: 'seek',
        description: 'Move the playhead (seconds) to show the user a moment.',
        parameters: Type.Object({ t: Type.Number() }),
        execute: async (args: Any, api: Any) => { bridge.seek(proj(api).dir, args.t); return text(`playhead → ${fmt(args.t)}`) },
      }),
      defineTool({
        name: 'ask_user',
        description: 'Ask the user to decide, with options shown as buttons. One question: question + options (multiple: true for checkboxes, e.g. which fixes ' +
          'to apply). Several things at once (type of video, platform, length, style…): questions, up to 4, answered together in one card. ' +
          'Put the option you recommend first, with "(recommended)" in its label, and say in each description what the user gets. ' +
          'The card always offers "You decide" (then use your recommendations) and the user can type their own answer instead. ' +
          'Ends your turn; the answer arrives as the next message.',
        parameters: Type.Object({
          question: Type.Optional(Type.String()),
          options: Type.Optional(Type.Array(Option, { minItems: 1, maxItems: 8 })),
          multiple: Type.Optional(Type.Boolean({ description: 'let the user pick several (checkboxes); all start ticked' })),
          questions: Type.Optional(Type.Array(Type.Object({
            question: Type.String(),
            options: Type.Array(Option, { minItems: 2, maxItems: 6 }),
            multiple: Type.Optional(Type.Boolean({ description: 'checkboxes; none start ticked' })),
          }), { minItems: 1, maxItems: 4 })),
        }),
        execute: async (args: Any) => {
          if (!args.questions?.length && !(args.question && args.options?.length)) throw new Error('Give question + options, or questions.')
          return { content: [{ type: 'text' as const, text: 'The question is on screen; wait for the answer.' }], control: { terminate: true } }
        },
      }),
    ],
  })
}

function memoryExtension(memory: Memory) {
  return defineExtension({
    name: 'memory',
    sections: [section('memory', () => memory.prompt())],
    tools: [
      defineTool({
        name: 'remember',
        description: 'Save or update one long-term memory: a preference, rule, correction or fact the user taught you that should hold in future projects.',
        parameters: Type.Object({
          name: Type.String({ description: 'short kebab-case slug' }),
          description: Type.String({ description: 'one line, used to decide when it is relevant' }),
          body: Type.String({ description: 'the fact, then **Why:** and **How to apply:**' }),
        }),
        execute: async (args: Any) => text(`Saved memory "${memory.remember(args.name, args.description, args.body)}".`),
      }),
      defineTool({
        name: 'forget',
        description: 'Delete a long-term memory that turned out to be wrong or that the user asked you to drop.',
        parameters: Type.Object({ name: Type.String() }),
        execute: async (args: Any) => { memory.forget(args.name); return text(`Forgot "${args.name}".`) },
      }),
    ],
  })
}

/** The agent's browser: which one its bsk commands reach (Settings → Browser) and bringing downloads into the project. */
export function browserExtension(bridge: Bridge, dirOf: (convId: string) => string, prompt: () => string) {
  return defineExtension({
    name: 'browser',
    sections: [section('browser', () => prompt(), { tag: false })],
    tools: [
      defineTool({
        name: 'import_media',
        description: 'Add a file in the project folder (e.g. one you downloaded to downloads/) to the project\'s media, so it can be used in the edit. ' +
          'A folder or .zip adds every file in it. Returns each new path in media/ and what the file is.',
        parameters: Type.Object({ path: Type.String({ description: 'relative to the project folder, e.g. downloads/music.mp3' }) }),
        execute: async (args: Any, api: Any) => {
          const dir = dirOf(api.conversationId)
          if (!dir || !bridge.project(dir)) throw new Error('This project is not open.')
          const abs = resolve(dir, args.path)
          if (!isWithinDir(dir, abs)) throw new Error('The file must be inside the project folder (download it to downloads/ first).')
          if (!existsSync(abs)) throw new Error(`No file at ${args.path}.`)
          return text(`Added:\n${(await bridge.importFiles(dir, abs)).join('\n')}`)
        },
      }),
      defineTool({
        name: 'walkthrough_record',
        description: 'Film the page your bsk session drives, for a product walkthrough (read the product-walkthrough skill first). ' +
          'start (with session): one continuous take of that tab (its viewport becomes 1280×720). ' +
          'step: the next step begins now (title = what it shows; it gets one narration line later). ' +
          'type: type into the focused field a key at a time, as a person does (focus it with bsk click first; bsk fill would make the text appear at once). ' +
          'scroll: scroll smoothly (dy in CSS px, positive is down; x,y to scroll a panel under that point). move: glide the pointer to x,y (shows hover states). ' +
          'pause / resume: stop filming around sign-ins, passwords and private pages. stop: end the take; returns its steps. ' +
          'Do everything else with bsk as usual. Time spent thinking between actions is cut later, so take the time you need.',
        parameters: Type.Object({
          action: Type.Union(['start', 'step', 'type', 'scroll', 'move', 'pause', 'resume', 'stop'].map(s => Type.Literal(s))),
          session: Type.Optional(Type.String({ description: 'start: your bsk session id' })),
          title: Type.Optional(Type.String({ description: 'step: what this step shows, e.g. "Create a project"' })),
          text: Type.Optional(Type.String({ description: 'type: the text; \\n presses Enter' })),
          enter: Type.Optional(Type.Boolean({ description: 'type: press Enter after the text' })),
          dy: Type.Optional(Type.Number({ description: 'scroll: CSS px, positive is down' })),
          x: Type.Optional(Type.Number({ description: 'move/scroll: viewport CSS px' })),
          y: Type.Optional(Type.Number()),
        }),
        execute: async (args: Any, api: Any) => {
          const dir = dirOf(api.conversationId)
          if (!dir || !bridge.project(dir)) throw new Error('This project is not open.')
          if (args.action === 'start') {
            if (!args.session) throw new Error('start needs your bsk session id (bsk session start --json).')
            const r = await bridge.startTake(dir, { session: args.session })
            return text(`Recording take ${r.id}${r.capture === 'screenshots' ? ' (through bsk screenshots, about 10 frames a second)' : ''}: the tab's viewport is ${r.viewport.width}×${r.viewport.height}. ` +
              `Observe again (the viewport changed), then mark the first step with action step before acting.`)
          }
          if (args.action === 'stop') {
            const t = await bridge.stopTake(dir)
            const counts = (a: number, b: number) => t.events.filter(e => e.t >= a && e.t < b && e.k !== 'move' && e.k !== 'scroll').length
            const steps = t.steps.length ? t.steps.map((s, i) => `${i + 1}. ${s.t.toFixed(1)} s · ${s.title} (${counts(s.t, t.steps[i + 1]?.t ?? t.duration)} actions)`)
              : ['(no steps were marked: the whole take is one step)']
            return text(`Take ${t.id}: ${t.duration.toFixed(1)} s recorded${t.paused.length ? `, ${t.paused.length} paused stretch(es) left out` : ''}.\n${steps.join('\n')}\n` +
              `Next: one narration line per step, in this order (what the viewer sees and why it matters; "" for a step said nothing over), then compose_walkthrough.`)
          }
          const halted = bridge.browserHalted()
          if (halted) throw new Error(halted)
          const r = bridge.take(dir)
          if (!r) throw new Error('No take is recording in this project: start one first.')
          switch (args.action) {
            case 'step': return text(`Step ${r.step(String(args.title || ''))} begins at ${r.now().toFixed(1)} s of the take.`)
            case 'pause': await r.pause(); return text('Paused: nothing is filmed until resume.')
            case 'resume': await r.resume(); return text('Filming again.')
            case 'type':
              if (!args.text) throw new Error('type needs text.')
              await r.type(String(args.text), { enter: args.enter })
              return text(`Typed ${String(args.text).length} characters.`)
            case 'scroll':
              if (!args.dy) throw new Error('scroll needs dy.')
              await r.scroll(Number(args.dy), { x: args.x, y: args.y })
              return text('Scrolled. Observe again before the next action.')
            case 'move':
              if (args.x == null || args.y == null) throw new Error('move needs x and y.')
              await r.move(Number(args.x), Number(args.y))
              return text('Moved the pointer.')
          }
          throw new Error(`Unknown action ${args.action}.`)
        },
      }),
      defineTool({
        name: 'compose_walkthrough',
        description: 'Make the walkthrough film from a take and propose it: voices one narration line per step (lines said the same way before keep their voice; ' +
          'new lines cost the user money as generate_voice does), cuts the idle time, speeds through long loads, holds a step until its line is said, ' +
          'zooms in on what is being done, and draws a cursor gliding into each click with a ripple. The defaults are the good ones: pass pace or zoom only ' +
          'when the user asks for a change ("too slow" → tight, "less zoom" → subtle). Call again to change it; nothing is filmed again.',
        parameters: Type.Object({
          take: Type.String({ description: 'the take id from walkthrough_record stop' }),
          narration: Type.Array(Type.String(), { description: 'one line per step, in the take\'s step order; "" for a step with nothing said' }),
          title: Type.String({ description: 'the proposal title, e.g. "Walkthrough: creating your first board"' }),
          voice: Type.Optional(Type.String({ description: `one of: ${Object.keys(VOICES).join(', ')} (default guide)` })),
          style: Type.Optional(Type.String({ description: 'only when the user asks for a delivery, e.g. "excited"' })),
          pace: Type.Optional(Type.Union([Type.Literal('natural'), Type.Literal('tight')], { description: 'natural (default)' })),
          zoom: Type.Optional(Type.Union([Type.Literal('on'), Type.Literal('subtle'), Type.Literal('off')], { description: 'on (default)' })),
          skip: Type.Optional(Type.Array(Type.Number(), { description: 'step numbers (1-based) to leave out, e.g. one that went wrong and was done again' })),
        }),
        execute: async (args: Any, api: Any) => {
          const dir = dirOf(api.conversationId)
          if (!dir || !bridge.project(dir)) throw new Error('This project is not open.')
          const r = await bridge.composeWalkthrough(dir, {
            take: args.take, narration: args.narration, voice: args.voice || 'guide', style: args.style, pace: args.pace, zoom: args.zoom, skip: args.skip,
          }, args.title, api.signal)
          return text({ ...r, instruction: 'Proposed. look at two or three moments (a click, some typing, a step change) and fix a real problem only. ' +
            'Then tell the user in two or three short lines: its length and what it shows. No list of settings or options: ' +
            'they will say what they want changed, in their own words.' })
        },
      }),
    ],
  })
}

function skillsExtension(skills: Skills) {
  return defineExtension({
    name: 'skills',
    sections: [section('skills', () => skills.prompt() || undefined)],
    tools: [],
  })
}

export type AgentHandle = Awaited<ReturnType<typeof startAgent>>

export async function startAgent(opts: {
  dbPath: string; bridge: Bridge; memory: Memory; skills: Skills; onEvent: (dir: string, e: BaseEvent) => void
  /** Extra environment for the agent's shell, read at each command (which bsk / daemon it reaches). */
  shellEnv?: () => Record<string, string>
  /** The browser section of the instructions, for the current setting. */
  browserPrompt?: () => string
  /** Fence the agent's files and shell to the project (and these). Without it, nothing is fenced (tests). */
  fence?: FenceConfig
}) {
  const models = createModels({ authContext: { env: async (n: string) => process.env[n], fileExists: async (p: string) => existsSync(p) } })
  for (const p of [anthropicProvider, googleProvider, openaiProvider, manulProvider]) models.setProvider(p())
  // custom providers (Azure AI Foundry, gateways, local servers): rebuilt when they or their keys change
  let custom: string[] = []
  const loadCustom = () => {
    for (const id of custom) models.deleteProvider(id)
    const built = buildProviders()
    for (const p of built) models.setProvider(p as any)
    custom = built.map(p => p.id)
  }
  loadCustom()

  const convDir = new Map<string, string>() // conversation id → project dir
  const demoBriefs = new DemoBriefs()
  const inspections = new InspectionGuard()
  const registry = createRegistry()
  const dirOf = (id: string) => convDir.get(String(id)) || ''
  for (const ext of [codingExtension(), editorExtension(opts.bridge, dirOf, opts.fence, demoBriefs, inspections), memoryExtension(opts.memory), skillsExtension(opts.skills),
    ...(opts.browserPrompt ? [browserExtension(opts.bridge, dirOf, opts.browserPrompt)] : [])]) registry.install(ext)
  const shellEnv = opts.shellEnv ? liveEnv(opts.shellEnv) : undefined

  const harness = await Harness.open(await openNodeSqliteStorage(opts.dbPath), {
    models, registry,
    env: ({ cwd }: Any) => {
      const dir = cwd ?? process.cwd()
      const fence: Fence = opts.fence ? fenceFor({ project: dir, ...opts.fence }) : { rw: ['/'], ro: [] }
      return new FencedEnv({ cwd: dir, shellEnv }, fence, { home: homedir(), fenceBin: opts.fence ? join(BIN, 'manul-fence') : undefined }, !!opts.fence)
    },
  } as any, ctx)
  harness.resume() // finish any run a crash or quit left unfinished

  const available = async () => (await models.getAvailable().catch(() => [])) as unknown as { provider: string; id: string }[]
  /** The project's picked model when its key is set, else the best available. */
  const pickModel = async (dir?: string) => chooseModel(await available(), dir ? opts.bridge.project(dir)?.model : undefined)

  const live = new Map<string, { conv: Any; off: () => void; view: Any; adapter: AguiAdapter }>()
  // Other viewers of a project's conversation (the phone): each gets its own adapter, so one (re)connecting replays
  // only to itself. They outlive the conversation and follow the project to whichever one it opens next.
  type Viewer = { emit: (e: BaseEvent) => void; off?: () => void }
  const viewers = new Map<string, Set<Viewer>>()

  function watch(dir: string, v: Viewer) {
    v.off?.()
    const l = live.get(dir)
    if (!l) { v.off = undefined; return }
    const adapter = new AguiAdapter(String(l.conv.id), v.emit)
    v.off = l.view.subscribe((s: Any) => adapter.update(s))
    adapter.replay(l.view.value)
  }

  /** Show a project's conversation (the given one, the open one, or a new one); the renderer gets a full replay. */
  async function open(dir: string, convId?: string, fresh = false) {
    const l = live.get(dir)
    if (l && !fresh && (convId == null || String(l.conv.id) === String(convId))) { l.adapter.replay(l.view.value); return String(l.conv.id) }
    if (l) detach(dir)
    const model = await pickModel(dir)
    let conv: Any | undefined = convId && !fresh ? await harness.conversation(Number(convId) as any, ctx).catch(() => undefined) : undefined
    if (!conv) conv = await harness.createConversation({ ownership: { kind: 'ownerless' }, agent: { ...(model ? { model } : {}), cwd: dir } } as any, ctx)
    else if (model) await conv.configure({ model, cwd: dir }, ctx)
    convDir.set(String(conv.id), dir)
    const view = await conv.viewState(ctx)
    const adapter = new AguiAdapter(String(conv.id), e => opts.onEvent(dir, e))
    const off = view.subscribe((v: Any) => adapter.update(v))
    live.set(dir, { conv, off, view, adapter })
    adapter.replay(view.value)
    for (const v of viewers.get(dir) || []) watch(dir, v)
    return String(conv.id)
  }

  function detach(dir: string) {
    const l = live.get(dir)
    if (!l) return
    for (const v of viewers.get(dir) || []) { v.off?.(); v.off = undefined }
    l.off(); l.view.dispose?.(); live.delete(dir)
  }

  return {
    open,
    /** Start a new conversation in a project (the old ones stay, durable). */
    newConversation: (dir: string) => open(dir, undefined, true),
    current: (dir: string) => (live.has(dir) ? String(live.get(dir)!.conv.id) : undefined),
    /**
     * Follow a project's conversation as AG-UI events, with a full replay now if it is open (else once it opens) and
     * again whenever it switches conversation. Independent of onEvent and of every other viewer. Returns unsubscribe.
     */
    subscribe(dir: string, emit: (e: BaseEvent) => void) {
      const v: Viewer = { emit }
      if (!viewers.has(dir)) viewers.set(dir, new Set())
      viewers.get(dir)!.add(v)
      watch(dir, v)
      return () => {
        v.off?.()
        const set = viewers.get(dir)
        set?.delete(v)
        if (set?.size === 0) viewers.delete(dir)
      }
    },
    hasModel: async () => !!(await pickModel()),
    model: (dir?: string) => pickModel(dir),
    models: async () => describeModels(await available(), Object.fromEntries(listProviders().map(p => [p.id, p.name]))),
    /** keys or custom providers changed: built-in models are re-read on every use, custom providers are rebuilt */
    keysChanged: loadCustom,
    async send(dir: string, content: string | Any[]) {
      const l = live.get(dir)
      if (!l) throw new Error('This project is not open.')
      const model = await pickModel(dir)
      if (!model) throw new Error('Add an API key first (Settings → Keys).')
      const inputText = typeof content === 'string' ? content : content.filter(c => c.type === 'text').map(c => c.text || '').join('\n')
      demoBriefs.input(String(l.conv.id), inputText.split(ATTACHED)[0])
      inspections.reset(String(l.conv.id))
      await l.conv.configure({ model, cwd: dir }, ctx)
      await l.conv.submit({ type: 'input', content, whenBusy: 'steer' }, ctx)
    },
    async stop(dir: string) { await live.get(dir)?.conv.abort(ctx) },
    close: detach,
    async shutdown() { for (const d of [...live.keys()]) this.close(d); await harness.close(ctx) },
  }
}
