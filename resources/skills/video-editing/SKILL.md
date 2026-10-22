---
name: video-editing
description: How to edit any video well, step by step: measuring the footage first, structure and the opening seconds, choosing and ordering shots, continuity, pacing, cutting picture to music on the beat, sound and loudness, colour, stabilising, text, export and checking a render. Read before any edit beyond a single trim; talking-head, motion-design and music-generation add to it.
---

# Editing a video well

Edits are judged by people who watch for a few seconds and leave if bored, confused or annoyed by the sound. Every rule
here comes from that. Numbers are defaults: when the user asks for something else, do that.

Deeper material, read when the step needs it:
- references/briefs.md — working out what the user wants: which kind of video it is, when to ask, and ready-made
  questions with options. **Read it when the request leaves the kind, platform, length, feel or music open.**
- references/craft.md — the fundamentals (rule of six, continuity, 30°/180°, cut types, shot choice, pacing tables,
  structures for promos/trailers/YouTube/events/tutorials, what "cinematic" means, colour, sound, text, amateur mistakes).
- references/music-sync.md — cutting picture to music and fitting music to picture, with a worked example. **Read it
  before any edit that has music.**
- references/ffmpeg.md — tested commands (keep ranges, J/L cuts, 9:16 crops, speed ramps, photos, music edits, loudness);
  stabilising, grading and sound repair commands are in the cleanup-and-repair skill.
- references/checks.md — what to verify on a render before proposing it.
- references/inputs.md — using the files the user gave you: subtitles (burn, restyle, retime after a cut), fonts, LUTs,
  logos, music, more footage. **Read it whenever a request involves a file the user added.**

## 1. Workflow (follow in order)
1. **Know what you were given**: `project_state` lists every file the user added (footage, music, subtitles, fonts,
   logos, LUTs) with what it is; a message lists its attachments under `[attached files]` (references/inputs.md).
   **Measure the material** (never guess it): `analyze_video` on every source — shots and cut times, shake and camera
   motion per shot, exposure, contrast, colour cast, black/frozen frames, loudness, silences, and one frame per shot.
   `transcript` for speech, `speakers` for who speaks when, `find_subjects` for where faces and objects are (and crops
   that follow them), `analyze_music` for any music. `look` only for what those can't say (what a shot means, where
   text is, where an action peaks).
2. **Know the kind of video and read its skill** (references/briefs.md §2): talking video or conversation →
   talking-head; screen recording → tutorials; ad, promo, recap, trailer, highlights, photos → promos-and-montages;
   Reels/TikTok/Shorts or clips from a long video → short-form; "fix it / clean it up" → cleanup-and-repair; graphics →
   motion-design; music needed → music-generation. Often two or three apply: read them all.
3. **The brief**: who watches, where (it decides shape and length), how long, the feel, music. What the user said, the
   footage and memories answer most of it. For what's left and really changes the edit, ask ONCE with `ask_user`
   `questions` (up to 4, recommended option first, plain words; references/briefs.md §3). For open requests ("make it
   cinematic", "clean it up", "make it better") also say in 2–4 short lines what you found (e.g. "shots 2 and 4 are very
   shaky, 1 and 3 are dark, the sound is quiet at -24 LUFS") and add the fixes to the same card as a `multiple`
   question. Precise requests need no questions.
4. **Plan on paper first**: the structure (section 2), the shot order and every kept range (source in–out), music slots
   if there is music (music-sync.md), text and its timing, sound. Times on the frame grid (`round(t × fps) / fps`).
5. **Render once**: one ffmpeg command for the whole edit (references/ffmpeg.md). Write to renders/.
6. **Check** (references/checks.md): `analyze_video` on the render, `look` at the start, the end and the tricky cuts.
   Fix what fails. Then `propose_version` once, with a one-line title of what changed.

## 2. Structure
- **The first 3 seconds decide everything.** Open on the strongest moment: the result, the surprise, the face, the
  hero shot, the line that makes the promise. No logos, no "hi guys", no slow fade from black, no title card first.
- **Deliver what the title/thumbnail promised within ~15 s.** Viewers who don't see it leave.
- Use a proven structure for the kind of film (craft.md §7: commercial, trailer, YouTube, event, tutorial, interview).
  For a promo: hook → desire → reveal (on a music lift) → proof montage → payoff → end card on the final hit.
- In a story, opening on the payoff means a short flash-forward (1–3 s), then the story in order. Otherwise keep the
  order of events.
- Every 1–2 minutes of a long video give a reason to keep watching: a question, a turn, "but then…". Cut repeats.
- End cleanly: the last line or image, held 1–2 s (with music: through its ring-out). No long outro unless asked.
- Keep the user's words and order when they gave a script. Don't shorten their content to hit a length unless asked.

## 3. Shots: choosing, ordering, continuity
- Choose takes: in focus → subject visible → steady (stabilise or drop "very shaky") → exposed → best moment.
- **Trim every clip's head and tail**: no camera settling, no reframing, no first/last wobble of a handheld move.
- Build sequences wide → medium → close (where → who → what matters); go back to a wide when the place changes.
- **Never cut between two shots of the same subject that differ by less than ~30° in angle or one step in size**: it
  looks like a mistake (jump cut). Change size clearly, change angle, or put a cutaway between.
- **Keep screen direction**: something moving left→right keeps moving left→right across cuts; people facing each other
  stay on their sides (180° rule). Change direction only through a neutral (head-on/away) shot.
- **Motion across cuts**: cut moving→moving in the same direction or still→still; let camera moves finish, or cut
  mid-move into a matching move. Cut on action (a third of the way into a movement) to hide the cut.
- Put the subject of the next shot where the eye already is (eye-trace), unless the jolt is the point.
- Use details (hands, textures, product details) and reactions: they make a film feel crafted and carry emotion.
- Every shot needs a reason to be there. If you can't say why, cut it.

## 4. Pacing: energy comes from cuts, not effects
- **More energy = more cuts, cut on words and beats, bigger subjects in frame.** Never add camera shake, flashes,
  glitches, RGB splits, blur pulses or random zooms to "add energy": they look cheap and tire viewers.
- Shot lengths: see craft.md §6 (social 1–3 s, promo 1–2.5 s, brand film 3–6 s, talking 3–8 s, interview 4–10 s).
  A shot under ~0.4 s (≈12 frames) reads as a glitch unless it's part of a deliberate burst.
- Vary length and kind (long–short–short–long; wide/close; still/moving). Uniform lengths feel mechanical.
- Cut **on**: the start of a word or sentence, a musical beat (music-sync.md), the peak of an action, a look or turn.
  Don't cut in the middle of a word, of a gesture about to land, or on the first/last frames of a camera move.
- **J and L cuts**: the next shot's sound starts 0.2–0.5 s before its picture (J), or the old sound runs under the new
  picture (L). It makes cuts smooth; straight cuts on both are for hard punctuation.
- Jump cuts in a talking head are fine when deliberate; to hide one, alternate framing (100 % and a 115–130 % punch-in on
  the face) or cut away to b-roll — never zoom so far that heads or text are cut off.
- Hold on what matters: a reaction, a punchline, a reveal gets an extra 0.5–1 s.
- Speed up toward the climax, slow down after it. That contour is the film's emotion.

## 5. Music and picture (read references/music-sync.md before any edit with music)
- **Measure the music with `analyze_music`** — never estimate beats. Use the beat times from its file.
- **Decide who leads**: picture cut to music (montage, promo, trailer, recap, social, music video) or music fitted to
  picture (speech-led films).
- **Cuts land on beats** (the frame nearest the beat; one frame early on hard hits; never late). Big changes —
  the reveal, the hero shot, a new location, the title — go on section starts (lifts/drops) and the strongest hits.
- **Cut rate follows the music's energy**: slow in intros and breaks (every 1–2 bars), building through builds, bursts of
  1–2 beat cuts in drops (then a held shot), long holds at the end.
- **Action inside shots lands on beats too**: slide the in-point so the jump lands, the wheel passes, the door shuts on
  a beat.
- **Music ends with the film** on its real ending (back-timed), never cut mid-bar, never still playing over black.
  Shorten or lengthen music only in whole bars (ideally whole phrases), downbeat to downbeat, with a short crossfade.
- Speed ramps start on a beat and return to speed on the next downbeat; titles and transitions sit on beats.

## 6. Sound (people forgive a bad picture, never bad sound)
- **Speech is king.** Voice clearly on top: music and effects at least ~10 dB below speech (`set_mix` duck_db 8–14).
  A steady dip under whole phrases — music jumping back up between words (pumping) is the most common complaint.
- Music with no speech over it can come up 3–6 dB (it's a moment, not a bed). Fade music in/out (≥ 1 s) unless it starts
  on a downbeat or ends on its real ending.
- **Every audio cut gets a 10–30 ms crossfade** or it clicks. Cut speech only on word boundaries (the transcript's word
  times), never inside a word. Fill removed gaps with the room's own quiet, not digital silence.
- Level-match: speech within ~±1 dB between clips. Don't add reverb or echo to voices; don't stack effects on speech.
- Keep some natural sound of the footage under montage music (ducked); it makes it feel real.
- Sound effects: a few big ones in sync (a whoosh peaking on a cut, a riser ending on a reveal, an impact on a hit).
  Never small pops/pings/dings on every cut or text.
- Delivery loudness: **-14 LUFS integrated, true peak ≤ -1 dBTP** for YouTube/social/web (podcast -16 LUFS). Measure
  with `analyze_video`, normalise with two-pass `loudnorm` (references/ffmpeg.md) as the last step. Never clip.
- Use only music the user provided or owns the rights to; don't fetch random songs. Original music made for the film
  is fine: read the music-generation skill.

## 7. Picture
- **Nothing over faces**: text, captions, logos and lower thirds go in the free space, not across eyes or mouths.
- Vertical (9:16) from horizontal: crop to the subject per shot (`find_subjects` gives each shot a crop that follows
  it), don't letterbox with a blurred copy unless asked. Keep important things out of the platform UI zones: top ~12 % and bottom ~22 %.
- **Shake**: a shot `analyze_video` calls shaky or very shaky gets stabilised with vid.stab (the cleanup-and-repair
  skill has the commands) — two passes, smoothing ~0.5–1.5 s, a small zoom to hide moving edges. Don't stabilise
  deliberate motion (a whip pan, a run) or steady shots. Slight shake on handheld often reads as life; leave it.
- **Colour**: correct first (exposure, white balance, matching shots — use `analyze_video`'s luma, contrast, saturation
  and cast numbers), then a gentle look only if asked or for "cinematic" (craft.md §8–9; cleanup-and-repair has the
  commands). Consecutive shots must match. No heavy LUTs unless asked. Never clip highlights while lifting.
- **Speed**: slow motion and ramps on footage with sound use `rubberband` for the sound (pitch stays); slow motion below
  ~0.5× needs a high-frame-rate source or it stutters (`minterpolate` only for short moments).
- Text on screen: short (≤ 6–8 words), readable twice (~0.3 s per word, at least 1.5 s), large, high contrast, inside the
  safe area, appearing and leaving on beats when there's music. Text cards ≤ ~10 % of runtime.
- Captions: 1–2 lines, ≤ ~32 characters per line, split at phrase boundaries, timed to the words. Burned-in captions
  help muted social viewing; ask before adding them if the user didn't say.
- Never leave frozen frames, black frames or flashes of the wrong shot at cut points.

## 8. Export
- Keep the source frame rate. Don't scale above the source size unless asked; a 9:16 crop of a 1080p source scaled to
  1080×1920 is normal for social. One finished version, not alternates (unless asked).
- Default: H.264 (`libx264 -crf 18 -preset medium -pix_fmt yuv420p`), AAC 192 kb/s 48 kHz, `-movflags +faststart`.
  Sizes: 1920×1080 (16:9), 1080×1920 (9:16), 1080×1080 (1:1). Use `export_video` for these presets.

## 9. Check before proposing
Run references/checks.md on the render (`analyze_video` on it is one pass): duration as planned, no black or frozen
frames, no unintended silence, loudness on target, shots you stabilised now steady, cuts on the beats when cut to music
(within one frame), music ending with the picture. Then `look` at the start, the end and each tricky cut. Fix what
fails, then `propose_version` once, saying in one line what changed.

## 10. Taking notes from the user
- A note on a moment means *that* moment: change it and as little else as possible.
- When the user corrects how something should be done for good ("never use that transition"), save it with
  `remember` so the next edit gets it right.
