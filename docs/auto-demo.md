# Auto Demo Edit

Import a screen recording and a separate face-camera recording into the same project. Then either:

- Use **Auto Demo in the chat composer**. The toolbox opens inline in the conversation. Choose the screen/camera, face layout and pacing, then **Generate in chat**.
- Attach both recordings to chat and ask: “Sync these and make a clean demo with my face in a top-right circle.”

The inline toolbox collects and previews the brief. Generate submits that brief with both recordings to the chat agent
and closes the toolbox; the conversation owns tool execution, progress, error recovery and the proposed video.
Natural pacing is the default; Tight shortens jointly idle
pauses more, and Keep everything only synchronizes and composes. Circle, square, rectangle and rounded rectangle
layouts support corner presets, a size slider and exact pixel dimensions. Pick the clearer narration microphone.

The result appears as an Accept/Reject preview. In chat, Manul asks whether you want to adjust face placement, shape or
size. **Yes, adjust layout** opens the live **Face camera** toolbox in the conversation (and uses a proposed demo as
the editable starting point). **Looks good** dismisses the toolbox offer. No modal is involved.
The adjustment offer is attached to the assistant reply that produced the version. It remains at that point in the
conversation when later messages arrive, rather than staying pinned below the newest message. Its anchor is derived
from durable tool results and chat replies, so reopening the conversation preserves its placement.
**Move & resize** drags the shape anywhere on the picture; its gold handle resizes it. **Adjust video inside** drags
the source inside the fixed mask, so a cropped head can be repositioned without moving the circle. Zoom, fit/fill,
exact source offsets, dimensions and corner controls are also available.
The chat also shows the complete original recording with the output shape outlined as a guide. This source view
preserves the original aspect ratio and resolution, rather than cropping the portrait to a square. Legacy extra
source crops are removed while preserving the existing visible framing, making the rest of the recording available.
**Video placement** provides dragging,
resizing, fit/fill and zoom for ordinary timeline clips. These changes are immediate and undoable.
**Render adjusted video in chat** sends the finishing request to the agent using the already-adjusted timeline.
**Save version** and **Export** also render the linked originals at full resolution; a preview proxy is never exported.
Demo composition uses one Lanczos resize from original pixels and H.264 CRF 16. Original-size export without burned
captions stream-copies the finished edit to avoid a second lossy encode. Composition still requires encoding; it is
high-quality rather than bit-identical to the input, and the selected face overlay dimensions determine its output size.

In chat, `demo_layout` asks any missing position, shape and size choices together before first composition.
The composition tool also enforces that brief if the agent attempts to skip it. Only user-authored choices or an
explicit “You decide” select the layout. The result includes measured stale-time removal, coverage-only trimming
and original/final duration; assistant replies render Markdown bold and lists rather than literal `**` markers.
Normal chat requests to sync/create a demo also use Natural cleanup. Only explicit Keep everything, no trimming,
or sync-only requests disable it. A skipped cleanup is labeled as skipped, not as evidence that no dead time exists.

## GitHub downloads and native tools

Release installers bundle target-native FFmpeg, whisper, beat/speaker/vision runners and the detection models for
macOS Intel/Apple Silicon (macOS 12+) and Linux x64/ARM64. Packaging fails if executables/models are missing or the
executable architecture is wrong, and checks the resources again after they are copied into the app bundle.
Downloading the source archive is different: run `npm install` then `npm run setup:native` with a compiler and cmake.
`npm run check:native` verifies the host installation. Linux still needs Electron's supported desktop libraries;
the Debian package declares its required dependencies. Runtime failures remain possible and are shown as actionable
messages rather than silently hiding lost work; optional unavailable detection skips background work gracefully.

## Synchronization

Both files normally need a recording of the same audio. Manul matches normalized audio envelopes over the complete
files, refines independent anchors with GCC-PHAT, and fits clock offset and drift. Computation runs in a worker to
keep Electron responsive. Results are cached by file identity and analysis version. Ambiguous repeated takes and
weak/inconsistent matches require a manual anchor instead of silently choosing a timestamp.

For manual alignment, enter the time (in seconds) of the **same** word or clap in each video. The screen event time
minus camera event time is the offset. Manual alignment uses a constant offset; it does not estimate clock drift.
Automatic synchronization supports up to two hours per recording.
Microphone tracks that start after picture retain that timestamp offset during audio extraction, transcription and
composition. Every segment's audio is bounded to the planned length, and decoded video frames are bounded before
concatenation, including variable-frame-rate screen recordings.

## Cleanup and coverage

The cleanup plan protects word-timed narration, audible intervals and local screen changes sampled at 4 fps. It cuts
only unprotected idle gaps and leaves breathing room and action/result holds. This is conservative signal-based
cleanup: it does not semantically understand every click, and a noisy microphone can prevent some pause cuts.
Static-screen explanations and silent screen changes are preserved. Necessary content is not cut merely because
one of these signals is absent. The chat agent can inspect specific frames and refine the linked timeline afterward.

The face overlay is hidden outside the camera's actual source coverage. Useful screen footage stays unless
**Only keep footage covered by both recordings** is selected. Camera narration uses screen audio outside its coverage
when available; otherwise retained uncovered footage has no narration, which is noted in the preview.

## Implementation

- `src/main/sync.ts`: FFT correlation, GCC-PHAT, multi-anchor confidence/drift fitting and worker execution.
- `src/main/screen-activity.ts`: streamed, cached local screen-change measurements.
- `src/main/demo.ts`: shared frame-grid cut plan for the guided UI and agent.
- `src/shared/demo.ts`: camera layout, source-to-camera mapping and cleanup/routing helpers.
- `src/shared/timeline.ts`: native linked demo metadata and FFmpeg composition.
- `resources/skills/demo-editor/SKILL.md`: the automatically discovered application skill.

Agent tools: `sync_media`, `analyze_screen_activity`, `compose_demo`, `set_camera_layout`. Existing timeline tools
preserve synchronization through ripple cuts, trims, reordering and restoration. Version snapshots retain the linked
sources, and file removal protects a camera used by any retained version. Render validation checks duration against
the edit plan; integration tests verify actual source frames, masks and narration selection around joins.

## Checks

```sh
npm run typecheck
npm test -- test/demo.test.ts test/demo-render.test.ts test/timeline.test.ts test/timeline-edit.test.ts test/mix.test.ts test/skills.test.ts
npm run test:demo
```

The desktop test captures the inline toolbox's chat submission without calling a paid model, verifies the post-output
adjustment offer and controls, then exercises the real deterministic composition backend, live layout changes,
undo, chat adjustment submission, saving, export and reopening. The cleanup integration test supplies known word times to verify preservation
of static narration and silent UI activity without requiring a speech-model download.
