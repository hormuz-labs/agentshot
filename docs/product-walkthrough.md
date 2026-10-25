# Product walkthroughs

Ask AgentShot for a walkthrough of a website or web app and it makes the whole film: it uses the product in a browser,
films it, narrates it and cuts it. There is nothing to configure. On the start screen the request itself says it is a
walkthrough (`wantsWalkthrough`: a walkthrough, demo or tour of a site or app, unless it asks for animation), and a line
under the box says what will happen; in a project, the agent reads the same intent from the message.

The user makes one decision: the storyboard (**Film it** or **Change something**). Voice, pace, zoom, cursor and click
ripples have defaults the agent keeps; the user changes them by saying so (“tighter”, “less zoom”), never from a menu.
While a take records, the Browser panel shows **Recording** on its tab.

1. **Explore** (not filmed): the agent opens the product with bsk and learns the path, what loads slowly and what state
   the product must be in. Sign-ins, CAPTCHAs and codes go to the user (`bsk request-help` or a question).
2. **Storyboard**: one line per step (what is done, what is said). The user approves it before anything is filmed.
3. **One take**: `walkthrough_record` films the tab the agent's bsk session drives, continuously, while the agent works
   through the steps with bsk. It marks each step, types into fields a key at a time and scrolls smoothly, so typing and
   scrolling are real on film. Around sign-ins and private pages it pauses: nothing is captured until it resumes.
4. **The film**: `compose_walkthrough` voices one line per step, cuts the idle time between actions (the agent thinking),
   speeds through long loads nobody acted in, holds each step until its line is said (the voice leads the first action of
   a step while the cursor glides to it), zooms in on clusters of nearby actions and out for scrolls and page loads, and
   draws a cursor gliding into each click with a ripple. It proposes the film as a version, like any other edit.

Changing a line, the voice, the pace (natural or tight) or the zoom (on, subtle or off) composes again from the same take: nothing is filmed again, and lines said the same way keep their voice (no new cost). A step that
went wrong can be done again as a new step and the failed one left out (`skip`).

## Which browser, and how it is filmed

Walkthroughs are filmed in **the user's own Chrome**, with their logins, whatever Settings → Browser says: the agent drives
it with `chrome-bsk`, bsk's commands on the user's bsk daemon (`src/main/bsk.ts`, `chromeBskScript`; installed for the
agent at start). Without bsk in their Chrome, the agent uses plain `bsk`, AgentShot's own browser. AgentShot finds which bsk has
the session (it marks the session's page with a one-off attribute through each in turn) and films it the best way
available, with nothing for the user to set up:

| Where | How | Frames |
| --- | --- | --- |
| The user's Chrome, remote debugging on (`DevToolsActivePort` in its profile) | CDP screencast over Chrome's own remote debugging; Chrome asks the user to allow it | 30–60 a second, 2560×1440 |
| The user's Chrome otherwise | bsk's own screenshots, on the agent's session | about 10 a second, at the screen's scale (2560×1440 on Retina) |
| AgentShot's browser | CDP screencast on the tab's `webContents.debugger` | 30–60 a second, 2560×1440 |

**Through bsk** (`BskCapture`): bsk's screenshot is itself a CDP capture, but bsk hides its overlay and waits a frame
around each one, so about 10 a second is the most it gives, whatever the size. The page is never emulated here: a capture
while the page is emulated at another size or scale than its window makes Chrome redraw the whole window at each one (a
flash ten times a second, measured on screen). Instead bsk's Agent Window is resized until the page is 1280×720 (bsk sizes
the whole window, so the tab strip and debugging bar are learned from the page's size after a resize), filmed at the
screen's own scale, and put back afterwards. A bsk session runs one command at a time (anything sent meanwhile is turned away as `session_busy`, never sent), so
AgentShot's calls go one by one and are sent again when turned away; each of the agent's `chrome-bsk` commands leaves a mark in
`<userData>/takes/yield` while it runs, and the screenshots wait for it, so the agent is never turned away either. Scrolls
are started in the page and filmed while they play. The remote-debugging toggle is never asked for; the agent mentions it
only if the user finds the motion choppy.

**AgentShot's browser**: while a tab is filmed its debugger stays attached (the extension sees a detach), its screencast
frames are not passed to the extension, and it keeps painting when the Browser panel is hidden (one pixel instead of
hidden: Chromium paints nothing for a hidden view). The panel opens when a take starts and shows **Recording**.

In every case the page is 1280×720 CSS pixels while filming (emulated for a screencast, the window sized through bsk) and is put back at the end. bsk's own overlay (its
glow, the "Agent controlling" pill and its input blocker) is kept off the film with bsk's own capture switch
(`data-bsk-capture-hidden`), and shows again while paused (its sign-in help is in it) and after the take.

## Recording

`src/main/take.ts`. `Page.startScreencast` sends frames only when the page changes, each with its timestamp; they are
written to disk as they come and encoded once when the take stops, from an ffconcat list whose durations are the frames'
real gaps. Minutes of the agent thinking cost nothing while recording. A small page script (top frame, re-added on every
navigation) reports pointer moves, presses, clicks, keys, input, focus, wheel and scroll, with element boxes: through a
CDP binding when there is one, else into sessionStorage, collected through bsk a few times a second. Its state is kept in
the DOM (which take put it in, whether it is paused), so it holds whatever script world bsk evaluates in, and a later take
or the end of this one quiets its listeners. Through bsk, typing goes in as text a character at a time (input events,
no key presses). Everything is on one clock: the take's start on this
machine, with frame timestamps mapped onto it.

`type` sends key events a character at a time at a person's pace (`bsk fill` would make the text appear at once).
`scroll` sends eased wheel input and, when the page ignores wheel input, eases whatever scrolls under the pointer.

A take lives in `walkthroughs/<id>/`: `take.mp4`, `take.json` (steps, events, paused stretches, viewport) and, once
composed, `walkthrough.json` (each step's line, voice, style, file and length, and the options).

## Composition

`src/shared/walkthrough.ts` (pure, tested) plans the film; `src/main/walkthrough.ts` renders it with the bundled FFmpeg.

- Per step (from its mark to the next), keep each action with a lead-in and its result, and the measured screen activity
  (`analyze_screen_activity`), merging close stretches. Stretches with activity but no action (loading, animations) longer
  than 2.5 s (1.5 s tight) are sped up to about 1.5 s (at most 8×). Paused and skipped stretches are left out.
- Every segment is a whole number of frames, so the film's times are the plan's times and the voices land where planned.
- The cursor is synthesized: the screencast has no pointer and an agent's clicks have no moves. It glides (eased) into
  each press, at a speed from the distance; recorded pointer moves are followed as they were.
- Zoom: actions within 3 s of each other whose boxes fit at 1.3× or more form a cluster; the camera eases in on it
  0.9 s before and out 1.4 s after, never across a scroll or a page load, and pans between clusters that are close.
- Rendering: the take is condensed in parts (24 segments each: input seek, speed, hold first/last frame), then one pass
  draws the zoom (`crop` driven per frame by `sendcmd`, then `scale`), the ripple layer (an ffconcat track of ripple frames
  timed to the clicks) and the cursor (`overlay` positions per frame), composited in RGB so thin edges keep their colour,
  and mixes the voices (`adelay`, `amix`, `loudnorm` to -16 LUFS). A film without lines still gets a silent track.

## Checks

```sh
npm test -- test/walkthrough.test.ts test/walkthrough-render.test.ts test/walkthrough-chrome.integration.test.ts
npm run test:walkthrough
```

`walkthrough-render` renders a synthetic take with stand-in voices and checks the size, length, sound, zoom and that
unchanged lines are not voiced again. `walkthrough-chrome` films a page in a throwaway Chromium (Playwright's, or
`MANUL_CHROMIUM`) through its `DevToolsActivePort`, as AgentShot does with the user's Chrome; it is skipped without one. The
desktop test runs twice: in AgentShot's own browser, and with `--chrome` the way the user's Chrome is filmed without remote
debugging (the agent on `chrome-bsk`, filmed through bsk's screenshots), with AgentShot's browser standing in for that Chrome
(`MANUL_CHROME_BSK_HOME`). It runs the real agent loop with a scripted model (a local OpenAI-compatible server as a custom provider, so no
paid model or voice): from a request on the start screen (the hint shows, no format to pick), it films a test product in AgentShot's own browser
(clicks, typing, a pause, a scroll), composes it, and checks the take's events, that bsk's overlay is not on film, that the
page scrolled, that the panel showed Recording only while filming, and the proposed film.
