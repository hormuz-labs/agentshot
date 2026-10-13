---
name: demo-editor
description: Synchronizing separate screen and face-camera recordings with common audio, protecting narration and demo steps while removing dead time, and composing an editable circle, square or rectangular face overlay. Read before editing a screen recording with a separate webcam, phone or camera recording; video-editing comes first.
---

# Auto Demo Edit

Make a clear, synchronized demo that a non-editor can revise by asking. Read video-editing and tutorials first.
Use dedicated tools for measurements and composition; retain the linked originals rather than flattening them for later edits.

## Workflow
1. `project_state`: identify the two attached recordings. `look` at several frames in both to confirm screen and camera.
   Filename, landscape/portrait shape and file length are clues, not proof. Ask which is which if ambiguous.
2. `sync_media` with `screen` and `camera`. Read confidence, reliable, offset, rate and overlap. Different lengths do not
   imply the same start. Unreliable match: ask for the same word/clap/event's time in each recording, then supply only the
   user's measured difference as `manual_offset` to compose_demo. Never make up an offset.
3. `transcript` on the narration candidates; `analyze_video` if audio quality is unclear. Prefer clean direct-mic screen
   audio with full coverage; camera audio when clearly better. One narration track, never duplicate microphone echo.
4. **Call `demo_layout` before first composition.** It asks one card for choices not explicitly specified by the user:
   position (four corners), shape (circle, square,
   rectangle, rounded rectangle), size (small 15%, medium 20%, large 25% of output width, or custom pixels), cleanup
   (Natural, Tight, Keep everything). Recommended options first. “You decide” uses top-right circle at 20% width,
   only after the user selects “You decide”. Do not skip the card because defaults seem sensible, or because the user
   said “just sync”. Prefer a clear corner by inspecting several action frames. Remember lasting
   preferences only when the user says they should hold for future edits.
5. `compose_demo` once. It measures/caches sync, obtains word-timed transcription, measures screen activity throughout,
   protects audible speech and necessary actions, builds frame-grid cuts on the master timeline, maps the camera through
   the measured clock offset/rate, renders and proposes one editable version. Do not also call propose_version.
   API cleanup values: `natural` (default), `tight`, `none`. Normal requests to sync/create a demo also clean dead
   time using Natural pacing. Only an explicit “Keep everything”, “No trimming”, or “Sync only” disables cleanup.
   Do not set none just because a request says “please sync it”. Automatic face detection is optional; if unavailable use
   the supplied frames / `look` and continue. Do not search application files to troubleshoot a tool.
6. `look` at the proposed start/end and an important action/cut. Fix a real failed check, not speculative polish.
   Report `summary.message` from the result, original → final length, layout and any source-coverage warning. Say
   “We removed 30 seconds of stale footage” only when that is measured; zero means explicitly no stale footage removed.
   Format concise bullets with **Audio sync:** and **Layout:** labels; the chat renders Markdown bold and lists.
   Then ask: “Would you like to adjust your face placement, shape or size?” The conversation shows this question
   with “Yes, adjust layout” / “Looks good”. Yes opens the live toolbox IN CHAT, not a modal or separate panel.
   The user can drag the overlay on the preview and reframe inside it, then Render adjusted video in chat.

## What is dead time?
- Static screen + speaking: keep the explanation.
- Silence + necessary clicking, typing, scrolling or showing a result: keep the action and reading time.
- No narration AND no meaningful screen change: a cleanup candidate. Leave breathing space at joins.
- Loading/spinner and slow repetitive work: only speed up when requested; do not blindly remove necessary steps.
- Do not reorder demonstration steps or remove tangents/repeated explanations without a specific request.
- Motion/silence thresholds are fallible. The conservative composed plan preserves audible intervals as a second guard
  against missed transcription; a noisy mic may yield fewer cuts. Explain that honestly instead of aggressive guessing.

## Unequal coverage
Outside the camera recording, hide the face layer and preserve useful screen footage. Do not freeze or loop the face.
`overlap_only` is opt-in. When camera narration is selected, available screen audio carries uncovered ranges; without it
those ranges have no narration. Tell the user if retained footage has that limitation.

## Subsequent edits
- Pending proposal: project_state first. If the user explicitly wants to revise that preview, `decide_version`
  accept:true uses it as the editable starting point; then use timeline/layout tools. Ask if ambiguous. Do not
  inspect parent folders or run Python on project.json to diagnose this ordinary version-state condition.
- “Trim tighter”: transcript first, then measured speech/silence and screen activity. Plan all supported cuts and apply
  them together. Inspect only a few uncertain action boundaries. Never repeatedly narrow a look window below one
  frame or search for a speech boundary by looking at nearly identical images. Use word times for speech cuts.
- Cuts, trimming, restore/reorder: `edit_timeline`, then `rerender_timeline` when a preview is needed. Linked camera time
  is derived from the original screen source time, so ripple cuts do not break sync.
- Shape, size, location, crop, hide/show: `set_camera_layout`; use `project_state` output dimensions. Then rerender.
- Source clipped inside a circle: `set_camera_layout` with `framing` (fit contain/cover, zoom 0.25–4, x/y offsets as
  fractions of the shape). The shape's pixel x/y move the overlay; framing x/y move the source inside it. Users have
  separate Move & resize and Adjust video inside modes in the chat toolbox, including drag and zoom.
- Regular video placement: `set_video_framing` on timeline piece IDs; fit/fill, zoom and x/y are independent of time.
- Keep the complete face-camera source available: do not add a source crop merely to make a circle. Use source
  framing (fit/fill, zoom and pan) to position it within the mask. Source crops are only for an explicit crop request.
  Adjust video inside shows the full original-quality recording with a shape guide. Original-size export copies the
  finished edit without another lossy encode; resized/captioned output renders from original sources.
- Users can use the Face camera controls to resize/reposition with instant preview and Undo, without knowing timelines.
- Preserve the existing demo metadata by using timeline tools, not ffmpeg on the flattened output.
