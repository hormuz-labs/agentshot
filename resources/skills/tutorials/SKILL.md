---
name: tutorials
description: Screen recordings, software demos, product walkthroughs, courses and how-to videos: cutting waiting and mistakes, speeding up typing and loading, zooming into where the action is, keeping text readable, callouts, the webcam overlay, voice, chapters. Read before editing any screen recording or tutorial; video-editing comes first.
---

# Tutorials, demos and screen recordings

A tutorial is judged by one thing: can the viewer follow and repeat it? Clarity beats style. Read video-editing first;
talking-head for the voice; motion-design for callouts and titles.

## 1. Know the recording
- `analyze_video`: screen recordings show as long low-motion shots with frozen stretches (waiting, reading) — those are
  candidates to cut or speed up. `transcript`: what is explained when. `look` at frames to see what's on screen (the app,
  where the cursor is, the text size).
- Ask in one card only what changes the edit (video-editing's briefs.md): who it's for (beginners → slower, more zoom;
  experts → faster), where it goes (YouTube 16:9, a course, docs, social clip), how tight.

## 2. Cutting
- **Remove**: waiting (loading, rendering, installs), mistakes and their undo, searching for the right menu, "uh, let me
  just…", repeated attempts, dead time at the start and end. Keep the moment a step completes.
- **Speed up** what must be seen but is slow: typing long text, scrolling, progress bars, repetitive steps → 2–8× (use
  `setpts` for picture; mute or drop the audio of sped-up parts, or keep the voice at normal speed by cutting it
  separately). Show a small "2×"/"⏩" label if the speed-up could confuse.
- **Never cut** a step the viewer needs to repeat it: the click on the menu item, the value typed, the setting changed.
  When in doubt, keep the step and speed it up.
- Voice: cut fillers and long pauses (talking-head), but keep the voice in sync with what's on screen — if the narration
  describes a click, the click must be visible while it's said. Reorder nothing that changes the steps' order.

## 3. Zoom (the most important tool)
- Zoom into the area where the action happens whenever text or controls would be too small to read on a phone or a
  laptop: crop to that region (keep 16:9), scale back to the output size. Typical zoom 150–250 %.
- **Ease in and out** over 0.4–0.6 s (never a jump), hold while the action happens, zoom back out when the viewer needs
  the whole screen again (to find where they are). One zoom per step; don't wander.
- Keep the zoom ≤ the source resolution's limit: on a 1080p recording, 200 % already looks soft; on 4K/retina, 200–300 %
  stays sharp.
- Readability rule: UI text should be at least ~1.5 % of the frame height (≈ 16 px on 1080p) after zoom; code at least
  ~2 % (≈ 22 px). If it isn't, zoom more or crop.
- Vertical (9:16) clips of a screen: crop to the part that matters, never shrink the whole screen into the middle.

## 4. Callouts and text
- Highlight what to click with a box, a circle or an arrow (motion-design overlay), appearing 0.2–0.3 s before the click
  and leaving after it. One callout at a time.
- Keyboard shortcuts and typed values as small text labels ("⌘ + K") at the bottom while they happen.
- Step titles ("Step 2 — Connect the database") as a short lower-third or a card at each step's start.
- Blur or crop anything private on screen (emails, API keys, names, notifications) — look for it with `look` and ask
  the user if you see something that may be private.

## 5. Webcam overlay (if there is a face recording)
- Separate face-camera recording: read demo-editor and use sync_media + compose_demo. Keep the camera linked to the
  screen source so later cuts and layout changes remain editable and synchronized.
- A circle or rounded rectangle in a corner that doesn't cover the action (move it when the action is in that corner),
  15–25 % of the frame width. Full-screen face for the intro, the outro and personal moments; the screen for the steps.

## 6. Structure
- Result first (3–10 s: what you'll be able to do) → what you need → steps in order (each: say what and why, then do it)
  → the result again → recap. Chapters at each step for videos over ~3 minutes (`0:00 Title` lines in your reply).
- Courses: one lesson per topic, 3–10 minutes, same intro/outro style each time.

## 7. Before proposing
- Every step can be followed: watch the cut at each step (`look` at its frames): the click, the typed value and the
  result are visible and readable.
- Zooms ease in and out; no text too small; nothing private visible.
- Narration in sync with the screen; no cut inside a word; loudness -14 LUFS (-16 for courses with long listening is ok).
