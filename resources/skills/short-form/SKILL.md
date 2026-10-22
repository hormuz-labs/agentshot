---
name: short-form
description: Vertical short videos for Instagram Reels, TikTok and YouTube Shorts, and cutting clips for them out of long videos (podcasts, streams, talks): picking clip-worthy moments, the hook in the first second, 9:16 reframing on the subject, word-by-word captions, pacing, loops, safe zones and export. Read before making any Reel, TikTok, Short or clip; video-editing comes first.
---

# Short-form vertical video (Reels, TikTok, Shorts)

People decide in about one second whether to keep watching, usually with the sound off, on a phone, with the platform's
buttons and captions covering parts of the screen. Everything here follows from that. Read video-editing first; for
talking clips also talking-head, for music-driven reels also promos-and-montages.

## 1. The format
- **Shape**: 9:16, 1080×1920. Keep the source frame rate (30 fps if you must choose).
- **Length** (good targets; the platforms allow longer): 7–15 s for a single moment or loopable visual; 20–45 s for a tip,
  a story or a clip from a talk; up to 60–90 s only when every second earns it. Shorter wins when unsure.
- **Safe zones** (platform buttons and captions sit on top of the video): keep faces, products and all text inside
  x 6–84 % of the width (the right ~16 % has the like/comment buttons) and y 12–75 % of the height (top: account and
  search bar; bottom ~22–25 %: the caption, username and music line).
- **Sound off by default**: most people watch muted. Speech needs burned-in captions; the story must work visually.
- **Loudness** -14 LUFS, true peak ≤ -1 dBTP.

## 2. The hook (first 0–2 s)
- Start in the middle of the action or on the strongest line. No intro, no logo, no "hey guys", no establishing shot.
- Hook types that work: a bold claim ("This changed everything"), a question the video answers, a surprising result
  shown first, a number ("3 mistakes…"), a strong emotion, an unusual image or motion in the first frame.
- Add **hook text** on screen for the first 2–3 s when the opening isn't self-explanatory: ≤ 6 words, big, top area
  (below the 12 % zone), plain words that promise the payoff. It is not the caption; it states why to watch.
- The first frame matters (it's the preview): a face, the product, the action — never black or a blur.

## 3. Pacing
- A visual change every 1–3 s: a cut, a punch-in (100 % ↔ 115–130 % on the face), b-roll, a text card, a new angle.
- Talking clips: tighter than YouTube — pauses over 0.3 s down to ~0.15 s, every filler and false start out, but keep
  breaths before punchlines (talking-head has the method).
- Music reels: cut on the beat (video-editing's music-sync.md); a burst of fast cuts, then a held hero shot.
- End on the payoff: the punchline, the result, the reveal. Hold 0.5–1 s, then stop. No outro, no "follow for more"
  card unless asked.
- **Loop**: when possible, make the end flow into the start (the last line leads into the first, or the last frame
  matches the first) — replays count.

## 4. Reframing 16:9 → 9:16
- Crop, don't shrink: a 9:16 window (ih×9/16 wide) over the subject, scaled to 1080×1920. A blurred-copy background
  with the whole 16:9 frame in the middle is a fallback only (screen recordings, wide group shots, or when asked).
- **Per shot, measured**: `find_subjects` (aspect 9:16) finds the faces and objects in every shot and gives each shot a
  ready-made crop filter that follows its main subject smoothly (≤ 15 % of the width per second, never leaving the
  frame). Put each shot's filter after that shot's trim, then `scale=1080:1920`. A face beats a body; for objects it
  picks the biggest, most present thing (a car, a person, a dog). Check with `look`; if the main subject is wrong for
  the story (it followed the passer-by, not the product), use the other positions it lists.
- **Two people in a wide shot**: `speakers` gives who talks when, `find_subjects` where each face is: crop to the
  speaker (switch on their turns, at sentence boundaries, hold ≥ ~2 s), or stack them (top/bottom halves, each
  1080×960) when both reactions matter.
- **Screens/slides**: crop to the part that matters (the code, the chart) and keep text readable (≥ ~40 px tall on the
  1920-high frame); if the whole screen is needed, put it in the middle third with the speaker's face above or below.
- Check every crop with `look` (frames at each shot's start and middle): no cut-off heads, chins or products.

## 5. Captions (word-by-word, social style)
- Use the transcript's word times. 1–3 words per line (one short line), the word being spoken highlighted
  (a brand colour or yellow), bold, white with a dark outline/shadow, centred at about 70 % of the height
  (above the bottom UI zone, below the face), big (≈ 80–90 px on 1920).
- Recipe and a tested template: references/captions.md (an .ass file burned with ffmpeg's subtitles filter).
- Fix transcript mistakes in names, brands and numbers before burning (ask if unsure of a spelling). Remove fillers
  from captions even if a few remain in the audio. Never cover the face; move captions up or down per shot if needed.
- Emphasis: an emoji or a colour on 1–2 key words per sentence at most. Plain is better than busy.

## 6. Clips from a long video (podcast, stream, talk, interview)
1. Read the whole `transcript` (and `analyze_video` for the shots/speakers' positions).
2. **Find candidates**: stretches of 15–60 s that (a) start with a strong, self-contained line — a claim, a question,
   a story's first sentence, a number, an emotional statement; (b) make sense without the context before them;
   (c) reach a payoff — a punchline, an insight, a surprising answer, a conclusion; (d) have energy (laughter, emphasis,
   disagreement, a vivid example). Avoid stretches that refer back ("as I said", "that thing") or need a visual you
   don't have.
3. **Rank** them by hook strength, payoff, how standalone they are, and length fit. Unless the user said "you decide",
   offer the best 3–6 as an `ask_user` `multiple` question: each option "0:12:31 · "The one rule I never break…" (38 s)"
   with a one-line description of the payoff.
4. **Cut each clip**: start exactly on the first word of the hook line (drop leading "so", "and", "um", "yeah");
   remove fillers, false starts and pauses (tight pace); you may drop a sentence in the middle that wanders, but never
   change the meaning; end 0.3–0.5 s after the payoff (keep a laugh or reaction if there is one).
5. Reframe (section 4), hook text (section 2), captions (section 5), punch-ins or b-roll every 3–5 s if the shot is
   static for long, light music only if it helps (≥ 20 dB under speech, or none).
6. Each clip is its own render and its own proposal, named by its hook ("Clip 1 — The one rule I never break").

## 7. Music reels (no speech)
- Pick or generate music first; `analyze_music`; cut picture to it (video-editing's music-sync.md). 7–20 s is typical.
- Strongest shot first; a fast build of details; the hero on the drop; end on the final hit; loop if possible.
- Text: a short hook line at the top for 2–3 s; nothing else unless the user wants a message.

## 8. Before proposing
- 1080×1920, length as planned, hook in the first 1–2 s, first frame strong.
- Every text and every face inside the safe zones (check with `look` at several moments).
- Captions in sync with the words (look at 2–3 moments; the highlighted word is the one being said).
- No black frames, no frozen frames, loudness -14 LUFS (`analyze_video` on the render).
