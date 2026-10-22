---
name: cleanup-and-repair
description: Making footage look and sound right: diagnosing from measurements, then fixing shake, dark or bright shots, flat contrast, colour casts, mismatched shots, noise, tilt, lens distortion, interlacing, black bars, rotation, variable frame rate, and sound (levels, hiss, hum, rumble, wind, harsh s, uneven speech, one-sided, clipped, out of sync). Read before any fix-it or clean-up request.
---

# Cleanup and repair

Users say "make it look better", "it's shaky", "it's too dark", "the sound is bad". Diagnose with measurements, offer
the fixes, apply them gently, and prove the improvement with the same measurements. Commands (tested with Manul's
ffmpeg) are in references/fixes.md.

## 1. Diagnose (numbers first)
`analyze_video` on the source gives, per shot: shake and motion, luma (exposure), low–high (contrast), saturation,
U/V (colour cast); and black/frozen frames, loudness, peak, silences. Then:
- `look` at each problem shot (and zoom with a box on details: noise in shadows, a tilted horizon, curved lines).
- Sound: `transcript` tells you whether it's speech; the loudness and silences say a lot (noise shows as silences that
  aren't silent — see fixes.md "Noise floor"); per-channel levels reveal one-sided audio.
- Technical: `probe` for size, fps, codec; fixes.md has the checks for interlacing, rotation, black bars, variable fps.

## 2. Offer, then fix
Say in 2–4 lines what you found, then one `ask_user` card with the fixes as a `multiple` question (all ticked), each
"what — which shots — why" ("Stabilise shots 2 and 4 — strong handheld shake"). Precise requests ("stabilise it")
need no question. Apply the chosen fixes in one render, in this order:
1. Technical (deinterlace, rotation, constant frame rate, crop baked-in bars)
2. Stabilise (per shot), straighten horizons, lens correction
3. Exposure → white balance/cast → contrast → saturation (per shot), then match shots to each other
4. Denoise picture (only if visible), sharpen a touch only if softened by scaling/stabilising
5. Sound: rumble/hum → noise → harshness → level evenness → loudness last

## 3. What to fix and how much
| Problem (how you know) | Fix | Gentle limits |
|---|---|---|
| Shake (shake ≥ 0.6 "shaky", ≥ 1.2 "very shaky") | vid.stab two passes per shot | smoothing 15–45 frames; auto zoom; skip deliberate motion |
| Dark shot (luma < 50) | gamma up (midtones), small lift | gamma 1.1–1.5; check highlights after |
| Bright shot (luma > 190, high ≥ 235) | gamma down, pull highlights | gamma 0.8–0.95; blown areas can't come back |
| Flat (high − low < 90) | S-curve contrast | small: shadows −0.03, highlights +0.04 |
| Colour cast (U/V off by > 6) | colorbalance on mids/highs opposite the cast | ±0.02–0.08; skin must look natural |
| Shots don't match | bring each toward the sequence's average luma/sat/U/V | match neighbours first, then the look |
| Dull colour (sat < 20) | saturation up | 1.05–1.2 |
| Over-saturated (sat > 70) | saturation down | 0.85–0.95 |
| Noise / grain in dark shots (see it zoomed) | hqdn3d (light) | stronger smears detail; never on clean footage |
| Tilted horizon (look) | rotate + crop | the crop hides the corners; ≤ 3° |
| Wide-angle curve (straight lines bent, action cams/phones' ultra-wide) | lenscorrection | k1 −0.05 to −0.25; check edges |
| Interlaced (combing; idet says TFF/BFF) | bwdif | always before scaling |
| Wrong rotation (sideways/upside down) | transpose / flip | check probe's rotation first |
| Black bars baked in (cropdetect) | crop them off | then re-fit to the output shape |
| Variable frame rate (phones; audio drifts) | convert to constant fps first | the source's nominal fps |
| Flicker (LED lights, timelapse) | deflicker | size 5–15 |
| Too quiet / too loud (LUFS) | two-pass loudnorm, last | -14 LUFS web, -16 podcast, peak ≤ -1 |
| Rumble, handling, wind (low thuds) | high-pass | 80 Hz voice, 100–150 Hz for wind |
| Hum (steady 50/60 Hz drone) | high-pass + notches at the harmonics | narrow notches only |
| Hiss / fan / air-con (noise floor > −55 dB) | afftdn | 6–12 dB reduction; more sounds underwater |
| Harsh "s" (sibilance) | deesser | intensity 0.3–0.5 |
| Uneven speech levels | gentle compression or dynaudnorm | ratio ≤ 3; no pumping |
| Voice on one channel only | pan to both | check per-channel levels first |
| Clipped/distorted audio (peak ≥ 0 dBFS) | adeclip helps a little | can't be fully repaired; tell the user |
| Sound out of sync (lips) | shift the audio | find the offset on a clap or a hard consonant |

## 4. Limits — say them honestly
Can't be fixed, only improved: motion blur and focus blur, blown-out highlights and crushed blacks, rolling-shutter
wobble ("jello"), heavy compression blocks, very low resolution, clipped audio, strong room echo, wind that drowns the
voice, someone talking over the speaker. Tell the user what will improve and what won't before they wait for a render.

## 5. Don't over-process
Over-sharpened halos, plastic skin from denoising, orange/teal overdone, crushed shadows, pumping compression and
"underwater" noise reduction are worse than the original problem. Make the smallest change that fixes it; compare
before and after with `look` (same times) and with `analyze_video` (the numbers moved toward normal, not past it).

## 6. Before proposing
- `analyze_video` on the result: stabilised shots read steady or slight shake; luma, contrast, saturation and cast within
  normal ranges and close between neighbouring shots; loudness on target; nothing new clipped.
- `look` at the same moments as before: better, natural, no artefacts at the edges (stabilisation borders, rotation
  corners), no new noise or halos.
- Say in one line what changed ("Stabilised 2 shots, brightened shot 1, removed hiss, sound to -14 LUFS").
