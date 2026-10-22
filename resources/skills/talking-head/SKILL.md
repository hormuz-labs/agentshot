---
name: talking-head
description: Videos carried by speech: YouTube videos, vlogs, lessons, podcasts, interviews, testimonials, webinars and talks. Cutting fillers, pauses, false starts and repeats from the transcript; tight but natural pacing; structure (hook, chapters); hiding jump cuts with punch-ins and b-roll; several speakers; voice sound; lower thirds and chapters. Read before cutting speech; video-editing comes first.
---

# Speech-led videos

Work from the `transcript` tool: every word has a start and end time, fillers included. Read video-editing first;
for clips for social also short-form.

## 1. What kind and what the user wants
- **YouTube video / vlog / lesson** (one person, to camera): tight pace, hook first, chapters, b-roll and punch-ins.
- **Podcast** (two or more people, long): light cleanup, keep the conversation's flow; full episode plus clips.
- **Interview / testimonial** (questions and answers): the subject's best answers, usually without the questions, in a
  story order; b-roll over edits; a lower third with name and role.
- **Webinar / talk / meeting recording**: remove dead time (waiting, setup, tech problems), keep the content intact.
If it matters and isn't clear, ask in one card (video-editing's briefs.md): the kind, how tight ("Natural", "Tight
(YouTube pace)", "Very tight (short-form pace)"), captions, and for long material what to keep.

## 2. Cleaning the speech
- **Fillers**: um, uh, erm, ah, hmm. ("like", "you know", "I mean", "basically" only when the user asks — they often
  carry meaning.)
- **Pauses** by tightness: Natural — silences over 1.0 s → ~0.5 s. Tight — over 0.6 s → ~0.25 s. Very tight — over
  0.3 s → ~0.12 s. Never remove every pause: a breath after a point or before a punchline is pacing, not waste.
- **False starts and repeats**: "So the — so the thing is" → keep the last, complete attempt. Two takes of the same
  sentence: keep the better one (clearer, more energy, no stumble), usually the later.
- **Dead air** at the start and end: begin on the first word (minus ~0.15 s), end ~0.4 s after the last.
- **Tangents and repetition** (content cuts): suggest them, don't silently remove them — list each with its time and one
  line in an `ask_user` `multiple` question ("Cut 2:10–2:45: repeats the pricing point"). The user's content is theirs.

## 3. How to cut
- Plan every cut from word times first, then make them all in one `edit_timeline` call: `cut` with `src` and the word
  times (from–to in that file). The user sees and plays the cuts at once and can undo any of them; they render (with
  10 ms audio fades at every cut) when the edit is saved or exported. Use one ffmpeg command (trim/atrim + concat, or
  select/aselect with `between(t,a,b)`) only when the same render also needs effects edit_timeline can't do.
- Cut on word boundaries: to drop words a–b, cut from a's start to b's end (the transcript tool's notes say how much
  room its times already leave). Never cut inside a word.
- Many cuts close together read as jumpy: if two cuts are under 0.4 s apart, merge them into one.
- Keep audio and video in sync: cut both with the same ranges. 10–30 ms audio fades at every cut (edit_timeline's
  render adds them).
- Check the result's transcript at the cut points: every word whole, nothing doubled, nothing that changes the meaning.

## 4. Hiding the cuts and keeping it visual
- **Punch-ins**: alternate the framing at jump cuts — 100 % and a 115–130 % crop centred on the face (eyes about a third
  from the top). Don't punch in on every cut; alternate in a pattern that follows the sentences (a new point → a new
  framing). Never crop so far that the head or hands are cut awkwardly or the image goes soft (stay ≤ 130 % on 1080p,
  ≤ 150 % on 4K).
- **B-roll** (other footage over the voice): when the speaker describes something visual, over edits you want to hide,
  and every 10–20 s in YouTube videos to keep it visual. Cut b-roll on the speaker's phrases (it starts with the word
  that names the thing). The voice continues underneath (an L/J cut feel).
- **Text and graphics**: key numbers, names, lists and steps as on-screen text or a motion clip (motion-design).
- Static 10-minute shots with nothing changing lose viewers; something visual should change at least every 5–15 s in
  a YouTube video (a punch-in, b-roll, text) — less often for podcasts and interviews.

## 5. Structure
- **YouTube / vlog**: hook (the most interesting line or the result, 5–15 s) → the promise ("in this video…", short) →
  the content in chapters → the payoff → a short end (≤ 20 s). Move the best line to the front as a teaser only if it
  doesn't spoil the payoff; otherwise tease it.
- **Interview / testimonial**: the strongest, most emotional or clearest answer first (hook) → who they are → the story
  (problem → what happened → result) in their words → a strong final line. Questions are usually cut; keep one if the
  answer doesn't make sense without it, or put it on screen as text.
- **Podcast (full episode)**: keep the conversation; cut false starts, long silences, coughs, tech trouble, off-topic
  setup at the start; a cold open (a 15–30 s highlight) before the intro is common. Clips → short-form.
- **Chapters** for videos over ~5 minutes: a list of `0:00 Title` lines at topic changes (the first at 0:00, at least
  3 chapters, each ≥ 10 s) in your reply, for the user's description.

## 6. Several speakers
- **Who speaks when**: the `speakers` tool gives every turn (A, B, C… in order of first speaking) with what is said.
  Pass `speakers` when you know how many people talk — it is much more accurate. Letters aren't names: match them to
  faces with `find_subjects` (where each face is) and `look`, or to names from the transcript ("thanks, Sarah").
- **One wide shot**: to focus on the speaker, crop to whoever is talking — `find_subjects` gives each face's position;
  switch the crop on the speaker turns (at sentence boundaries, never mid-word), hold each ≥ ~2 s, and keep the wide shot
  for overlaps, laughter and reactions.
- **One camera per person** (several files): sync them first (by their sound — the same clap or word in each file),
  then cut to the active speaker, holding each shot at least ~2 s; cut to the listener for reactions; a wide for
  cross-talk. A rhythm of only "who speaks" is dull — add reactions.
- **Separate microphones**: level-match the voices (each within ~1 dB), and when one person talks, the other mics can
  be lowered a few dB to cut room noise and echo (never fully muted mid-sentence of someone else).
- Lower thirds the first time each person appears: name and role, 3–6 s, lower left (motion-design).

## 7. Voice sound
- Order: remove rumble (high-pass ~80 Hz) → reduce steady noise gently (afftdn, a few dB) → even out levels (light
  compression) → de-ess if harsh → loudness last: -14 LUFS for YouTube/social, -16 LUFS for podcasts, true peak ≤ -1.
  cleanup-and-repair has the commands and the limits (over-processing sounds worse than noise).
- Music under speech: steady and quiet (≥ 15–20 dB under the voice for lessons/podcasts, ~10–14 for vlogs), no pumping;
  music-only moments (intro, b-roll montages) can come up.

## 8. After
- Say how much was cut in one line (e.g. "Removed 41 fillers and 1:12 of pauses; 9:40 → 8:05").
- If the result feels too tight or too loose, the user will say; adjust the pause threshold, not the filler list.
