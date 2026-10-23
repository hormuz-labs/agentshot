# Mobile design lock

Target: Manul's existing product, adapted for a desktop-connected Android/iOS client.
References inspected: `docs/start.png`, `docs/dark.png`, `src/renderer/src/styles.css`,
`README.md` journeys, and Refero's bundled `craft-details.md` (no Refero MCP available).

| Decision | Reference | Role |
| --- | --- | --- |
| Near-white canvas; dark-fur alternative; amber actions | Existing desktop tokens | Amber denotes actions/selection, blue denotes frame annotations |
| Film and conversation stay central | Desktop project view and README | Two columns only with sufficient width; selectable sections on phones |
| Conversational prompts | Existing start screen | A request begins the edit; proposals still require Keep/Send back |
| 48px controls, scrolling forms, safe areas | Craft details and user's size requirements | Preserve system text scaling; avoid fixed-height content cards |
| Native file/camera pickers and share sheet | Android/iOS target | Phone footage uploads to desktop; exports return to the phone |
| Inter UI + Source Serif 4 headings | Desktop font packages and start-screen typography | Locally bundled OFL fonts; headings use a single family throughout |
| Canonical cat artwork | `src/renderer/public/manul.png`, `build/icons/1024x1024.png` | Native launch, in-app identity and store icons; Android foreground stays inside the mask safe zone |
| Consistent Material glyphs with visible labels/tooltips | Refero `icons.md`, native Flutter controls | Functional actions; cat artwork owns brand recognition |
| Sign in → Your computers → Connect | account/relay journey and user's anywhere requirement | Account sign-in and computer selection are the connection UI; no manual LAN options |
| Neutral connection progress, explicit conversation loading | User's phone screenshots, existing surface tokens, Refero color role rules | Reconnection progress is not a red failure; do not show an empty-conversation prompt until history loads |

Use code-native Material controls and the existing Manul icon. Keep media at its real
aspect ratio and normalize frame boxes to 0–1. No decorative stock footage or fake jobs.

Regenerate assets with `python3 mobile_app/scripts/brand.py` (Pillow; fontTools and
brotli for font conversion). Store artwork lives in `assets/brand/`; iOS artwork
is opaque and square, allowing the OS to apply its own mask.

Capture light/dark pairing, home and conversation screens with
`flutter test scripts/preview_test.dart` from this folder. The outputs under
`build/brand-preview/` use fixture conversations for layout inspection, not live
editing evidence. Native splash screens and launcher masks need device QA.

## Visual QA

Reviewed 390×844 light/dark pairing, home and populated conversation captures
against the desktop reference. Confirmed the cat identity, serif/sans hierarchy,
neutral canvas, amber actions and legible Material icons. The capture harness
loads the actual fonts and waits for the cat image before rasterizing.
All iOS icon entries were checked for required pixel dimensions and opaque RGB;
Android resource XML and iOS plists/storyboard parse successfully.

Anywhere connection update: retained this visual lock and reviewed the new
390×844 pairing capture. The amber sign-in action is primary, the cat and type
hierarchy are preserved, and the explanation explicitly allows Wi-Fi or mobile data.
