<p align="center">
  <img src="build/icons/256x256.png" width="88" alt="Manul">
</p>

<h1 align="center">Manul Roadmap</h1>

<p align="center">
  <b>Where Manul is going, and what's done so far.</b><br>
  This is the shared plan: anyone can add to it. <a href="#how-to-contribute">How to contribute ↓</a>
</p>

<p align="center">
  <a href="README.md">README</a> &nbsp;·&nbsp; <a href="#1-vision">Vision</a> &nbsp;·&nbsp; <a href="#5-phases">Phases</a> &nbsp;·&nbsp; <a href="#6-business-model">Business model</a> &nbsp;·&nbsp; <a href="#7-open-questions-">Open questions</a>
</p>

> **Manul** is an agentic video editor, named after the Pallas cat.
> Drop in a video, say what you want, and it does it. Then you leave notes right on the picture and it fixes them.

## At a glance

| Phase | Progress | ✅ Done | 🚧 Doing | ⬜ Next |
|---|---|:-:|:-:|:-:|
| [**0 · Foundations**](#phase-0-foundations) | `██████░░░░` 55% | 5 | 1 | 4 |
| [**1 · MVP (v0.1)**](#phase-1-mvp-v01) | `████████░░` 76% | 14 | 4 | 3 |
| [**2 · Generated shots, hand-off, publishing**](#phase-2-generated-shots-hand-off-publishing) | `░░░░░░░░░░` 0% | 0 | 0 | 9 |
| [**3 · Manul key and Pro**](#phase-3-manul-key-and-pro) | `░░░░░░░░░░` 0% | 0 | 0 | 5 |
| [**4 · Cloud, mobile, teams**](#phase-4-cloud-mobile-teams) | `░░░░░░░░░░` 0% | 0 | 0 | 7 |

<sub>✅ done &nbsp;·&nbsp; 🚧 in progress &nbsp;·&nbsp; ⬜ not started &nbsp;·&nbsp; 💬 open question &nbsp;·&nbsp; progress counts 🚧 as half</sub>

---

## 1. Vision

Most editing time is spent **watching, reacting and fixing**, not dragging clips on tracks. Manul makes that loop the
whole product:

**Drop a video → say what you want → watch it happen → comment on the picture → export.**

Who it's for: anyone who makes video (creators, podcasters, marketers, small teams). It is not only for professional editors, although
pro editors can take a Manul rough cut into their own editor.

## 2. Product principles

1. **The film is the main thing on screen.** The agent is a collaborator you talk to about a moment, not a chat sidebar.
2. **Feedback is anchored.** Every note is pinned to a time range, a box on the frame, or a specific element. The agent
   answers with a **before/after** you can scrub and then accept or reject.
3. **One history.** Hand edits and agent edits land in the same history (undo, compare, revert).
4. **Reveal complexity only when asked.** The tracks timeline, the mix and the inspector exist, but you open them; they aren't always on.
5. **Drop media anywhere.** Drop on the picture to replace a shot, on the timeline to insert, on a note to say "use this here".
6. **Ask before anything costly.** Big downloads, missing keys and costly steps pause and ask with a card. No surprises.
7. **Local first.** Everything works on your machine with your own keys. The cloud is optional and paid.
8. **Your footage is the film.** Generated shots go only where you ask for one (a b-roll, a frame extended, a boxed
   spot filled in), and each one is labelled as generated in the history and the export.

## 3. Core experience (v1)

- **Start screen:** drop a video or paste a link, and type what you want in the same box. While you type, Manul reads the
  file details (ffprobe), makes a lighter preview copy, transcribes, and splits the footage into scenes.
- **Screen view (main):** a full-bleed player, notes pinned on the scrubber, and the agent's input anchored to the
  playhead.
- **Notes on the picture**, in three ways, from most to least precise:
  1. click an element (label, title, photo…);
  2. draw a box on the frame over a time range;
  3. timestamp or range only, as the fallback.

  The agent receives your words, the range, the box or element, a still of the frame with the box drawn on it, and
  the transcript line spoken there.
- **HTML motion clips (the agent makes footage):** the agent can build slides, title cards, charts, kinetic type and
  full motion-design sequences as HTML + **GSAP** (`clip.html`). These sit on the timeline next to MP4s and images, and the final
  export renders everything into one video. A whole video can be made of motion clips, with no camera footage at all.
  - **Make room anywhere:** split the timeline at a point and open a gap (everything after shifts right), then ask
    "add a motion clip here explaining X".
  - **Edit by hand:** every text, image and shape in a clip can be dragged, resized and edited right on the
    picture. Changes are written back into the clip's HTML.
  - **Edit with the agent:** click an element in the clip and say "make this bigger / change the wording / swap the
    image". The agent changes only that element.
  - **Rules for every clip:**
    - Each movable element carries a stable id (`data-manul-id`).
    - Animations run on Manul's clock, not wall-clock time: every GSAP timeline is paused and Manul calls
      `seek(t)`, so any frame can be scrubbed and rendered exactly.
    - Rendering: the clip is stepped frame by frame in an offscreen Chromium, the frames are captured and piped to
      ffmpeg. A clip can also be **baked** to MP4 to save it as fixed footage.
    - Slides render in a sandboxed frame: no network access except the project's own files.
- **Transcript panel:** edit by text ("cut the ums", "remove this sentence").
- **Agent panel:** a live plan, plus **tool cards** (each tool renders its own card), plus **permission cards**. Not a
  chat log.
- **Tracks drawer:** the full timeline and mix, for power users.
- **Background tray:** renders, imports, downloads and agent background tasks, with one progress style.
- **Agent browser:** the agent uses Manul's own built-in browser (the Browser panel), never the user's personal one.
  It is driven by a private, bundled BrowserSkill (bsk): its own daemon home and port, so a bsk the user installed in
  Chrome never sees it. The user browses and signs in in the same panel and can interrupt the agent there.
  Settings → Browser lets the user choose their own Chrome instead (their logins), on purpose.
- **⌘K command palette** reaches everything. Selecting a range plus ⌘K offers actions on that range.

## 4. Architecture decisions

| Area | Decision | Why |
|---|---|---|
| App shell | **Electron** | Real Chromium: WebCodecs, the Chrome DevTools Protocol, and an embedded browser the agent can drive. Tauri/WebKit can't do that. |
| UI | **React + shadcn/ui + Tailwind** | Clean, consistent base; most modern component libraries plug into it |
| UI accents | libraries.dev (Thinking Orbs, Border Beam), transitions.dev, Dot Matrix loaders, driver.js onboarding tour, 3dicons (empty states only) | Polish where it counts, never in the way |
| Agent runtime | **pi-durable** (pinned) + **pi-ai** for models | Conversations and tool calls are saved to SQLite before they're shown, so a crash or quit resumes mid-run |
| Agent ↔ UI | **AG-UI protocol** (`@ag-ui/core`, `@ag-ui/client`) over Electron IPC | Standard events for tool calls, shared state (JSON Patch), interrupts, plan/activity, subagents. Later the same protocol works over HTTP for a cloud agent, mobile and review links |
| Motion / generated footage | **HTML + GSAP** clips (`clip.html`), paused timelines seeked on Manul's clock, rendered offscreen frame by frame → ffmpeg | The agent makes footage it can edit; frame-exact scrub and export; GSAP is free incl. plugins (clear the no-code clause, §7) |
| Skills | Plain `SKILL.md` folders grouped into **profiles** | Readable, diffable, editable by the agent; they ship inside the app and update with it |
| Memory | One fact per file, plus an index fed into the prompt | Survives across projects |
| Media tools | **Bundled:** ffmpeg, ffprobe (static, per platform). **On demand:** demucs, whisper models, yt-dlp, rubberband… | Small install; heavy tools only when needed, with a size prompt first |
| Python tools | Isolated Python environments managed by **uv**, inside Manul's support folder | Never touch the system Python |
| Keys | macOS Keychain / Linux secret store (`safeStorage`) | The renderer only ever learns "set" or "not set" |

### Models and voice

- **Text models:** Anthropic (Opus…), Gemini, OpenAI and anything pi-ai supports.
- **Voice:** ElevenLabs, Gemini TTS, OpenAI TTS, all behind one `speak(text, voice, style) → audio` interface.
- **Video generation (phase 2):** video models such as Veo, Runway, Kling and Sora, behind one
  `generate(prompt, { frame?, box?, range?, aspect }) → clip` interface, with your own key or the Manul key.
- Every request goes through a **router that works by capability** (chat · image · voice · transcription · video), so the
  later Manul key slots in without feature code changes.

### Keys screen

- **Your own keys** tab (v1): Anthropic, Gemini, OpenAI, ElevenLabs. Each shows what it unlocks, plus a "what works
  with your keys" summary.
- **Manul key** tab: paste a Manul key and the agent uses the model Manul's gateway picks (see phase 3).

### Updates

1. **Skills, prompts and profiles:** inside the app, updated with each release, so the skills always match the tools they describe.
2. **Tools:** updated one at a time, checked against their version, without restarting.
3. **App:** `electron-updater` for direct downloads, a Homebrew cask that updates itself (`auto_updates true`), and apt from our
   own package repository.

### Distribution

- **macOS:** Homebrew cask. Needs an **Apple Developer ID**, signing and notarization, because Homebrew is dropping apps
  that macOS Gatekeeper blocks.
- **Linux:** `.deb` in our own apt repository (and AppImage).
- **Windows x64:** native MSVC build and offline one-click per-user NSIS installer configured, not yet validated or published.
  Signed public releases, clean Windows runtime acceptance and signed N-to-N+1 updates are required;
  see RELEASING.md. Desktop/Start menu shortcuts and launch after install, no repository setup or developer
  prerequisites. Windows 10 1903/build 18362 or newer / Windows 11; whisper embeds a UTF-8 process manifest.
  Native Windows ARM64 is deferred until an architecture-specific toolchain and update flow are validated.
  Windows 32-bit is out of scope for the current Electron stack. This release targets x64 only.
- **Speech recognition:** whisper.cpp already on the computer is found and used (paths saved, changeable, "Detect again");
  otherwise Manul's own bundled whisper.cpp (static, Metal on macOS, ~4 MB) with the base model downloaded on first use
  (148 MB, SHA-256 pinned); faster-whisper (Python) only where there is no bundled build. One transcription at a time.
- **ffmpeg:** our own pinned FFmpeg 9.0.2 static builds (ffmpeg + ffprobe, same release) per platform; built from source
  in CI once the repo has CI.
- **Linux needs fallbacks** for macOS-only pieces: VideoToolbox → VAAPI/x264, whisper on Metal → whisper on the CPU or CUDA.
- **ffmpeg licence:** a GPL build (x264) ships as a separate binary with a source offer, or an LGPL build with hardware encoders
  only. 💬 Decide which.

## 5. Phases

### Phase 0: Foundations
- ✅ Repo, licence, CONTRIBUTING, CI (lint, typecheck, build per platform)
- ⬜ UI mockups: start screen, Screen view with notes on the picture, agent panel (plan + tool cards + permission
      cards), Keys tabs, Tools page
- ✅ Electron shell + React/shadcn/Tailwind design system (light and dark themes, warm accents, a serif for reading)
- ✅ One window, as in Claude's app: the conversation with the film beside it; projects in a sidebar, each opening up into its chats and files; instructions given right at a box or range on the film
- ✅ Hand editing pared down to what's quicker by hand: drag a piece to move it, drag footage in from Files (⌘Z undoes either); the agent does the cutting (the split, trim and levels tools, the mix panel and the transcript and subtitles panels are gone)
- ✅ pi-durable agent in the main process → **AG-UI adapter** → IPC → renderer
- ✅ Generic tool card + per-tool card registry
- 🚧 Capability router (chat · image · voice · transcription) + bring-your-own-key keystore (keystore, Keys tabs, model picker done)
- ⬜ Local usage meter (provider, model, tokens or characters, cost) for every request
- ✅ Bundled ffmpeg/ffprobe; **Tools page** (installed, size, update, remove); on-demand installer with checksums
- ⬜ First-run setup checks (dependency doctor)
- ⬜ Email GSAP/Webflow for a written OK on Manul's use (AI-written GSAP + drag-to-edit clips)

### Phase 1: MVP (v0.1)
- 🚧 Import: drop a file or link → read details, make a preview copy, transcribe, split into scenes, tag (details + transcription done)
- ✅ Start screen: request plus video in one step
- ✅ Screen view: player, scrubber notes, agent input at the playhead
- 🚧 Notes on the picture: element pick, box on the frame, timestamp/range (box + time + range done)
- ✅ Before/after proposals: scrub, accept, reject, reply
- ✅ **HTML motion clips:** the agent builds `clip.html` (slides, title cards, charts, kinetic type, GSAP motion
      design) as timeline items next to MP4s and images. They are sandboxed, run on Manul's clock and render frame-exactly
- ✅ Clip renderer: offscreen Chromium frame stepping → ffmpeg; "bake to MP4"; final export mixes clips with footage
- ✅ **Motion videos from nothing:** no footage needed. Start from one of 233 gallery examples (with the prompt that made it,
  credited to its maker), a video whose look to match, or a description; storyboard first, then one clip per scene
- 🚧 Motion skill(s): house style, easing and layout rules so agent-made motion looks designed, not generic
- ✅ Make room on the timeline: split at a point and open a gap so the agent can insert (or propose an insertion) in between
- ✅ Slide editing by hand: drag, resize and edit text/images/shapes on the picture, written back to the HTML
- ✅ Slide editing by the agent: pick an element, then a note scoped to that element; the agent changes only it
- ✅ Transcript panel with text-based editing (click to seek, drag to select a range, fillers marked, find)
- 🚧 Tracks drawer (timeline, mix, inspector) (editing by hand done: split, cut a range, delete, trim, reorder and
      per-piece volume on the timeline, played straight from the pieces with undo; the agent edits the same way with
      edit_timeline; renders only when saved as a version or exported, and a cut of one file renders fast: the picture
      between keyframes is copied as it is and only the frames at each cut are encoded (a 20-minute 1080p film with ten
      cuts: 10 s instead of 90 s). Still to come: more tracks, transitions, speed)
- ✅ Agent browser with take-over (Manul's own browser via private bsk; Settings → Browser switches to the user's Chrome)
- 🚧 Bring in your own footage, images and extra videos anywhere (files, folders and zips: subtitles, music, fonts,
      LUTs, logos; footage dragged onto the timeline goes into the edit at once)
- ✅ Carry over the existing editor features: several projects and conversations, model picker, skills and profiles, memory,
      history (git underneath), move elements, live mix, proxies, native menu, ⌘K
      (all done: conversations, model picker, skills + profiles, memory, history, move elements in clips, project tabs,
      live mix with music ducking, preview copies, native menu, ⌘K)
- ✅ Export: MP4 presets (16:9, 9:16, 1:1), captions burned in or as sidecar files
- ✅ Skills bundled with the app, one per kind of video (the over-the-air feed was dropped: skills now always match the app's tools)
- 🚧 macOS (signed + notarized) and Linux builds; Homebrew cask; apt repository (pipeline ready, see RELEASING.md; needs the accounts and secrets)
  Windows x64 NSIS/native CI is also configured; signing and clean-Windows/update validation remain release gates, not completed support.
- ⬜ driver.js first-run tour

### Phase 2: Generated shots, hand-off, publishing
- ⬜ **Video capability in the router:** text-to-video and image-to-video models behind one interface; your key or the Manul key;
      cost shown before each generation
- ⬜ **B-roll on the fly:** "cut to the city at night here" → a few generated takes, pick one, it lands on that sentence
      (as a new version with before/after, like every other edit)
- ⬜ **Extend the frame:** fill a shot out to a new aspect ratio (16:9 → 9:16) or past its edges, matched to the footage,
      instead of cropping
- ⬜ **Complete the shot:** draw a box over a time range and say what belongs there; only that box and range are generated
- ⬜ **Label every generated shot** in the history, on the timeline and in the exported file's metadata (C2PA content
      credentials where the provider supports them)
- ⬜ Export to **Premiere / DaVinci Resolve / Final Cut** (FCPXML, XML, EDL via OpenTimelineIO)
- ⬜ YouTube publishing (upload, schedule, thumbnails, chapters)
- ⬜ Spending view in Settings (from the usage meter)
- ⬜ Manul key early-access sign-up live

### Phase 3: Manul key and Pro
- 🚧 **Manul gateway** ([gateway/](gateway/README.md)): [Bifrost](https://github.com/maximhq/bifrost) holds our provider
      keys; a Manul key is one of its virtual keys (budget, rate limit, allowed models). The app's side is done: with a
      Manul key the agent uses one model, "Manul", and the gateway's routing rule picks the real one (Claude, Gemini or
      GPT), changeable without an app release. Signing in (Clerk, [account/](account/README.md)) gives each person their own
      key under their own Bifrost customer. Gateway and account service run on the silverfish cluster (manul.si), Clerk in production. New
      accounts get $2 of credit; Dodo Payments top-ups raise it (Test Mode). Left: Dodo Live Mode, and voice and images
      through the gateway
- ⬜ Optional accounts, licence check (works offline for a month), credits, top-ups
- ⬜ Pro plan: AI included, cloud versions of heavy tools (demucs, upscaling), publishing automation, premium skill packs
- 🚧 **Cloud tools on Manul's worker** (`worker.trypitch.co`): Upscale (Real-ESRGAN) has its place in Tools as *Coming soon*; only the shot being processed is sent
- ⬜ Integrations through **Composio**: Google Drive, Dropbox, OneDrive, Slack, Notion, Gmail, TikTok,
      Instagram, LinkedIn, X. Large files go by direct signed upload/download links, never through tool calls
- ⬜ Phone capture over **local Wi-Fi** (QR pairing, free)

### Phase 4: Cloud, mobile, teams
- ⬜ **Manul Cloud storage** (Cloudflare R2): base amount included in Pro, add-on blocks, pooled for teams
- ⬜ **Mobile app** (React Native/Expo): record → footage lands in the project; "Send to Manul" share option; talk
      to the agent over AG-UI
- ⬜ **Team plan:** shared projects, **review links** where clients comment on the frame, shared brand kits and skills
- ⬜ Recording integrations: Zoom, Riverside, Loom, Google Meet → auto-import
- ⬜ Stock media: Pexels, Pixabay, Unsplash, Giphy; licensed music (Epidemic Sound, Artlist)
- ⬜ Brand sources: Canva, Figma
- ⬜ **Skill marketplace** (style packs, with a revenue share for whoever made them)

## 6. Business model

| Plan | What's in it |
|---|---|
| **Free** | The full local editor, your own keys, all local tools, unlimited exports, no watermark |
| **Pro** (~$15–20/mo, 💬) | Manul key (AI included, no keys needed), monthly credits, cloud tools, publishing automation, premium skills, storage allowance |
| **Team** (per seat) | Shared projects, client review links, shared brand kits and skills, pooled storage |
| **Top-ups** | Credit packs, storage blocks |
| **Marketplace** (later) | Revenue share on skill and style packs |

Rules:
- Measure the **cost of every edit** from day one.
- Use cheaper models (Flash-class) for routine steps and stronger models only for hard decisions.
- Feature switches live in the signed update list, so we can run price tests without a new app version.

## 7. Open questions 💬

- **Licence:** the editor is open source under Apache-2.0 with attribution in NOTICE since 2026-10-12 (FSL-1.1-ALv2 from
  2026-10-08; GPL-3.0 before that, and releases up to 0.1.1 and the code published before stay GPL). Contributors agree to the contributor agreement in CONTRIBUTING. The bundled GPL
  programs (ffmpeg, manul-beats, manul-speakers) stay separate programs with their source. The paid cloud parts (Manul
  key gateway, storage) stay closed as separate services.
- **Windows:** x64 build configured; native CI, clean-PC acceptance, certificate/publisher setup and signed-update validation are still pending. External manul.si pages need a manual update after those gates pass.
- **Personality:** how much manul (mascot, warm colours, orbs) versus a quiet pro tool?
- **Video models:** which to support first, and whether generation runs only through the Manul key (simpler billing) or also with users' own keys.
- Pro price point and credit size.
- ffmpeg build: GPL (x264) or LGPL (hardware encoders only)?
- **GSAP licence:** GSAP is 100% free, including commercial use and every plugin (SplitText, MorphSVG…), thanks to
  Webflow. Its licence also allows AI-generated GSAP code. **One clause to clear:** it prohibits using GSAP in
  "tools that allow users to build visual animations without code" in ways that compete with Webflow's visual animation
  builder. Manul's drag-to-edit on motion clips is close to that line. Action: get written confirmation from GSAP/Webflow
  for Manul's use case. Until then, keep GSAP behind the Manul-clock adapter (anime.js v4, MIT, as the fallback).
- Where the apt repository is hosted (GitHub Pages, Cloudsmith, packagecloud…).

## How to contribute

- **Ideas or changes to this roadmap:** open a PR that edits `ROADMAP.md`, or an issue labelled `roadmap`. Add new items
  under the right phase with ⬜. If you're unsure where something goes, put it under *Open questions* with 💬.
- **Picking up an item:** comment on its issue (or open one), then change ⬜ to 🚧 with your handle, e.g.
  `🚧 Tools page (@yourname)`.
- **Discuss before building** anything that changes an architecture decision in section 4.
- Keep PRs small. One roadmap item per PR is ideal.
