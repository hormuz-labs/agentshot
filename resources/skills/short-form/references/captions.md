# Word-by-word captions with an .ass file

Tested with Manul's bundled ffmpeg (libass). Write the file with the write tool into the project (e.g.
`renders/captions.ass`), then burn it in the same ffmpeg command as the rest of the edit.

## 1. The template (1080×1920)
```
[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Inter,86,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,7,3,2,90,90,560,1
Style: Hook,Inter,72,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,3,18,0,8,90,90,300,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:02.50,Hook,,0,0,0,,This changed everything
Dialogue: 0,0:00:00.20,0:00:00.55,Caption,,0,0,0,,{\c&H00D7FF&}NOBODY{\c&HFFFFFF&} TOLD ME
Dialogue: 0,0:00:00.55,0:00:00.90,Caption,,0,0,0,,NOBODY {\c&H00D7FF&}TOLD{\c&HFFFFFF&} ME
Dialogue: 0,0:00:00.90,0:00:01.30,Caption,,0,0,0,,NOBODY TOLD {\c&H00D7FF&}ME{\c&HFFFFFF&}
```
- `Caption`: Inter Bold 86 px, white, 7 px black outline + soft shadow, bottom-centred (Alignment 2) with its baseline
  560 px above the bottom (≈ 71 % of the height: above the platforms' bottom zone).
- `Hook`: white text on a black box (BorderStyle 3), top-centred (Alignment 8), 300 px from the top (below the top zone).
- Colours are `&HAABBGGRR` in styles and `&HBBGGRR&` in `{\c…}` overrides: yellow #FFD700 → `&H00D7FF&`,
  white → `&HFFFFFF&`, brand colour #RRGGBB → `&HBBGGRR&`.
- For 1920×1080 (horizontal) set PlayResX 1920, PlayResY 1080, Fontsize ~64, Caption MarginV ~90.

## 2. Building the events from the transcript
- When the user gave subtitles (.srt/.vtt), use their words (a person checked them) and the transcript's word times
  for the highlight timing; retime them to the cut first (video-editing/references/inputs.md).
- A font the user gave goes in `Fontname` (its family, from project_state) with `fontsdir=fonts`.
- Group the words into chunks of 1–3 words (break at punctuation and natural phrases; never split a name or number).
- For each word in a chunk, one Dialogue line from that word's start to the next word's start (the last word of a chunk:
  to its end + 0.15 s, or the next chunk's start if sooner), showing the whole chunk with that word coloured.
- Times are `H:MM:SS.cc` (hundredths) **on the edited timeline**: after cutting, shift every word time by where its
  kept range landed. Easiest: build captions from the transcript of the cut (`transcript` on the render), then burn in
  a second, fast pass that copies the audio (`-c:a copy`).
- Upper-case for punchy social style, or sentence case for calmer content; strip fillers ("um", "uh") from captions.
- Escape `{`, `}` and `\` in caption text (or remove them).

## 3. Burning it
```bash
ffmpeg -y -i renders/cut.mp4 -vf "subtitles=f=renders/captions.ass:fontsdir=<the fonts folder from your instructions>" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a copy -movflags +faststart renders/captioned.mp4
```
Then `look` at 2–3 moments: the highlighted word is the one being said, nothing covers a face, everything is inside the
safe zones.
