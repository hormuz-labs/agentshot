---
name: promos-and-montages
description: Music-driven films from footage or photos with little or no speech: ads and commercials, product and car promos, brand films, trailers, event, wedding and travel recaps, sports highlights, real estate tours, photo slideshows. Rating shots, structures with timings, cutting to the music, speed ramps, sound design, titles, end cards. Read before making any of these; video-editing comes first.
---

# Promos, commercials and montages

These films live on picture and music. There is no speech to carry them, so every shot must earn its place and the cuts
must feel locked to the music. Read video-editing first, and its music-sync.md reference before cutting — it is the
core of this kind of film.

## 1. The brief (ask in one card unless the user already said; video-editing's briefs.md has the wording)
- **What is it for / where will it be posted**: Reel/TikTok/Short (9:16, 7–30 s), YouTube/website (16:9, 30–90 s),
  feed (4:5 or 1:1), an ad slot (exactly 6, 15, 30 or 60 s — ads must hit the length to the frame).
- **Feel**: cinematic, energetic, clean & modern, warm & personal, playful (what each means is in section 6).
- **Music**: theirs, generated (music-generation skill), or the footage's own sound.
- **Message/text**: a product name, a line, a date, a call to action, a logo file? Ask only if text is expected (ads,
  events) and they haven't given it. Never invent claims, prices or dates.

## 2. Know and rate the footage
1. `analyze_video` on every source: shots with times, shake, motion, exposure, colour; one frame per shot.
2. `find_subjects` for what is in each shot and where (people, faces, cars, animals, products), and `look` closer
   where needed (what the shot means, the moment an action peaks).
3. **Rate every shot** A/B/C in a list before planning:
   - A: striking, steady (or deliberately moving), sharp, well lit, clearly shows the subject or a strong detail.
   - B: usable support — context, transitions, details that aren't remarkable.
   - C: shaky beyond repair, out of focus, dull, repetitive, ugly light. Don't use C shots (unless the user insists).
   Note each shot's best usable range (skip the camera settling at the start/end) and any action peak time.
4. Count the material honestly: if there are 6 usable seconds of A shots, a 30 s film needs B shots, repeats in
   different crops, slow motion or graphics — or a shorter film. Tell the user if the footage can't carry the request.

## 3. Structures with timings
**Ad / product promo / commercial**
| Part | 15 s | 30 s | 60 s | What goes there |
|---|---|---|---|---|
| Hook | 0–2 | 0–2 | 0–3 | the single most striking shot or moment |
| Desire / setup | 2–5 | 2–8 | 3–15 | details, texture, the situation, the feeling |
| Reveal | 5–7 | 8–11 | 15–20 | the hero shot of the product, on a music lift, held |
| Proof / action | 7–12 | 11–24 | 20–48 | the product doing its thing, people using it, features — on beats |
| Payoff | — | 24–27 | 48–55 | the emotional result, the best moment again, a smile |
| End card | 12–15 | 27–30 | 55–60 | logo / product / one line / one call to action, held on the final hit |

**Car**: badge, headlight, grille, wheel, stitching (details, 1-bar slots) → movement (low tracking shots, passes, wheels
turning) → the hero three-quarter front view in the best light on the lift → interior / driver moment → the car on
the road → the car still in beautiful light with the logo. Low angles make cars powerful; reflections and golden light
sell them; shaky or flat-light shots never go in the hero slot.

**Product (e-commerce)**: the product in use (hook) → close details (material, buttons, texture) → it solving the
problem → variants/colours → packshot on a clean background + name + price/CTA only if given.

**Real estate**: exterior wide (best angle) → entrance → living spaces wide → kitchen → bedrooms → bathroom → standout
features (view, garden, pool) → exterior at dusk / closing wide. Slow, steady moves (stabilise everything), 3–5 s per
shot, bright natural grade, verticals kept vertical (no tilted horizons).

**Event / conference / party recap**: arrival and place (signage, venue wide) → people arriving, greetings → the main
moments (talks, performance, toasts) with crowd reactions → details (food, decor, badges) → peak moment on the drop →
wind-down (laughs, goodbyes, the venue at night). Faces and reactions matter more than the stage.

**Wedding highlight (2–5 min, or a 60 s teaser)**: preparations (details: dress, rings, flowers) → arrival / first
look → ceremony highlights (vows: use their actual words as audio, music ducked) → emotions (parents, friends) → party
→ a final romantic shot. Natural sound moments (a laugh, "I do") under the music are what make it.

**Travel**: arrival (plane window, road, station) → the place (wide, landmarks) → textures (food, streets, hands, faces)
→ activities (motion) → peak experience (a view, a moment) on the drop → sunset / leaving. Match cuts between places
(a door in one city → a door in another) are the classic move.

**Sports / action highlights**: the best play first (hook) → build of good plays with rising music → the best moments
on the drops, with a speed ramp into the key action and real sound of the hit/goal (crowd roar) → the celebration →
the score/logo. Keep each action complete: start before it begins, end after it lands.

**Trailer / teaser**: a striking cold open (3–8 s) → title/brand → the world, calm → a turn (music drops out, one line)
→ escalation (accelerating montage) → title card on a big hit → the button (one last surprising shot or line) → end card
with date/CTA. Teasers (10–20 s) show less: mood, one strong image, the title, the date.

**Photo slideshow / memory film**: 2–4 s per photo on bars (music-sync.md), a slow push or pan on each (3–6 % over the
photo, alternating directions; video-editing's ffmpeg.md "Photos"), crossfades of ~0.5 s are fine here, chronological
or grouped by place/person, the best photo last, held. Never stretch a photo to fit: crop to the frame if the subject
fits, otherwise a blurred fill behind it.

**Brand film / "cinematic"**: fewer, longer shots (3–6 s), slow moves, a real grade, music that builds to one peak,
minimal text — the feeling first, information last.

## 4. Cutting it (procedure)
1. Choose the music (theirs or generated at the right length) → `analyze_music` → the beats file.
2. Pick the part of the track that fits the length exactly, on its real ending (music-sync.md §4–5).
3. Map the structure onto the music: section starts and lifts of the track = the structure's turns (the reveal on the
   biggest lift, the end card on the final hit).
4. Fill the slots with the rated shots: A shots on the hook, the reveal, the hits and the end; B shots in between; the
   cut rate follows the music's energy (music-sync.md §2). Vary sizes (wide/medium/close) and keep screen direction.
5. Slide each shot's in-point so its action peak lands on its beat; trim every head and tail.
6. Speed: slow motion only from high-frame-rate footage (≥ 50 fps → 40–50 % speed) or as a speed ramp on a beat;
   speed-up (2–4×) for travel, time passing, setup; never speed up people talking.
7. Stabilise shaky shots you keep; correct exposure and colour so all shots match; then the look (section 6).
8. Sound: the music, plus natural sound of key moments (a car engine, a door, a crowd) ducked under it and brought up
   for a moment; sound effects in sync (music-sync.md §7) — 2–5 in a 30 s film.
9. Text: product name/line/CTA on beats, inside safe areas, few words (video-editing §7; motion-design for animated
   titles and the end card).
10. One render; check (section 7); propose.

## 5. Several versions
If the user wants several platforms, make the main one first, get it accepted, then re-crop per shot for 9:16 / 1:1 /
4:5 with `find_subjects` (its crop filter per shot follows the subject; never just squash or letterbox), check text
positions again for each shape, and keep the same cuts.

## 6. What the feels mean (so you can deliver them)
| Feel | Cutting | Camera/picture | Grade | Music & sound | Text |
|---|---|---|---|---|---|
| Cinematic | 3–6 s shots, holds, builds to one peak | steady (stabilise), slow moves, slow motion, optional 2.39:1 letterbox | gentle S-curve, slightly lifted blacks, warm highlights/cool shadows, saturation 0.9 | orchestral/ambient/epic build, risers, impacts, room to breathe | minimal, wide-tracked caps, slow fades |
| Energetic | 0.5–2 s, bursts on beats | dynamic motion, speed ramps on beats, whip transitions on hits | punchy contrast, saturation 1.1 | high tempo (120–150 BPM), drops | bold, quick, on beats |
| Clean & modern | 1.5–3 s, even rhythm | tidy framing, steady, bright | natural, bright, neutral whites | light electronic / upbeat | sans-serif, simple, lots of space |
| Warm & personal | 2–5 s, gentle | faces, hands, natural moments | warm, soft contrast | acoustic/piano, natural sound up | handwritten or soft serif, sparing |
| Playful | quick timing, comic holds | surprising angles, jump cuts allowed | bright, saturated | quirky/upbeat, sound effects on gags | fun, bold, emoji ok |

## 7. Before proposing
- Length exact (ads: to the frame). Music ends with the picture on its real ending.
- Every cut within one frame of a beat or hit (cut list from `analyze_video` on the render vs the beats file).
- No C shots; no shot starting or ending on the camera settling; no shaky hero shot.
- Shots match in colour and exposure; nothing clipped.
- Text spelled right, inside safe areas, on screen long enough to read twice.
- Loudness -14 LUFS, peak ≤ -1 dBTP; music not drowning the natural-sound moments you wanted heard.
