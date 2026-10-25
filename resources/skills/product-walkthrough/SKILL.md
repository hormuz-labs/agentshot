---
name: product-walkthrough
description: Product walkthroughs and demos of a website or web app made from nothing - explore it with bsk, storyboard, film it in one take with walkthrough_record (real scrolling and typing), then compose_walkthrough voices each step, cuts idle time, zooms on actions and draws a cursor. Read before filming any product, site or web app; for an existing screen recording read demo-editor.
---

# Product walkthrough

A narrated film of someone using a product: each step shows one thing being done, and the voice says why it matters.
Walkthroughs are filmed in the user's own Chrome, with their logins: drive it with `chrome-bsk` (the same commands
as bsk, always on their Chrome). `walkthrough_record` films the tab your session drives as one continuous take;
`compose_walkthrough` turns the take into the film. Read browser-skill for bsk itself.

The user asked for a film, not for settings. Decide everything you can (voice, pace, zoom, length, steps) and ask only
what you cannot find out: once, for the storyboard. Never offer menus of options; the defaults are the good ones.

## 1. Explore first (nothing is filmed)
- **One session, one window, for the whole walkthrough.** `chrome-bsk browsers`, then `chrome-bsk session start --json`
  once (with several Chromes, `--browser <id>`: the one you remembered for this user, else the first; say in the
  storyboard question which window it is, and `remember` the right one if they correct you). Use `chrome-bsk` for every
  command of it. Never stop it and start another to try another profile or start over. None (bsk isn't in their
  Chrome) → plain `bsk`, AgentShot's own browser.
- Open the product where its users work (the app, a dashboard), not only its home page: a marketing page's "Get
  started" leads to sign-up even for someone signed in. Find the path for what the user wants shown, the buttons and
  fields on the way, what loads slowly, and what state the product must be in at the start. Learn it until you could do
  it without a wrong click.
- Signed out (a sign-in or sign-up page where the product should be): ask **once**, in their browser:
  `chrome-bsk request-help --session <id> --prompt "Sign in to <product> in this window, then press Continue"` (it waits
  for them). If they don't, or it's still signed out, stop and ask in chat what to use (an account, a demo workspace).
  Never retry the sign-in, try other windows or profiles, or type a password or secret. CAPTCHA, a code or a payment: the
  same, once.
- **The user's Interrupt means stop.** When a command says the user stopped you, send nothing more to the browser:
  say in one line where you were, ask what they want (ask_user), and end your turn. Every browser command is refused
  until they reply.
- Nothing private on film: other people's data, keys and tokens, billing details, messages. Prefer a demo workspace or
  sample data; if only the real one exists and shows something private, say so in the storyboard question.
- Decline cookie banners (most private option) and close pop-ups.

## 2. Storyboard: one question
4–8 steps, one idea each, about 30–90 s in all unless the user said otherwise. For each: a short title, what is done,
and the line said over it, written for the ear (about 2.5 words a second, 6–25 words; say why, not just what: "Invite
your team so everyone sees the same board", not "Click Invite"). Step 1's line says what the product is for.
Send it as a short numbered list, then `ask_user` with two options: **Film it** (description: "AgentShot films it in one
take and voices it; the voice uses a little of your credit or key") and **Change something**. Film nothing before.
If something essential is missing (an account, sample data), ask for it in that same question.

## 3. Film it in one take
1. Put the product in its starting state, on the first page. `walkthrough_record` start with your session id, then
   `observe` again (the viewport changed to 1280×720).
2. For each step: `walkthrough_record` step with its title, then do it.
   - Click, select and hover with chrome-bsk (fresh refs from `observe`).
   - Typing that should be seen: focus the field (click it), then `walkthrough_record` type. Never fill on film.
   - Scrolling: `walkthrough_record` scroll, to what the step is about.
   - Wait until the result is on screen before the next step: what isn't on screen isn't in the film.
3. Your thinking time between actions is cut, so be careful rather than fast. Long loads are sped up.
4. A wrong click or an error: recover, mark a new step with the same title and do it again; leave the failed step out
   later with `skip`. Sign-ins and private pages mid-take: pause, let the user act, resume.
5. `walkthrough_record` stop, then `chrome-bsk session stop <id>`.
Keep the take in one tab. Never record the screen any other way. There is nothing for the user to set up: filming
picks the best way itself. Only if they say the motion looks choppy and the take was filmed through bsk screenshots,
tell them the one-time fix: chrome://inspect/#remote-debugging → turn on “Allow remote debugging”, then Allow when Chrome asks.

## 4. Make the film
- Rewrite the lines to what was actually filmed, one per step in the take's order (`""` for a step with nothing said).
- `compose_walkthrough` with the take, the lines and a title. Leave voice, pace and zoom at their defaults.
- `look` at a click, some typing and a step change; fix a real problem only. Then tell the user, in two or three short
  lines, how long it is and what it shows. Don't list what they could change: they will say.

## 5. When the user asks for a change
Compose again from the same take (nothing is filmed again; unchanged lines keep their voice):
- "change what it says in step 3" → that line. "a different voice" / "more upbeat" → `voice` / `style`.
- "too slow", "tighter" → `pace` tight; "slower" → natural. "less zoom" → `zoom` subtle; "no zoom" → off.
- "show X too" / "do step 2 differently" → a new take (steps can't be swapped between takes).
- Music, an opening title or end card, captions: after the film is kept, as for any film (music-generation and set_mix,
  create_clip + insert_clip, export_video captions).
