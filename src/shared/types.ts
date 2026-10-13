// Types shared by the main process, the preload bridge and the renderer.
import type { Timeline } from './timeline'

/** A box on the frame, in 0–1 fractions of the picture (so it survives any player size). */
export type Box = { x: number; y: number; w: number; h: number }

/** Where a note points: a time or range, optionally a box on the frame. */
export type Anchor = { t0: number; t1?: number; box?: Box; clip?: { id: string; element?: string } }

export type Note = {
  id: string
  anchor: Anchor
  text: string
  /** Project-relative path of the frame still sent to the agent (box drawn on it). */
  still?: string
  status: 'open' | 'resolved'
  /** The agent's one-line answer when it resolved the note. */
  reply?: string
  createdAt: number
}

/** One cut of the film. The first is the imported source; the agent's renders add more. */
export type Version = {
  id: string
  /** Project-relative media path. */
  path: string
  title: string
  createdAt: number
  by: 'import' | 'agent' | 'user'
  /** The timeline this version was rendered from (accepting it makes it the project's timeline). */
  timeline?: Timeline
  /** When the version has a mix: the same film before mixing (picture + its own sound), which the player uses so the
   *  live mix can change levels without stacking on the rendered mix. */
  dry?: string
}

/** A motion clip: agent-made HTML + GSAP in clips/<id>/, rendered frame-exact to clip.mp4. */
export type ClipInfo = { id: string; title: string; duration: number; video: string; poster: string; updatedAt: number; /** transparent, laid over the footage */ overlay?: boolean }

export type MediaInfo = {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  codec: string
  bitrate?: number
  pixfmt?: string
}

/** Subtitles chosen for a video: the file, and (once there is a transcript) the share of its lines heard in the
 *  speech and how far its times are off (seconds; positive = the subtitles come late). */
export type SubtitleLink = { file: string; match?: number; offset?: number }

/** What a file the user added is, so the agent knows how to use it. */
export type FileKind = 'video' | 'audio' | 'image' | 'subtitles' | 'text' | 'font' | 'lut' | 'other'

export type FileInfo = {
  kind: FileKind
  size: number
  addedAt: number
  /** One line on what is in it (cues and span, size, font family…), for the user and the agent. */
  summary: string
  /** Fonts: the family name (ASS Fontname, what libass matches) and style. */
  font?: { family: string; style: string }
}

export type Project = {
  id: string
  title: string
  dir: string
  createdAt: number
  versions: Version[]
  /** Id of the version on screen. */
  current: string
  /** A version the agent proposed and the user has not accepted or rejected yet. */
  proposal?: string
  notes: Note[]
  media: Record<string, MediaInfo>
  /** Every file the user (or the agent) added, under media/: what each is. */
  files?: Record<string, FileInfo>
  /** What the film is made of (media segments and motion clips); rendering it makes a version. */
  timeline?: Timeline
  /** Motion clips by id. */
  clips?: Record<string, ClipInfo>
  /** media path → its light preview copy (project-relative), for footage too heavy to play smoothly */
  proxies?: Record<string, string>
  /** media path → transcript path (both project-relative) */
  transcripts?: Record<string, string>
  /** media path → its diarization (who speaks when), project-relative */
  speakers?: Record<string, string>
  /** media path → the names given to its voices (A → "Tony"); the same name on two voices makes them one person */
  speakerNames?: Record<string, Record<string, string>>
  /** media path → the subtitles that go with it, and how well they match what's said */
  subtitles?: Record<string, SubtitleLink>
  /** The model the user picked for this project (else the best available). */
  model?: { provider: string; modelId: string }
  /** The project's durable agent conversation on screen. */
  conversation?: string
  /** Every conversation in this project (newest last); titles come from the first message. */
  conversations?: { id: string; title: string; createdAt: number }[]
  /** A motion video made from nothing (no footage): it starts on a blank canvas in this format, which the agent replaces
   *  with its scenes. example: the gallery example it started from (its prompt is the brief, its video the reference);
   *  reference: a video (in media/) whose style to take, never its content. */
  motion?: { aspect: '16:9' | '9:16' | '1:1'; length?: number; example?: { id: string; title: string; handle: string; post?: string }; reference?: string; canvas: string }
}

/** A motion example in the gallery (from prompt-motion.com): the video, who made it, and the prompt or skill behind it.
 *  Ids and tag slugs are the site's own. */
export type GalleryExample = {
  id: string
  title: string
  creator: { name: string; handle: string; url?: string }
  /** The maker's post on X. */
  post?: string
  /** The example's page on prompt-motion.com. */
  source: string
  kind: 'prompt' | 'skill'
  prompt?: string
  skill?: string
  tags: { name: string; slug: string }[]
  width?: number
  height?: number
  date?: string
  /** seconds */
  duration?: number
  sound?: boolean
  /** manul://gallery URLs */
  video: string
  poster: string
}

export type RecentProject = { id: string; title: string; dir: string; openedAt: number; thumb?: string }

export type KeyInfo = { env: string; label: string; unlocks: string[]; hint: string; set: boolean }
/** Who is signed in to Manul (never their key), and whether this build can sign in at all. */
export type AccountStatus = { email?: string; available: boolean }

export type ToolStatus = { name: string; version?: string; path?: string; bundled: boolean; ok: boolean }

/** A tool Manul downloads only when it is first needed. */
export type OnDemandTool = {
  id: string
  name: string
  description: string
  /** Approximate download + install size, for the consent card. */
  sizeMB: number
  installed: boolean
  /** Bytes on disk when installed. */
  diskBytes?: number
  version?: string
  /** Other tools it needs (installed first, same consent). */
  needs?: string[]
}

export type Job = {
  id: string
  title: string
  /** Shown once it finished, e.g. "Installed Whisper". */
  doneTitle?: string
  kind: 'download' | 'install' | 'transcribe' | 'speakers' | 'render' | 'import'
  project?: string
  status: 'running' | 'done' | 'failed'
  /** 0–1, or null when there is no estimate */
  progress: number | null
  detail?: string
  startedAt: number
  endedAt?: number
}

/** A permission card: the agent (or the app) waits until the user answers. */
export type ConsentRequest = { id: string; project?: string; title: string; body: string; sizeMB?: number; confirm: string }

/**
 * Which speech-to-text engine Manul uses, in order of preference when nothing is set:
 *   system   whisper.cpp already on this computer (whisper-cli + a ggml model): found automatically or set by the user
 *   bundled  Manul's own whisper.cpp, with the base model downloaded on first use
 *   managed  faster-whisper in a Python environment Manul downloads (for platforms without a bundled build)
 * mode "auto" re-detects the system engine when its saved paths disappear; "custom" keeps the user's paths as they are.
 */
export type WhisperConfig = {
  engine: 'system' | 'bundled' | 'managed'
  mode: 'auto' | 'custom'
  binary?: string
  model?: string
}

/** What the Tools dialog shows about speech recognition. */
export type WhisperStatus = {
  config?: WhisperConfig
  /** The engine that would run right now, or null when one must be installed first. */
  active: { engine: 'system' | 'bundled' | 'managed'; binary?: string; model?: string; label: string } | null
  /** whisper.cpp binaries and models found on this computer. */
  found: { binaries: string[]; models: string[] }
  managedInstalled: boolean
  /** Manul ships whisper.cpp for this platform (the model may still need downloading). */
  bundledBinary: boolean
  bundledReady: boolean
}

export type Word = { w: string; s: number; e: number; p?: number }
export type Segment = { s: number; e: number; text: string; words: Word[] }
export type Transcript = { media: string; language: string; model: string; segments: Segment[]; createdAt: number }

// ---------------------------------------------------------------- the agent's browser
export type BrowserTab = { id: number; title: string; url: string; loading: boolean; agent: boolean; canBack: boolean; canForward: boolean }
export type BrowserState = { tabs: BrowserTab[]; active: number | null; bsk: { connected: boolean; status: string } }
/** manul: Manul's own browser with its private bsk (default). chrome: the user's own Chrome through their bsk. */
export type BrowserMode = 'manul' | 'chrome'
/** What Settings → Browser shows about the user's own Chrome bsk. */
export type ChromeBsk = { cli: string | null; daemon: boolean; browsers: { id: string; label: string }[] }
