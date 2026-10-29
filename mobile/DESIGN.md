# Mobile design lock

Target: AgentShot's existing product, adapted for a desktop-connected Android/iOS client.
References inspected: `docs/start.png`, `docs/dark.png`, `src/renderer/src/styles.css`,
`README.md` journeys, and Refero's bundled `craft-details.md` (no Refero MCP available).

The phone app is a studio, not a settings app: the film is the brightest thing on screen and
everything else steps back. All tokens and component themes live in `lib/ui/design.dart`.

| Decision | Why |
| --- | --- |
| Dark by default (warm near-black `#0E0D0C`), warm paper in light mode | Footage reads best on a dark canvas; the person can still pick Light or System |
| Three surface levels separated by hairlines, not outlined boxes | Depth without clutter; cards, fields and pressed states stay distinct |
| Amber `#F5A524` is the one action colour (primary button, selection, playhead) | One colour means "do this" |
| Spark gradient (amber → coral) only for asking the AI (Send, Create, a new cut) | AI actions are recognisable at a glance |
| Inter, small and mostly regular (as Instagram): 22 bold page titles, 16 semibold sheet titles, 14/13.5 regular body, semibold only on buttons; tabular figures for timecodes; 16 px page margins | Calm text that lets the film lead, and more of it in sight on a small phone |
| Continuous (superellipse) corners sized by the thing: chips 10, controls 14, cards 20, sheets 28 | Soft, native-feeling shapes instead of Material defaults |
| Home is the projects page: a poster grid, nothing else | Making something is one tap; projects are recognised by their frame, not a list of names |
| On a phone the project is its film: it fills the screen over a strip of the cut's shots. Notes are pins (a box on the picture near its moment, a dot on the strip), coloured by where they stand, opening to the agent's answer. Note / Box / Range / Ask open a small bubble right on the film, tagged with what it points at. What the agent is doing is a pill at the top that opens the conversation as a sheet; a new cut is decided on the film (Before / After, Send back, Keep). A project with no film yet is the conversation under its chip | Editing feels like editing: every note is about a moment or a spot, so it lives there, not in a chat; the conversation is one tap away for long answers, questions and history | A chat as the main screen made each note a context switch |
| Flat icon-only tab bar with + in the middle (Instagram); one create sheet with the format picked inline | Fewer dialogs; thumb-reach actions |
| Progressive disclosure: each screen shows what's needed now; the rest is one tap or gesture away | Home is the projects. Every way to start is behind +, search behind its icon, project actions on a long press, refresh on pull-down, and a quiet line under the title says where the projects are (AgentShot Cloud, or which computer). In a project: the film and its pins, the conversation behind the activity pill, and model and credits in the composer's + tray |
| Symbols over words: an icon wherever one is understood at a glance (↓ to the latest, the appearance switch, the film's rail), its words as the tooltip and the screen reader's label; no descriptions under settings | People use these patterns in every app; words only where an icon would be a guess |
| Time shows as progress: a bar, with a percent when it's known, for anything that takes a while (a film coming onto the phone, uploads, exports, getting into AgentShot Cloud with its seconds) | Waiting is easier when it's visibly moving |
| A finished run of the agent's steps is one line ("21 steps") that opens to the steps; a step opens to its command and output; a step that failed shows why even folded | The work is there when wanted, not in the way of the reply |
| Scrolling up to read hides the message box and the keyboard; scrolling down or reaching the latest brings it back (never while a note is under way) | Reading gets the whole screen |
| Few words: an icon, or one or two words, where a sentence was (Describe it / Import / Record / Walkthrough; New cut; Message…) | Less to read, faster to scan |
| Thumb reach: what's done often or decided sits in the bottom third (tab bar, +, the new-cut card, the composer, sheets with their buttons at the end); the top holds what's read (titles, the film) and rare actions (search, export, the project menu) |
| No edge swipes: everything opens with a tap; every sheet comes through `showSheet` with a visible handle (drag down to close, up when tall) and its content kept above the bottom gesture strip | The phone's own swipe-up (Home, app switcher) never competes with the app |
| 44–50 px controls, safe areas, text scaling up to 3× | Usability on small phones and with large text |

Use code-native Material controls and the existing AgentShot icon. Keep media at its real
aspect ratio and normalize frame boxes to 0–1. No decorative stock footage or fake jobs.

Regenerate assets with `python3 mobile/scripts/brand.py` (Pillow; fontTools and
brotli for font conversion). Store artwork lives in `assets/brand/`; iOS artwork
is opaque and square, allowing the OS to apply its own mask.

Capture light/dark home, examples, activity and project screens with
`flutter test scripts/preview_test.dart` from this folder. The outputs under
`build/brand-preview/` use fixture projects and conversations for layout inspection,
not live editing evidence. Native splash screens and launcher masks need device QA.

## Visual QA

Reviewed 390×844 light/dark pairing, home and populated conversation captures
against the desktop reference. Confirmed the cat identity, serif/sans hierarchy,
neutral canvas, amber actions and legible Material icons. The capture harness
loads the actual fonts and waits for the cat image before rasterizing.
All iOS icon entries were checked for required pixel dimensions and opaque RGB;
Android resource XML and iOS plists/storyboard parse successfully.
