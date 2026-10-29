# Desktop → mobile coverage

Sources: `src/preload/index.ts`, actual renderer views, `README.md`. Roadmap items
not shipped on desktop are not counted as existing features.

| Desktop feature | Mobile implementation | Remaining mobile-specific work |
| --- | --- | --- |
| Anywhere connection | Local Wi-Fi + Tailscale (`100.64.0.0/10`) address discovery and automatic multi-address fallback with desktop-pinned TLS | — |
| Projects / search / delete | Project list, search, import, Trash action | Desktop folder picker/reveal is desktop-only |
| Video, audio, images, subtitles, fonts, LUTs, ZIP import | Native file picker → streaming upload → same desktop importer | Directory-picker parity, resumable/background transfer |
| Phone video capture | System camera → project upload | Incoming OS share extensions, interrupted Android camera recovery |
| Motion/gallery/examples | Categories, search, credited previews/prompts, create from example | Gallery thumbnail grid polish |
| Walkthrough filming | Create walkthrough → same desktop browser/voice tools through chat | Phone cannot sign in to or interact with desktop browser page |
| AI analysis/transcription/cuts/cleanup/music/voice | Same desktop agent and tools over validated bridge | Requires configured desktop tools/keys |
| Streaming conversations / tool cards / stop / usage | AG-UI state, text/tool arguments/results, cost and stop | Specialized per-tool visual cards |
| Multiple conversations | Create/switch/rename | — |
| Model selection | All configured desktop models, per project | Provider endpoint creation remains in desktop settings |
| Attachments and @ mentions | Files, versions and motion clips | — |
| Time / range / frame box notes | Touch selection and normalized coordinates | Still image attachment to note, direct element selection |
| Proposals | Before/after playback, keep, send back with reply | Synchronized dual-player comparison |
| Versions / checkpoint restore | Version picker, history/restore | — |
| Timeline / undo | Split, trim, reorder, insert, delete, mute, undo/redo | Live multi-source playback; advanced framing/demo inspectors |
| Music mix / speech ducking | Configure same desktop mix engine, render to preview | Zero-render live mixing on mobile |
| HTML motion clips | Create/edit through agent, play baked clips | Native drag/resize/retype editor |
| Export MP4 / formats / subtitles | Desktop render → native download/share; SRT included | Resumable background downloads |
| Files/downloads/removal | Attach, insert, download/share, protected deletion | Rich artifact-specific previews |
| Transcript | Read/transcribe; source-scoped instructions | Word selection/highlighting UI |
| Tools / install consent / jobs | Status, install/remove, progress, accept/decline | Custom binary/model paths configured on desktop |
| Skills / profiles / memory | List, toggle, profiles, memory CRUD | — |
| Keys / account | Configure keys on desktop store; account and balance display | Sign-in, billing and purchases remain desktop-managed |
| Browser / tabs / mode | Navigate/back/forward/reload/new/select/close, own/Chrome mode | Interactive remote browser takeover |
| Appearance / brand | Light/dark/system, canonical artwork, fonts, launch and store icons | Animated 3D mascot and sound reactions |
| Menu / shortcuts / command palette | Touch navigation and project menu | Searchable mobile action palette |
| Desktop updates / telemetry / notices | Store-managed mobile updates; Flutter license screen; no mobile analytics added | Store release configuration and final notices review |
| Background desktop projects | Desktop keeps processing; mobile reconnects and replays agent state; local notifications | Push notifications when the app is closed |
| Offline and repeat viewing | Films, posters and thumbnails kept on the phone by ETag (revalidated with a 304, refetched only when changed, up to 2 GB, cleared in Settings or on disconnect); project list, projects, conversations and examples open from the last copy | Editing while offline |

This ledger distinguishes implemented mobile controls from capabilities available
through the desktop agent. It is not a claim of complete native UI parity.
