# Cutting picture and music together

Viewers feel sync before they can name it. A montage whose cuts land on the beat feels intentional and expensive; the
same shots cut 3 frames late feel clumsy, even to people who "know nothing about editing". Music that ends with the
picture feels finished; music that is faded out somewhere in the middle of a bar feels cheap. This file is how to do
it with numbers instead of guesses. Read it before putting music under picture or cutting picture to music.

## 0. Facts first (never guess a beat)
1. `analyze_music` on the track → BPM, how steady the tempo is, every bar (downbeat time + loudness), where the energy
   lifts, drops or breaks, the strongest hits, and a JSON file with **every beat time**. Read that file; use its times,
   not BPM arithmetic (real music drifts a few milliseconds per bar, and generated music is never exactly the BPM asked).
2. `analyze_video` on the footage → shots, their motion and shake; one frame per shot to know what each shot is.
3. The `transcript` if anyone speaks.
4. Decide **who leads**:
   - **Picture cut to music** — montages, promos, commercials, trailers, recaps, travel/event films, social shorts, music
     videos, anything without important speech. The music is laid first and the picture is cut to its grid.
   - **Music fitted to picture** — interviews, tutorials, vlogs, talking heads, anything where speech carries the film.
     The picture edit stays; the music is cut, looped and back-timed to fit it, with its hits placed on key moments.
   - A promo with a voice-over is picture-to-music for the montage parts and music-under-speech for the VO (duck it).

## 1. The grid
- beat = 60 / BPM s. bar = 4 beats (4/4 is assumed; nearly all pop, electronic, rock and trailer music). phrase = 4 or 8
  bars. At 120 BPM: beat 0.5 s, bar 2 s, 8-bar phrase 16 s. At 90 BPM: beat 0.667 s, bar 2.667 s.
- **Frames**: every cut happens on a frame. Convert a time to the frame grid: `frame = round(t × fps)`, cut time =
  `frame / fps`. At 30 fps one frame is 33 ms; at 24 fps 42 ms; at 60 fps 17 ms. Never pass a time between frames.
- **Where exactly**: cut ON the beat (the frame nearest the beat time). For hard hits (a drop, a slam, a big kick) cut
  **one frame early**: the eye registers a cut slightly after the frame changes, so 1 frame early reads as exactly on
  the hit. Never cut after the beat — late cuts are what make an edit feel sloppy.
- If `analyze_music` says the tempo drifts or there is no steady beat, cut on its listed hits and phrase changes, not a
  computed grid.

## 2. How often to cut (cut density follows the music's energy)
Use the energy runs `analyze_music` gives (quiet / mid / full, lifts, drops, breaks):

| Music section | Cut every | Shot feel |
|---|---|---|
| Intro, quiet, ambient | 2 bars (or 1 bar at fast tempos) | wides, establishing, slow moves; let shots breathe |
| Verse / mid energy | 1 bar, sometimes 2 beats | variety of sizes, story shots |
| Build / riser (energy climbing) | accelerate: 1 bar → 2 beats → 1 beat in the last bar | tighter shots, faster motion; tension |
| Drop / chorus / full energy | 1–2 beats, in bursts of at most ~8 cuts, then hold a shot for a bar | the best, most dynamic shots |
| Break / breakdown (energy falls) | hold one shot through it, or 1 cut per 2 bars | a hero shot, slow motion, a wide, a face |
| Outro / ending | 2 bars and longer, the last shot held to the end | resolution, logo, final image |

- Tempo: above ~140 BPM count in half-time (cut on every second beat at most). Below ~80 BPM you may cut on half-beats
  in the peaks.
- Never a shot shorter than ~0.4 s (≈12 frames at 30 fps) except a deliberate flash burst of 3–6 shots. A shot must last
  long enough to show what it is.
- Mix it up: a cut on every single beat for more than ~8 beats is tiring and looks mechanical. Hold, then burst.
- Changing cut rate IS the feeling: speeding up builds tension, slowing down releases it. Plan it with the energy runs.

## 3. What goes where
- **Section starts (a lift or drop, a new phrase after a break)**: the biggest change in the film — new location, the
  reveal, the product hero shot, the title, the first frame of the best shot, the end of a speed ramp.
- **The strongest hits** (`analyze_music` lists them): cuts, title slams, on-screen impacts (a door shutting, a foot
  landing, a car passing the lens, a ball hit). Off-beat hits are accents: use one for a quick insert or ignore it.
- **Phrase boundaries (every 4 or 8 bars)**: chapter changes — the next location, the next topic, the next day.
- **Action inside a shot syncs too.** Slide the shot's in-point so its action peak (the jump's landing, the wheel
  passing, the glass touching the table, the smile) lands on a beat. Find the peak with `look` (frames every 0.1–0.2 s
  around the action) and set `in = peak_time − (beat_time − slot_start)`.
- **The end**: the final shot or logo arrives on the last downbeat or final hit and holds through the music's ring-out.
  The picture ends when the sound has decayed (the end of `analyze_music`'s "Sound from … to …"), not on the hit itself
  and not seconds after the music stopped.
- **Speed ramps**: start the ramp on a beat, let the slow part span half a bar or a bar, return to full speed exactly on
  the next downbeat. Never ramp off the beat.
- **Transitions** (a whip pan, a flash, a dip): centre them on the beat. A whoosh peaks on the cut.
- **Titles and text**: appear on a beat (a downbeat for main titles), leave on a beat.

## 4. Music fitted to picture (speech-led films, or when the track is the wrong length)
- **It must end with the film.** Back-time it: line the music's ending (its final hit/downbeat plus ring-out) up with the
  film's end, so the music starts `music_end_point − film_length` seconds into the track. If that makes the music begin
  mid-phrase, either start at the film's start with a 1–2 s fade-in, or cut the track (below) so a phrase starts there.
- **Shortening**: remove whole bars — ideally whole 4- or 8-bar phrases — cut from a downbeat to a later downbeat so the
  meter carries on, at a place where the energy on both sides is the same (same level in `analyze_music`'s bars). Join
  with a 10–30 ms crossfade (a sustained pad or reverb tail may need a crossfade of up to one beat). Never remove part
  of a bar: the beat stumbles and everyone hears it.
- **Lengthening**: repeat whole phrases (downbeat to downbeat) from the middle of the track. Never repeat the intro or
  the ending. Don't loop the same 4 bars more than twice in a row.
- **Never stop music mid-bar** unless it is a deliberate hard stop on a picture hard cut (a gag, a silence, a record
  scratch) — then 10–15 ms fade, and make the silence count.
- **Starting**: start on a downbeat or on the music's first sound, not in the middle of a held note.
- **Endings**: a real ending (the track's ending section, back-timed) beats a fade every time. Fade out only when no
  ending fits; then fade over ≥ 2 s and finish the fade on a bar line.
- **Hits on picture**: slide the whole music bed (or edit it) so one or two big hits land on the film's key moments —
  the reveal, the punchline, the logo. One good hit placement is worth more than a perfectly even bed.
- **Under speech**: keep the bed steady and at least ~10 dB under the voice (`set_mix` duck_db 8–14). Let it come up
  3–6 dB where nobody speaks, and drop it back 0.3–0.5 s before the next word.

## 5. Procedure: cutting picture to music
1. `analyze_music` → open the beats file. Note BPM, beat, bar, the energy runs and the hits.
2. Choose the part of the track to use; its length is the film's length. Adjust only in whole bars (whole phrases if
   you can). Prefer starting on a phrase start and ending on the track's real ending.
3. Write the **slot list**: from the used part's downbeats and beats, using the density table, a list of slots
   `[start, end)` — e.g. intro: one slot per 2 bars; build: per bar, then per 2 beats; drop: per beat in a burst of 8,
   then a 1-bar hold. Big moments (section starts, top hits) are slot starts.
4. **Cast the shots** into slots: the strongest shots on the section starts and hits; story order otherwise (setting →
   people → detail → peak → resolution). Don't put two shots of the same size and angle next to each other. Each shot
   needs at least the slot length of usable footage without shake (check its `analyze_video` shake; skip unusable
   starts/ends of handheld shots).
5. For each slot choose the shot's in-point so its best moment or action peak lands on the slot's first beat/hit.
6. Convert every slot boundary to frames (`round(t × fps) / fps`), check that slot lengths add up exactly to the music
   length, and build ONE ffmpeg command: trim/concat for the picture, the music as the audio (or mixed under the shots'
   own sound if their sound matters), the music's ending untouched, 15 ms fades on every audio edge you made.
7. Verify: `analyze_video` on the render lists the cuts. Every cut must be within one frame of a beat (or of its intended
   hit, or 1 frame before a hard hit). Any cut off by 2+ frames: fix it before proposing.

**Worked example** — 30 s car promo on a 120 BPM track with a lift at bar 5:
- beat 0.5 s, bar 2 s. Use bars 1–15 (0:00.00–0:30.00), the track's ending lands at 0:30.00.
- Bars 1–3 (0–6 s, quiet): 1-bar slots (2-bar slots would be too slow for a 30 s promo) — details of the car: badge,
  headlight, wheel — 3 shots × 2 s.
- Bar 4 (6–8 s) is the build: a 2-beat slot at 6.0 (interior), then 1-beat slots at 7.0 and 7.5 (quick details).
- Bar 5 downbeat (8.0 s, lift): THE hero shot — the car driving toward camera — held 2 bars (8–12 s).
- Bars 7–12 (12–24 s, full): driving shots, 2-beat slots with a burst of 1-beat slots in bar 10, a 1-bar hold in bar 11.
- Bars 13–14 (24–28 s, break): slow, wide, the car parked in light, held through.
- Bar 15 downbeat (28.0 s, final hit): logo/end card held to 30.0 s while the last chord rings.
At 30 fps the cut at 7.5 s is frame 225; the hit at 8.0 s is frame 240, cut at frame 239 (one frame early).

## 6. Procedure: fitting music to a finished picture
1. `analyze_music` on the track; the picture's length is fixed.
2. Pick the ending: the track's own ending (last downbeat + ring-out). Back-time: music offset = ending time − film length.
3. If the offset lands mid-phrase or in the intro's wrong place, edit the track in whole bars (section 4) until it fits;
   or start it later in the film with a fade-in at a natural point (after the hook, on a scene change).
4. Place 1–2 hits: slide or edit the music so a strong hit lands on the most important picture moment.
5. Mix: `set_mix` (ducking) or one ffmpeg command with the edited music; render; check loudness (-14 LUFS for web).

## 7. Sound effects in sync
- Whoosh: its loudest point exactly on the cut (most whooshes start 0.3–0.6 s before their peak — measure the file).
- Riser: ends exactly on the drop/reveal downbeat; usually 2–4 bars long, cut from its start so the end lands right.
- Impact / boom / hit: on the frame of the reveal or the beat it doubles.
- Few: 2–5 effects in a 30 s promo is plenty. At least 6 dB under the music's peaks; never on every cut.

## 8. Checks before proposing (numbers, not feelings)
- Every picture cut within 1 frame of a beat or a listed hit (or 1 frame before a hard hit), unless it is a speech cut.
- No shot shorter than ~0.4 s outside a deliberate burst.
- Music ends with the picture on a real ending (or a ≥ 2 s fade ending on a bar line); no music still playing over black.
- Music edits only at downbeats, each with a short crossfade; no bar cut in half.
- Under speech: voice clearly on top, no pumping; music-only moments allowed to come up.
- Final loudness -14 LUFS integrated, peak ≤ -1 dBFS (web/social).
