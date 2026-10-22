---
name: music-generation
description: Making original music for a film with generate_music: when to generate, writing the brief from the edit (mood, BPM, length, sections that hit the cuts), checking the track and fitting it under the picture with set_mix. Read before generating or scoring music; video-editing covers the mix.
---

# Generating music for a film

Music made for this film, to its length and its moments, beats a stock track looped under it. `generate_music` makes
it; the ffmpeg to fit it is in references/fitting.md. Numbers are defaults: when the user asks for something else, do that.

## 1. When
- The user asks for music, a score, a bed, a sting or a jingle; or the edit clearly needs music and none was provided.
  Generated music is original, so it passes video-editing's rule on rights. Music the user provided always wins.
- Never ask for a named artist, song or voice ("like Hans Zimmer", "Blinding Lights"): the APIs block it, and it
  isn't ours to copy. Describe the sound instead (instruments, tempo, mood, era).
- Each generation costs the user money (their own key, or their Manul credit). If they didn't ask for generated music
  themselves, ask once with `ask_user` (how long, what feel). Make **one take**; offer another instead of making several unasked.

## 2. Who makes it
`generate_music` uses the user's own ElevenLabs or Gemini key when they have one, otherwise their Manul key (Manul
chooses the model). Don't call music APIs yourself. Pass `provider` only when the user asks for one of their own keys.
If it says there is no key, tell the user in one line what unlocks it (sign in to Manul, or an ElevenLabs or Google
Gemini key in Settings → Keys) and stop. Don't browse for random music instead.

## 3. The brief comes from the film
- Read the film first: `analyze_video` (duration, every shot's cut time, silences, loudness) and the `transcript`
  (where speech is and where it stops). Write down the moments the music should answer: the opening, the reveal, the last line.
- **Role:**
  - Bed under speech: instrumental, sparse, no lead melody or vocals fighting the voice, steady energy.
  - Moment with no speech (montage, reveal, product shot): the music can carry the melody and come up.
  - Sting or transition: 2–5 s with a clear hit. Intro/outro: short, ends on a resolved chord.
- **Who leads?** (video-editing's music-sync.md) For a montage/promo the music comes FIRST and the picture is cut to it:
  generate the length the film should be, with sections where the story turns, then cut to the beats you measure. For
  a speech-led film the picture is fixed: generate to its length with sections at its moments.
- **Length**: the film's length + 2 s (trim the extra on a bar at the end), so set_mix never loops it (a loop seam is
  audible). Ask for a real ending ("ends on a final hit and a ringing chord"), not a fade. Longer than 10 min: generate
  in parts that hand over on a section change.
- **Fix a BPM in the brief.** In 4/4 a bar lasts 240/BPM s (120 BPM → 2 s), so you can place section changes on the
  film's moments and cut or end the music on a bar instead of mid-note.
- **Score to picture:** `sections` that follow the film (quiet intro under the opening lines, lift at the reveal, resolve
  under the last line), each 3–120 s, adding up to `seconds`. Section lengths are a strong hint, not a guarantee.
- **Prompt:** genre, mood, lead instruments, BPM, key, the energy curve, and "instrumental, no vocals" unless the user
  wants singing. Concrete words ("warm Rhodes, brushed drums, upright bass, 92 BPM, D minor, builds at 0:42"), not
  adjectives like "epic" or "cinematic" alone.

## 4. Generate
- `generate_music` with `prompt`, `seconds`, `instrumental` (default true), `sections` when scoring to picture, and a
  short `name`. It saves `generated/music-<name>.mp3` (or .wav) and says how long it came out.
- On a failure read the error once and fix the cause: a field (it says which), out of credit (tell the user how to add
  it), too many requests (wait, then try once), a refused prompt (reword it: usually a name). No retry loops.

## 5. Check before using it
- `analyze_music` it: the real BPM, the bars, where the lifts and drops actually fell, the hits, and the beats file.
  Generated music is never exactly the BPM or section times you asked for — **cut to what you measured**, not to the
  brief. If a planned big moment (the reveal) misses the music's lift by more than a beat, move the cut to the lift, or
  slide the music, or regenerate with adjusted section lengths.
- `probe` it: the duration is what you asked for (not always exact: trim on a bar with a fade, or regenerate).
- Leading silence (`silencedetect`): trim it so the music starts on time.
- Loudness: normalise the track to -14 LUFS (references/fitting.md) so set_mix levels mean the same for every track.
- Instrumental isn't always guaranteed. The `transcript` of the file hints at vocals, but whisper makes up a few words
  on any music: only real sung lines count.

## 6. Fit it under the picture
- `import_media` the file, then `set_mix`: under speech db -18 to -12, duck_db 8–14; a film with no speech can sit
  near -6. Speech stays on top (video-editing §4).
- set_mix plays the music from 0 to the end (looped if short, 1 s fade in, 2 s fade out). For music that starts
  later, stops early or changes at a moment, prepare the file with ffmpeg first (silence before it, a cut on a bar, a
  fade) and set_mix that file.
- Cutting picture to it: follow video-editing's music-sync.md — cuts on measured beats, big moments on lifts and hits,
  the end card on the final hit, the music ending with the picture.

## 7. Say what it is
- One line: it's generated music and how long it is. With the user's own key, name the provider (generate_music says
  it); with Manul, just say Manul made it. Generated tracks carry an AI watermark (C2PA or SynthID).
- Rights follow the user's plan with that provider (or Manul's terms). If the film is for a client or ads, say so once.
- When the user corrects the music for good ("never vocals", "always lo-fi"), `remember` it.
