# Checks before proposing a render

`analyze_video` on the render measures everything below in one pass (cached per file). Read its report against this
table, fix what fails, then propose.

| Check | Where in the report | Pass when |
|---|---|---|
| Length and streams | first line (duration, size, fps, audio) | length as planned; audio there unless the film is silent on purpose |
| Black frames | "Black:" | nothing, or only blacks you put there on purpose |
| Frozen picture | "Frozen picture:" | nothing, except intended stills, title cards, slides and the black parts above (they register as frozen too) |
| Dead sound | "silent … s" and its ranges | only intended pauses; a silence at a cut point means a range was cut wrong |
| Loudness | "Audio: … LUFS integrated … peak" | about -14 LUFS (±1) for web/social, peak ≤ -1 dBFS |
| Shot lengths | "Shots" | no shot shorter than ~0.3 s unless it is a deliberate burst |
| Shake | each shot's shake | shots you stabilised now read steady or slight |

Then `look` at frames (times you choose: 1 s, the middle, and 0.2 s after each tricky cut) and read them:
nothing over faces, text not cut by the frame edge, the subject inside a vertical crop, no wrong shot flashing in.

If speech was cut, read the `transcript` of the render at the cut points: every word whole, nothing doubled.
