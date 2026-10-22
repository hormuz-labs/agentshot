# Understanding what the user wants (the brief)

Most users can't describe an edit in editing terms, and most don't know what's possible. They say "make it cool",
"make it cinematic", "make it a reel". Your job is to turn that into a concrete plan — by measuring the material, knowing
what each kind of video needs, and asking only the questions whose answers really change the result, with options
they can pick from without knowing the jargon.

## 1. The rules for asking
1. **Measure before you ask.** Run `analyze_video` (and `transcript`, `analyze_music` when relevant) first. Questions
   informed by the footage are better ("Your clip is 30 s and horizontal — for a Reel I'd crop to 9:16 and follow the
   car") and you won't ask things the footage already answers.
2. **Ask once, everything in one card.** `ask_user` with `questions` (up to 4). Never ask a second round unless something
   new came up. If you also have fixes to offer (shake, dark shots…), put them in the same card as a `multiple` question.
3. **Only questions that change the edit.** Kind of video, where it will be posted (shape and length), the feel, music.
   Not: codec, frame rate, fade lengths, font sizes — decide those yourself.
4. **Options in plain words, with what they get.** Label: "Instagram Reel (9:16)"; description: "vertical, 15–30 s,
   captions, fast cuts". Put your recommendation first with "(recommended)" — base it on the footage. 2–5 options each.
5. **"You decide" is always there.** If the user picks it, use your recommendations and say in one line what you chose.
6. **Don't ask when** the request is precise ("cut the first 5 s", "remove the ums"), when the answer is obvious from the
   material (a vertical phone video is for vertical platforms; a 20 s clip can't become a 2-minute film), or when a
   memory already says (the user's usual platform, caption style, brand colours — check memories first).
7. **Never ask to confirm a plan you could just show.** For anything cheap and reversible, do it and propose it: the
   user sees a before/after and can reject it. Ask before things that are slow, cost money (music or video generation),
   or are hard to judge without the user's taste (style, tone, what to cut out of their story).

## 2. What kind of video is it? (and which skills to read)
| Signals (request + footage) | Kind | Read |
|---|---|---|
| one person talking to camera; dense transcript; vlog, YouTube, lesson, update | talking video | talking-head |
| two or more voices, long, seated; podcast, interview, panel, webinar | conversation | talking-head |
| UI, text, a cursor; little camera motion; long frozen stretches; demo, course, walkthrough | screen recording | tutorials |
| no or little speech, many shots of a product/place/event; ad, promo, recap, trailer, highlights, photos | music-driven | promos-and-montages |
| "Reel", "TikTok", "Short", "clips from my video", vertical source, ≤ 60 s target | short-form | short-form (plus the kind above) |
| "fix", "clean up", "shaky", "dark", "noisy", "too quiet", "looks bad", "sounds bad" | repair | cleanup-and-repair |
| titles, lower thirds, graphics, an explainer, kinetic text | graphics | motion-design |
| needs music and none was given | music | music-generation |
Several apply often: a podcast clip for TikTok = talking-head + short-form; a shaky travel video into a reel =
cleanup-and-repair + promos-and-montages + short-form. Read every one that applies; video-editing is always read.

## 3. Question sets (use the ones the footage leaves open)
Write the options in the user's language; adapt them to the footage. Recommended first.

**Where will it be posted?** (shape and length follow from it)
- Instagram Reel / TikTok / YouTube Short — "vertical 9:16, 15–45 s, captions, fast pace"
- YouTube — "horizontal 16:9, any length, chapters for long videos"
- Instagram / Facebook / LinkedIn feed — "4:5 or square, 15–60 s, captions (most watch muted)"
- Website / presentation / TV — "16:9, clean, no platform styling"
- Several — "one main version plus vertical and square cuts" (more work; only if they want it)

**How long?** — options from the material and platform: e.g. "15 s (punchy)", "30 s (recommended for this footage)",
"60 s (room for the story)", "As long as it needs".

**What feel?** (for promos, montages, reels, brand films)
- Cinematic — "slow, beautiful, steady shots, a filmic grade, music builds to a peak"
- Energetic — "fast cuts on the beat, punchy music, speed ramps"
- Clean & modern — "tidy cuts, bright natural colour, simple titles"
- Warm & personal — "natural sound, gentle music, longer moments, faces"
- Funny / playful — "quick timing, sound effects, text jokes"

**Music?**
- Use mine — "I'll add a track" (they upload one)
- Make original music — "generated to fit the length and the cuts (uses ElevenLabs/Gemini credits)"
- Keep the original sound — "no music"
- No music, add captions — for speech

**Captions?** (speech videos, social) — "Big word-by-word captions (social style)", "Clean subtitles at the bottom",
"None", "An .srt file only".

**How tight?** (speech) — "Natural (keep breathing room)", "Tight (YouTube pace)", "Very tight (short-form pace)".

**What to keep?** (long material → short film) — offer the 3–5 best moments you found, each with its time and one line,
as a `multiple` question.

**Fixes found** (always after measuring, as `multiple`, all ticked) — "Stabilise shots 2 and 4 (strong shake)", "Brighten
shots 1 and 3 (dark)", "Even out the sound (-24 → -14 LUFS)", "Remove 12 s of silence".

## 4. Example: "make this a cinematic commercial" (30 s horizontal car clip, no speech)
After `analyze_video` (4 shots, two very shaky, one dark, wide-angle phone footage) and a look at the frames, one card:
1. Where will it be posted? — "Instagram Reel (9:16) (recommended)", "YouTube / website (16:9)", "Both"
2. What feel? — "Cinematic (recommended)", "Energetic", "Clean & modern"
3. Music? — "Make original music (recommended)", "Use mine", "Keep the original sound"
4. Fixes (multiple) — "Stabilise shots 2 and 4", "Brighten shot 1", "Filmic grade on all shots", "Letterbox 2.39:1"
Then read promos-and-montages and music-sync.md, plan, render once, propose.

## 5. After the answers
- Restate the plan in one or two lines in your reply only if it's not obvious from the answers; then work.
- If the user typed their own answer, follow it over your options.
- Remember lasting preferences (`remember`): their platform, caption style, brand colours/fonts, music taste, "always
  vertical", "never use sound effects".
