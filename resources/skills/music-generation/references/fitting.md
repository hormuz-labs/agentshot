# Fitting a generated track with ffmpeg

Run these with bash in the project folder, on the file `generate_music` saved.

Leading silence (the first `silence_end` is where the music starts):
```bash
ffmpeg -hide_banner -i generated/music-bed.mp3 -af silencedetect=n=-50dB:d=0.2 -f null - 2>&1 | grep silence_
```
Trim the start, cut on a bar (at 92 BPM a bar is 240/92 = 2.61 s; 23 bars = 60.0 s) and fade out over the last bar:
```bash
ffmpeg -y -ss 0.18 -i generated/music-bed.mp3 -t 60.0 -af "afade=t=out:st=57.4:d=2.6" -c:a libmp3lame -q:a 2 generated/music-bed-cut.mp3
```
Start the music later in the film (here at 12.5 s), so set_mix can still play the file from 0:
```bash
ffmpeg -y -i generated/music-bed-cut.mp3 -af "adelay=12500:all=1,afade=t=in:st=12.5:d=1" -c:a libmp3lame -q:a 2 generated/music-bed-late.mp3
```
Normalise the track to -14 LUFS so set_mix levels mean the same for every track (one pass is fine for music):
```bash
ffmpeg -y -i generated/music-bed-cut.mp3 -af "loudnorm=I=-14:TP=-1:LRA=11,aresample=48000" -c:a libmp3lame -q:a 2 generated/music-bed-final.mp3
```
Then `import_media` the final file and `set_mix` with it.
