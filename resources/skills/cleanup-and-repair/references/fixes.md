# Fix recipes (tested with Manul's bundled ffmpeg)

Replace file names and numbers. Combine the filters you need into ONE command per render (`-vf "a,b,c"`,
`-af "x,y,z"`); per-shot fixes go inside the edit's filter graph on each shot's `trim` (video-editing's ffmpeg.md,
"Keep ranges"). Always encode with `-c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p -c:a aac -b:a 192k`.

## Checks
```bash
# interlaced? (look at "Multi frame detection": many TFF/BFF and few Progressive = interlaced)
ffmpeg -hide_banner -i in.mp4 -vf idet -frames:v 600 -an -f null - 2>&1 | grep "Multi frame"
# black bars baked into the picture? (the last crop= line is what to crop to)
ffmpeg -hide_banner -i in.mp4 -vf cropdetect=limit=24:round=2 -t 10 -an -f null - 2>&1 | grep -o "crop=[0-9:]*" | tail -1
# rotation metadata (phones)
ffprobe -v error -select_streams v:0 -show_entries stream_side_data=rotation -of csv=p=0 in.mp4
# variable frame rate? (r_frame_rate very different from avg_frame_rate = variable)
ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate,avg_frame_rate -of csv=p=0 in.mp4
# per-channel sound levels (one channel far quieter = one-sided)
ffmpeg -hide_banner -i in.mp4 -af astats=measure_perchannel=RMS_level:measure_overall=none -vn -f null - 2>&1 | grep "RMS level"
```
**Noise floor**: take a pause that `analyze_video` lists as silence (or a gap between words in the transcript) and
measure it: `ffmpeg -hide_banner -ss <start> -t <length> -i in.mp4 -af astats -vn -f null - 2>&1 | grep "RMS level"`.
Above about -55 dB is audible hiss/noise; above -45 dB is loud.

## Stabilise (vid.stab, two passes, per shot)
Cut the shot out first (or run both passes on the same trimmed range): the transforms file is indexed by frame from the
start of what pass 1 saw.
```bash
ffmpeg -y -ss <in> -to <out> -i in.mp4 -c:v libx264 -crf 12 -preset veryfast -an renders/shot2.mp4
ffmpeg -hide_banner -i renders/shot2.mp4 -vf vidstabdetect=shakiness=6:accuracy=15:result=renders/shot2.trf -f null -
ffmpeg -y -i renders/shot2.mp4 -vf "vidstabtransform=input=renders/shot2.trf:smoothing=30:optzoom=1:interpol=bicubic,unsharp=5:5:0.5:3:3:0" \
  -c:v libx264 -crf 18 -preset medium -pix_fmt yuv420p renders/shot2-stable.mp4
```
- `smoothing` = frames on each side averaged (at 30 fps; scale with fps): slight shake 15, shaky 30, very shaky 45.
  Measured on a shaky handheld walk-around (shake 0.75): smoothing 20 → 0.56, 30 → 0.50, 45 → 0.42, the camera's
  deliberate motion kept. Aim for "slight shake" or better; re-measure and raise smoothing once if it's still shaky.
- `optzoom=1` zooms just enough to hide the moving black edges (static zoom). Strong shake → bigger zoom → softer image;
  the `unsharp` restores some crispness. If the zoom is too much (> ~12 %), lower `smoothing`.
- A shot meant to be static (on a tripod but wobbly): `tripod=1` in BOTH passes.
- Then `analyze_video` on the result: shake should read "steady" or "slight shake".

## Exposure, contrast, colour (per shot)
```bash
-vf "eq=gamma=1.3"                                              # dark shot: lift midtones (1.1–1.5)
-vf "eq=gamma=0.9"                                              # bright shot (0.8–0.95)
-vf "curves=master='0/0 0.25/0.33 0.75/0.82 1/1'"               # lift shadows and mids gently, keep white
-vf "curves=master='0/0 0.25/0.21 0.75/0.79 1/1'"               # flat shot: soft S-curve (more contrast)
-vf "colorbalance=rm=0.03:bm=-0.05:rh=0.02:bh=-0.03"            # blue/cool cast → warmer (reverse signs for a warm cast)
-vf "colorbalance=gm=-0.05:gh=-0.03"                            # green cast (+ values for a magenta cast)
-vf "eq=saturation=1.1"                                         # dull colour (0.85–1.2)
```
Read `analyze_video`'s U/V: U above 128 = blue, below = yellow; V above 128 = red/magenta, below = green/cyan. Move
toward 128 by small steps and re-measure. Order in one chain: exposure → colour → contrast → saturation.

**A gentle filmic look** (after correction, same on every shot):
```bash
-vf "curves=master='0/0.03 0.25/0.22 0.75/0.8 1/0.98',colorbalance=rs=-0.04:bs=0.05:rh=0.05:bh=-0.04,eq=saturation=0.9,vignette=angle=PI/5"
```
(lifted blacks, soft S-curve, cool shadows, warm highlights, slightly less saturation, a faint vignette)

**Letterbox 2.39:1** (bars over the picture, size unchanged — check heads and products stay inside):
```bash
-vf "drawbox=x=0:y=0:w=iw:h=(ih-iw/2.39)/2:color=black:t=fill,drawbox=x=0:y=ih-(ih-iw/2.39)/2:w=iw:h=(ih-iw/2.39)/2:color=black:t=fill"
```

## Geometry and technical
```bash
-vf "rotate=-1.5*PI/180,crop=iw*0.95:ih*0.95,scale=1920:1080"   # straighten a 1.5° tilt (crop hides corners)
-vf "lenscorrection=k1=-0.12:k2=-0.02"                           # wide-angle barrel curve (k1 -0.05 … -0.25)
-vf "bwdif=mode=send_frame"                                      # deinterlace (before any scaling)
-vf "transpose=1"                                                # rotate 90° clockwise (2 = counter-clockwise; "hflip,vflip" = 180°)
-vf "crop=1920:800:0:140"                                        # crop baked-in bars (numbers from cropdetect)
-fps_mode cfr -r 30                                              # variable → constant frame rate (as an output option)
-vf "deflicker=size=10"                                          # flicker
-vf "hqdn3d=2:1.5:3:2.25"                                        # light denoise (noisy dark phone footage)
-vf "scale=1920:-2:flags=lanczos,unsharp=5:5:0.4"                # upscale a small source with a touch of sharpening
```

## Sound
```bash
-af "highpass=f=80"                                                       # rumble, handling (wind: 100–150)
-af "highpass=f=80,bandreject=f=100:width_type=q:w=20,bandreject=f=150:width_type=q:w=20"   # 50 Hz hum (60 Hz: 120, 180)
-af "afftdn=nr=10:nf=-45:tn=1"                                            # hiss/fan: nr = dB removed (6–12), nf = the measured noise floor
-af "deesser=i=0.4"                                                       # harsh s sounds
-af "acompressor=threshold=-20dB:ratio=3:attack=10:release=200:makeup=3"  # even out speech
-af "dynaudnorm=f=250:g=15:p=0.9:m=8"                                     # stronger evening-out (long recordings, many speakers)
-af "pan=stereo|c0=c0|c1=c0"                                              # voice only on the left → both sides (c1 for right)
-af "adeclip"                                                             # soften clipped peaks (partial)
```
A typical voice chain: `highpass=f=80,afftdn=nr=8:nf=<floor>,acompressor=threshold=-20dB:ratio=3:attack=10:release=200:makeup=3,deesser=i=0.3`,
then loudness last (video-editing's ffmpeg.md, two-pass loudnorm).

**Sync**: audio late by 0.12 s → `-itsoffset -0.12 -i in.mp4 -i in.mp4 -map 0:a -map 1:v`; audio early by 0.12 s →
`-af "adelay=120:all=1"`. Find the offset with `look` (frames around a clap) against the clap's sound in the transcript/silences.

## Speed
```bash
-filter_complex "[0:v]setpts=PTS/4[v];[0:a]atempo=2,atempo=2[a]"          # 4× (speed-ups: mute or drop the sound usually)
-filter_complex "[0:v]setpts=2*PTS[v];[0:a]rubberband=tempo=0.5[a]"        # 0.5× slow motion, sound keeps its pitch
-vf "setpts=2*PTS,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:vsbmc=1"  # 0.5× from 30 fps with in-between frames (short moments only; slow)
```
From 60 fps footage, slow motion needs no interpolation: `setpts=2*PTS` then `fps=30`.
