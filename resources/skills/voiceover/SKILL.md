---
name: voiceover
description: Generated voiceover with generate_voice: narration for explainers, promos, tutorials and shorts, a line to fix a mistake, a read for a title card. Writing the script for the ear and to the picture's length, choosing a voice, timing it on the timeline, mixing it over music and the original sound. Read before generating any voice.
---

# Generated voiceover

A voice made from a script, timed to the picture. `generate_voice` makes it and saves it to `generated/`.

## 1. When
- The user asks for narration, a voiceover, a read line or a voice for a script; or a film without speech needs words
  and the user agrees. Each take costs the user money (their own key or their Manul credit): if they didn't ask for
  it themselves, ask once with `ask_user`. One take; offer another instead of making several unasked.
- Never imitate a real person's voice, and never put words in the mouth of someone in the footage (no fake "fixes" of
  what a real person said) unless the user is that person and asks for it.

## 2. The script
- Written for the ear: short sentences, one idea each, plain words, numbers as they're said ("twenty twenty-six").
- Fit the picture: about 2.5 words a second for calm narration, 3 for a promo. Count the words against the shot or
  section it sits on (`analyze_video` gives the shot times) and cut words rather than rushing the read.
- One call per paragraph or section (each its own file) so lines can be placed and moved on their own. At most 5,000
  characters per call.
- Show the user the script before generating when it's longer than a couple of lines or they didn't write it.

## 3. The voice
- Pick from generate_voice's voices by what the film is: narrator for most, guide for tutorials, anchor for trailers,
  bright or energetic for ads and shorts, soft for emotional pieces, storyteller for documentaries, professional for
  corporate. Keep one voice per film unless there are characters.
- `style` sets the delivery in a few words ("calm and warm", "excited", "whispering"). Leave it out for a neutral read.
- With the user's own keys generate_voice picks a provider; pass `provider` only when they ask for one. With a Manul
  key Manul picks: don't name a provider then.

## 4. Check and place it
- `transcript` the file: every word is there and said right (names, numbers). Regenerate only the line that's wrong.
- Trim leading and trailing silence; `probe` the length and compare with the shot it covers.
- Lay the lines over the film with one ffmpeg command: each line delayed to its time (`adelay=<ms>:all=1`), the film's
  own sound lowered under narration (or cut), mixed with `amix=normalize=0`, the picture copied (`-c:v copy`); lines
  start a beat after a cut, not on it. Normalise the voice to about -16 LUFS first, every line the same. Then
  `propose_version`.
- Music goes on after, with `set_mix`: it ducks under the voice now that the voice is in the film's sound (duck_db 8–14).

## 5. Say what it is
One line: it's a generated voice, which voice, how long. With the user's own key name the provider; with Manul, say
Manul made it. When the user corrects the voice for good ("always the guide voice"), `remember` it.
