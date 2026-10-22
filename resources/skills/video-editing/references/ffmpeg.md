# ffmpeg recipes for editing

All tested with Manul's bundled ffmpeg. Replace `in.mp4`, times (seconds) and sizes. Put the whole edit in ONE command.

## Find the shots
`analyze_video` lists every shot with its cut times (and much more). Only if you need a different sensitivity:
```bash
ffmpeg -hide_banner -i in.mp4 -vf "select='gt(scene,0.3)',showinfo" -an -f null - 2>&1 | grep -o "pts_time:[0-9.]*"
```
Lower 0.3 to find softer cuts, raise it if camera moves show up as cuts.

## Keep ranges (the core of every edit)
Keep 0.5–2.5 and 3.0–4.0, with 15 ms audio fades at every edge so cuts never click
(fade out starts at segment length − 0.015):
```bash
ffmpeg -y -i in.mp4 -filter_complex "\
[0:v]trim=0.5:2.5,setpts=PTS-STARTPTS[v0];[0:a]atrim=0.5:2.5,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=1.985:d=0.015[a0];\
[0:v]trim=3.0:4.0,setpts=PTS-STARTPTS[v1];[0:a]atrim=3.0:4.0,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=0.985:d=0.015[a1];\
[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]" -map "[v]" -map "[a]" \
-c:v libx264 -crf 18 -preset veryfast -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart renders/out.mp4
```
Add one `[vN]…[aN]` pair per kept range and set `concat=n=` to the count. Several input files: `-i a.mp4 -i b.mp4`
and use `[1:v]`, `[1:a]` for the second one (all parts must have the same size and fps — scale/fps them first).

## J cut / L cut (sound and picture change at different times)
Picture A 0–2 then B 3–5, but B's sound starts 0.3 s early (J cut). Cut video and audio separately; each side
must add up to the same length:
```bash
ffmpeg -y -i in.mp4 -filter_complex "\
[0:v]trim=0:2,setpts=PTS-STARTPTS[v0];[0:a]atrim=0:1.7,asetpts=PTS-STARTPTS,afade=t=out:st=1.685:d=0.015[a0];\
[0:v]trim=3:5,setpts=PTS-STARTPTS[v1];[0:a]atrim=2.7:5,asetpts=PTS-STARTPTS,afade=t=in:d=0.015[a1];\
[v0][v1]concat=n=2:v=1:a=0[v];[a0][a1]concat=n=2:v=0:a=1[a]" -map "[v]" -map "[a]" \
-c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac renders/out.mp4
```
L cut: the same with A's audio running 0.3 s longer and B's audio starting 0.3 s later.

## Crossfade between two shots (use sparingly: time passing, a mood change)
```bash
ffmpeg -y -i a.mp4 -i b.mp4 -filter_complex \
"[0:v][1:v]xfade=transition=fade:duration=0.5:offset=<length of a − 0.5>[v];[0:a][1:a]acrossfade=d=0.5[a]" \
-map "[v]" -map "[a]" -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac renders/out.mp4
```

## Vertical 9:16 from 16:9, framed on the subject
`find_subjects` gives each shot a crop filter that follows its subject — use it in place of the fixed crop below (after
the shot's trim, before the scale). By hand: `0.4` = where the subject's centre is, as a fraction of the width (0 left …
1 right); the min/max keeps the crop inside the frame. Different shots need different centres: crop each range on its own.
```bash
ffmpeg -y -i in.mp4 -vf "crop=w=ih*9/16:h=ih:x='max(0,min(iw-ow,iw*0.4-ow/2))':y=0,scale=1080:1920:flags=lanczos,setsar=1" \
-c:v libx264 -crf 18 -pix_fmt yuv420p -c:a copy renders/vertical.mp4
```

## Music under speech (prefer `set_mix`, which ducks and loops for you)
When music must be mixed in a render: a smooth duck (slow attack/release, so it doesn't pump between words):
```bash
ffmpeg -y -i film.mp4 -i music.mp3 -filter_complex \
"[0:a]asplit=2[voice][key];[1:a]volume=0.5,afade=t=in:d=1[m];[m][key]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=1200[duck];\
[voice][duck]amix=inputs=2:normalize=0:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k renders/mixed.mp4
```

## Loudness to -14 LUFS, true peak -1 dBTP (two passes)
Pass 1 measures:
```bash
ffmpeg -hide_banner -i in.mp4 -af "loudnorm=I=-14:TP=-1:LRA=11:print_format=json" -vn -f null - 2>&1 | sed -n '/^{/,/^}/p'
```
Pass 2 uses the numbers it printed (input_i, input_tp, input_lra, input_thresh, target_offset):
```bash
ffmpeg -y -i in.mp4 -af "loudnorm=I=-14:TP=-1:LRA=11:measured_I=<input_i>:measured_TP=<input_tp>:measured_LRA=<input_lra>:measured_thresh=<input_thresh>:offset=<target_offset>:linear=true,aresample=48000" \
-c:v copy -c:a aac -b:a 192k renders/final.mp4
```
Do it last, on the finished mix. Podcasts: I=-16.

## Stabilise, correct exposure and colour, repair sound
Per-shot fixes (vid.stab two passes, gamma/curves/colorbalance, the filmic look, letterbox, denoise, voice chain,
sync, speed with `rubberband`) are in the cleanup-and-repair skill's fixes.md, with how much is too much.

## Speed ramp (on the beat)
A shot at full speed until a beat, half speed for one bar, full speed again from the next downbeat. Each part is
trimmed from the source, slowed with `setpts`, then joined (the music carries the sound; the shot's own sound is dropped).
Source times: part 1 4.0–5.0, part 2 5.0–6.0 (plays 2 s at 0.5×), part 3 6.0–7.5:
```bash
ffmpeg -y -i in.mp4 -filter_complex "\
[0:v]trim=4.0:5.0,setpts=PTS-STARTPTS[p1];\
[0:v]trim=5.0:6.0,setpts=2*(PTS-STARTPTS)[p2];\
[0:v]trim=6.0:7.5,setpts=PTS-STARTPTS[p3];\
[p1][p2][p3]concat=n=3:v=1:a=0,fps=30[v]" -map "[v]" -an -c:v libx264 -crf 18 -pix_fmt yuv420p renders/ramp.mp4
```
Choose the source times so the ramp starts on a beat and part 3 begins on the next downbeat (music-sync.md §3).
Slow parts look smooth only from high-frame-rate sources (60 fps → 0.5×); from 24–30 fps keep slow parts short.

## Photos (slideshow with a slow push)
One photo, 3 s at 30 fps, a 5 % push to the centre (upscale first or the motion jitters). For a pan, move x instead.
```bash
ffmpeg -y -loop 1 -t 3 -i photo.jpg -vf "scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,\
zoompan=z='1+0.05*on/89':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=90:s=1920x1080:fps=30,format=yuv420p" \
-frames:v 90 -c:v libx264 -crf 18 renders/photo1.mp4
```
Join the photos with `concat` (or `xfade=transition=fade:duration=0.5` for soft changes), photo changes on bars.
A portrait photo in a landscape film: `scale=-2:2160` over a blurred, darkened copy of itself (`boxblur=20,eq=brightness=-0.1`)
filling the frame — never stretch it.

## Music edits (on downbeats only — times from analyze_music's beats file)
```bash
# keep bars from downbeat A to downbeat B (e.g. 16.000–48.000), 15 ms fades at the edges
-af "atrim=16.000:48.000,asetpts=PTS-STARTPTS,afade=t=in:d=0.015,afade=t=out:st=31.985:d=0.015"
# join two sections of a track (A: 0–16, B: 48–end) with a 30 ms crossfade at the downbeat
-filter_complex "[1:a]atrim=0:16.03,asetpts=PTS-STARTPTS[x];[1:a]atrim=48:,asetpts=PTS-STARTPTS[y];[x][y]acrossfade=d=0.03[m]"
# back-time: the track's ending (last sound at 63.2 s) lands on the end of a 30 s film → start 33.2 s into the track
-ss 33.2 -t 30 -i music.mp3
# music starting 2.5 s into the film
-af "adelay=2500:all=1"
```
Mixing music under the film's own sound in a render: `[0:a]volume=1[f];[1:a]volume=0.4[m];[f][m]amix=inputs=2:normalize=0:duration=first[a]`
(or `set_mix`, which also ducks under speech). With no sound of its own, map the music as the film's audio.

## Still frame to look at
```bash
ffmpeg -y -ss 12.5 -i renders/out.mp4 -frames:v 1 -q:v 3 notes/check-12.5.jpg
```
