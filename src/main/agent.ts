// Manul's agent: a pi-durable Harness on SQLite, so conversations, tool calls and their output survive a crash or quit.
// One durable conversation per project. Every view change goes through the AG-UI adapter to the renderer.
// Extensions:
//   coding   read / write / edit / bash in the project folder (bundled ffmpeg and ffprobe are on PATH)
//   editor   Manul's own tools: project state, probe, ffmpeg, propose a version, seek, resolve a note, ask the user
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context'
import { Type } from '@earendil-works/pi-ai'
import { createModels } from '@earendil-works/pi-ai/models'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { googleProvider } from '@earendil-works/pi-ai/providers/google'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'
import { createRegistry, defineExtension, defineTool, Harness, section } from '@earendil-works/pi-durable'
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node'
import { CodingTools } from '@earendil-works/pi-durable/tools'
import type { BaseEvent } from '@ag-ui/core'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, resolve, sep } from 'node:path'
import { AguiAdapter } from './agui'
import { liveEnv } from './bsk'
import { chooseModel, describeModels } from './models'
import { buildProviders, listProviders } from './providers'
import { manulProvider } from './gateway'
import type { Memory } from './memory'
import type { Skills } from './skills'
import { BIN, FFMPEG, FONTS_DIR, MODELS_DIR, VISION, probe } from './media'
import { FencedEnv, fencedArgv, fenceFor, realish, type Fence } from './fence'
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
import { join } from 'node:path'
import { batch, duration as timelineDuration, sameCut, starts, timelineOfFile, type Edit, type Timeline } from '../shared/timeline'
import type { ClipInfo, Project, Transcript } from '../shared/types'

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
}

const MOTION_POINTER = `Motion clips (title cards, lower thirds, kinetic text, charts…) are HTML + GSAP that Manul renders frame-exact: ` +
  `full-frame cards go between shots with insert_clip; lower thirds, captions, callouts and logos are made with overlay: true and laid over ` +
  `the footage with overlay_clip. Read the motion-design skill first when it is enabled.`

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
    const real = realish(abs), root = realish(p.dir)
    if (real !== root && !real.startsWith(root + sep)) throw new Error('Paths must stay inside the project folder.')
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
      `- Edit with the ffmpeg tool (bundled; also on PATH for bash). Read the current version, write new files to renders/. Never overwrite media/.\n` +
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
      `Write replies in short plain Markdown. Say what you did, not how.\n\n` + MOTION_POINTER, { tag: false })],
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
        execute: async (args: Any, api: Any) => {
          const p = proj(api)
          const out = await new Promise<string>((ok, fail) => {
            const [bin, argv] = fencedExec(p, FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args.args])
            execFile(bin, argv, { cwd: p.dir, maxBuffer: 1 << 24, signal: api.signal },
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
          const abs = isAbsolute(args.path) ? args.path : resolve(dir, args.path)
          if (!abs.startsWith(dir + '/')) throw new Error('The file must be inside the project folder (download it to downloads/ first).')
          if (!existsSync(abs)) throw new Error(`No file at ${args.path}.`)
          return text(`Added:\n${(await bridge.importFiles(dir, abs)).join('\n')}`)
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
  for (const ext of [CodingTools, editorExtension(opts.bridge, dirOf, opts.fence, demoBriefs, inspections), memoryExtension(opts.memory), skillsExtension(opts.skills),
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
    return String(conv.id)
  }

  function detach(dir: string) { const l = live.get(dir); if (l) { l.off(); l.view.dispose?.(); live.delete(dir) } }

  return {
    open,
    /** Start a new conversation in a project (the old ones stay, durable). */
    newConversation: (dir: string) => open(dir, undefined, true),
    current: (dir: string) => (live.has(dir) ? String(live.get(dir)!.conv.id) : undefined),
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
