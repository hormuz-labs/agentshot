---
name: motion-design
description: Making motion clips (title cards, lower thirds, kinetic text, charts, explainers, end cards) with HTML + GSAP that AgentShot renders frame-exact. Read before create_clip or editing a clip.
---

# Motion design for AgentShot clips

A clip is HTML + GSAP that AgentShot renders into video frame by frame. `create_clip` takes the body markup, a `<style>` and
a `<script>`; AgentShot adds the document, GSAP, its runtime, the Inter font and a fixed stage at the timeline size.

## Two kinds of clip
- **Full-frame cards** (title cards, chapter cards, end cards, explainers that replace the picture): `create_clip`
  without `overlay`, then `insert_clip` at a time — the film gets longer by the clip's length.
- **Overlays** (lower thirds, captions, callouts, arrows, logos, progress bars — anything ON the footage): `create_clip`
  with `overlay: true`, then `overlay_clip` at a time — the film keeps its length and the footage shows through.
  Leave the background transparent; draw only the graphic. A name on screen is always an overlay, never a card.

## How clips work
- Write normal GSAP: `gsap.timeline()`, `gsap.to / from / fromTo`, eases, staggers. **Never pause it**, and never use
  `setTimeout`, `setInterval` or `requestAnimationFrame` for motion: AgentShot drives time and renders any frame exactly.
- Plugins load by name when you use them: SplitText, DrawSVGPlugin, MorphSVGPlugin, MotionPathPlugin, TextPlugin,
  CustomEase. For canvas drawing use `manul.onFrame(t => …)` (t in seconds).
- The stage is `manul.width × manul.height` px (the film's size). Position elements absolutely in px.
- Give every element a person may want to move or change a `data-manul-id` ("title", "subtitle", "logo", "bar-3"…).
  The user drags these on the picture and points at them in notes.
- No network: no web fonts, CDNs or remote images. Use inline SVG, CSS shapes and gradients, or project files by
  relative path from the clip folder (`../../media/photo.jpg`). Type is Inter, weights 100–900.

## Design
- One idea per clip. Big type, tight tracking for headlines (-0.02em), wide tracking only for small caps labels.
- Generous margins: keep text inside a 6% safe area. Never let text touch or cross the edge.
- Two or three colours that suit the footage; check contrast (light text on dark or the reverse, never mid on mid).
- Entrances with purpose: `power3.out` or `expo.out`, 0.4–0.9 s; stagger words or lines 0.04–0.08 s. Exits faster
  than entrances. Motion settles before the end so the last frame is clean and can hold.
- Lengths: titles and cards 2–5 s, lower thirds 3–6 s, data and explainers as long as reading needs (about 3 words a
  second plus 1 s).
- With music: start the clip (and its main entrance) on a beat, a title card on a downbeat, the end card on the
  final hit — times from `analyze_music`'s beats file; motion inside the clip can hit beats too (a stagger per beat).
- Lower thirds sit in the bottom third, left-aligned, out of the way of faces. End cards leave space for the platform's
  overlays.

## Whole motion videos (a project with no footage)
The project starts on one second of blank canvas; the film is only the scenes you make.
- **Storyboard first.** A beat sheet: one line per scene with its time, what's on screen and how it moves. Get the user's
  OK (ask_user) before writing any clip. With a reference video, write a short style guide first: palette (hex), type
  (weight, size, tracking), shot lengths, transitions, camera moves, texture, how text enters and leaves.
- **One clip per scene**, 2–6 s each, so a note re-renders one scene, not the film. Carry an element across a scene
  change (same colour, size and position on both sides of the cut) so scenes read as one film, not a slideshow.
- **Hook in the first second.** Something moves in frame 1; no fade up from black.
- **Taste, with numbers:** entrances `expo.out`/`power4.out`, 0.5–0.8 s; exits half as long. Words staggered 0.06–0.1 s.
  A held line stays at least 1 s plus 0.3 s a word. One accent colour; everything else neutral. Headlines 8–14% of the
  frame height, never under 4% for anything that must be read on a phone.
- **Motivated motion only:** every move grows out of something already on screen. No floating particles, lens flares,
  glows, gradient backgrounds or spinning for its own sake, unless the style asks for them.
- **Sound:** music from the music-generation skill; scene changes on its downbeats (`analyze_music`).
- **Before proposing:** look at one frame per scene (the frame `create_clip` returns, or `look` on the film) and check
  collisions, text off the safe area, contrast, spelling and empty frames. Fix, then `rerender_timeline`.

## Check your work
`create_clip` returns the middle frame. Look at it: overflow, clipping, alignment, contrast, spelling. Fix the file
(read + edit) and `render_clip`, then `insert_clip` at the right time. If the clip is already in the film, call
`rerender_timeline` after changing it.
