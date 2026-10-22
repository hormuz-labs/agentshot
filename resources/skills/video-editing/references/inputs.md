# Using the files the user gave you

Users add more than footage: music, voice-over, logos, photos, subtitles, fonts, LUTs. Each is
copied into `media/` (a folder or .zip keeps its layout) and listed in `project_state` under `files` as
`path — what it is`. A message lists the files attached to it under `[attached files]`. Commands below were tested with
Manul's bundled ffmpeg.

## Rules for every file
- Attached to a request = meant for it. A file in the project that the request doesn't mention: use it only when the
  request clearly needs it ("add my logo" and there is one logo). Two candidates (two logos, two .srt files): ask.
- Say which files you used and how ("burned in clip.en.srt with your Brand Bold font").
- Never change files in `media/`. Write what you derive (retimed subtitles, an ASS file, a cut list) to `renders/`.
- A summary that says Manul can't read or decode a file means you can't either: say so and ask for another format.

## Subtitles (.srt, .vtt, .ass, .ssa, .sbv)
The summary gives the cue count, time span and first words; `goes with media/x.mp4` means its times are on that file's
clock. Non-UTF-8 files were converted on import.
- **Their words are checked by a person: prefer them to the transcript's.** Cut on the transcript's word times, though:
  cue times are only roughly on the speech (often ±0.3 s).
- Subtitles in another language than the speech are a translation: keep them as they are; never "fix" them against
  the transcript.
- **Burn them as they are** (SRT/VTT; sizes are on a 288-unit-tall canvas whatever the video's size, so Fontsize 16 ≈
  5.5 % of the height, MarginV 20 ≈ 7 %):
  ```bash
  ffmpeg -y -i renders/cut.mp4 -vf "subtitles=f=media/clip.srt:fontsdir=<fonts folder>:force_style='Fontname=Inter,Fontsize=16,Bold=1,Outline=1.5,Shadow=0,MarginV=20'" \
    -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy -movflags +faststart renders/subtitled.mp4
  ```
  An .ass/.ssa file carries its own styles and positions: burn it without `force_style` (still with `fontsdir`).
- **Restyle them** (word highlight, boxes, other positions, vertical video): convert to ASS with the short-form skill's
  template (short-form/references/captions.md), one `Dialogue` per cue, times `H:MM:SS.cc`.
- **When your edit changes the timing, retime them** — subtitles for the original are wrong on a cut. For each kept
  range `[a, b]` of the source placed at output time `o`: a cue `[s, e]` inside it becomes `[s − a + o, e − a + o]`;
  a cue in a removed part goes; a cue across a cut keeps only its part inside the kept range (drop pieces under 0.3 s
  and merge a cue split by a tiny cut). Write the result to `renders/<name>.srt` with the write tool, numbered from 1,
  times `HH:MM:SS,mmm`. Check the count and the last cue's end against the cut's length.
- In the picture or as a separate file: if the user didn't say, ask (`ask_user`). A separate file goes next to the
  render as `renders/<name>.srt` (or .vtt for the web), retimed to the cut.

## Fonts (.ttf, .otf, .ttc)
The summary gives the family and style: `font “Brand Sans” Bold (Brand Sans Bold)`.
- **Captions and subtitles: `fontsdir=fonts`** (the project's fonts/ folder: every font the user added, plus Manul's
  Inter) and `Fontname=` the family exactly as listed; for a Bold style add `Bold=1` (ASS: `-1`), the family stays the
  same. Never `fontsdir=media`: libass loads every file in that folder, footage included. A wrong name falls back to a
  system font silently: `look` at a frame to check.
- `drawtext`: `fontfile=fonts/<file>` (or the file in media/).
- A font the user gave is their brand: use it for all text unless asked otherwise.
- Web fonts (.woff, .woff2) only work in motion clips (CSS `@font-face` with `src: url('../../media/<file>')`).

## LUTs (.cube, .3dl)
- `lut3d=file=media/look.cube` (1D .cube: `lut1d`). The summary gives the size and title.
- **Log footage + a conversion LUT** (a name like "LogC to Rec709", "S-Log3", "V-Log to 709", "Log to Rec709"):
  apply it first, before any other colour work, at full strength.
- **Creative LUTs** go after correction and are often too strong at 100 %: mix 50–80 % back with the original:
  ```bash
  -filter_complex "[0:v]split[a][b];[b]lut3d=file=media/look.cube[l];[l][a]blend=all_mode=normal:all_opacity=0.7[v]"
  ```
  (`all_opacity` is the LUT's share.) `look` at frames before and after; skin must still look like skin.

## Images: logos, photos, graphics
`look` at an image before using it (`look` with `image=media/logo.png`): what it shows, light or dark, transparent or
not (the summary says "transparent background").
- **Logo bug**: a corner (top-right unless the user says otherwise), width 8–12 % of the video's width,
  margin ~4 % of its height, clear of faces and captions; the whole film or only the end card (ask if unclear).
  A logo without transparency on a solid background looks cheap as a box: ask for a PNG with transparency, or an SVG.
  For a 1920×1080 film, 10 % wide, top-right, fading in at 1 s:
  ```bash
  ffmpeg -y -i renders/cut.mp4 -loop 1 -i media/logo.png -filter_complex \
    "[1:v]scale=192:-1,format=rgba,fade=t=in:st=1:d=0.5:alpha=1[logo];[0:v][logo]overlay=W-w-43:43:shortest=1,format=yuv420p[v]" \
    -map "[v]" -map '0:a?' -c:v libx264 -crf 18 -preset medium -c:a copy -movflags +faststart renders/logo.mp4
  ```
- **Photos** in the film: references/ffmpeg.md (Photos) and the promos-and-montages skill.
- **SVG**: ffmpeg can't read it; use it in a motion clip (`<img src="../../media/logo.svg">`), which also suits
  animated logos and end cards.

## Audio: music, voice-over, sound effects
- Music: `analyze_music` first, then references/music-sync.md. Use only music the user gave or owns.
- Voice-over: `transcript` it, then cut the picture to it (the voice leads; picture on its phrases).
- Sound effects: a few, in sync (craft.md, sound).

## More footage, b-roll
`analyze_video` every new source before using it. B-roll over speech covers jump cuts and shows what's being said;
the speaker's sound continues under it.

## Text and data (.txt, .md, .csv, .json, .edl, .fcpxml, .otio)
Read them directly. A CSV shot list: one row per shot. An EDL or FCPXML from another editor: the source ranges of an
edit; rebuild it with the same in and out points when the sources are in media/ (match by file or reel name).

## Files Manul doesn't read
Documents (PDF, Word, slides, spreadsheets) and archives other than .zip are only listed. If the request depends on one,
ask the user to paste the text into the chat or send the files themselves.
