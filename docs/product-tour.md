# First-run product walkthrough

## Product analysis

AgentShot is a local, conversation-led video editor. The start screen creates a project from a video and optionally sends
the first direction. `ProjectView` brings together the agent conversation, video preview, timeline and proposal controls.
Users can direct edits through text, a playhead note, a timeline range or a box on the picture. The sidebar holds projects,
chats and assets; `@` mentions attach assets and versions. An agent proposal is compared before/after and accepted or
rejected. Versions and History preserve earlier work. Export renders the version on screen to MP4 with format and
caption choices. Keys, appearance, skills, memory, browser and local tools are managed in Settings.

The walkthrough follows these implemented controls rather than roadmap features. In particular, it uses the UI’s
**Accept / Reject** labels and explains that captions need a transcript. It supports both provider keys and the existing
AgentShot-key sign-in/paste flow. macOS uses ⌘ shortcuts; Linux uses Ctrl.

## Walkthrough structure

- **Home, six steps:** welcome → Keys → footage → direction → suggestions → start project.
- **Editor, ten steps:** workspace → conversation → playback → moments/ranges → boxes → assets → proposals →
  versions/history → export → first request.
- Fresh profiles are introduced after telemetry preferences have been settled and tabs have restored. Existing profiles
  with recent projects get a replay entry. Completing the home introduction queues the editor tour for the first opened
  video. Skipping the home tour dismisses both automatic introductions.
- Completion/dismissal lives in `localStorage` under `manul.tour.v1`, separately for home and editor. No footage, account
  or project identifiers are stored there. Replay works from the sidebar, native Help menu and command palette.
- Settings and other dialogs pause the tour and resume the same step when closed. The Keys step opens the real settings
  panel. Spotlight targets resolve only visible elements, so background tabs cannot be highlighted.
- Replay opens the sidebar and film/conversation panes and pauses playback. Escape skips; arrow keys navigate; Tab stays
  within tour controls. Editor shortcuts cannot operate underneath the tour. Reduced-motion preferences are respected.

## First-open Settings tour

Opening Settings through any entry point records `first_opened_at` in `<userData>/onboarding.sqlite`, table
`settings_onboarding` (one row per local profile). The editing agent owns its own SQLite schema, so onboarding uses a
separate database. The main process inserts the record once; reopening Settings never replaces its timestamp.

The Settings walkthrough has **only two topics**, across three steps:

1. **Your own keys / BYOK:** what an API key means, provider accounts, Add → paste → Save, and provider billing.
2. **AgentShot key:** one gateway connection, sign-in/pasting, AgentShot credit, automatic model selection, and BYOK priority.
3. **Browser:** the built-in browser versus personal Chrome, the project’s globe button, and BrowserSkill requirements.

It automatically switches Keys subtabs and the Browser settings section, using the same `tour-driver.ts` presentation as
the home/editor tours. A Settings tour pauses any main walkthrough. Completion or skipping is saved as `tour_status` in
SQLite and suppresses future automatic Settings tours. If the app exits before an outcome is recorded, the pending tour
can be shown again when Settings is reopened. The first-open timestamp is still preserved.

## Visual integration

Driver.js provides positioning, the SVG spotlight and step navigation. Its stock stylesheet is **not imported**.
`src/renderer/src/tour.css` uses the app’s existing semantic color tokens, Inter Variable for controls, Source Serif 4
Variable for headings/examples, 12px card corners and amber primary buttons. Both themes update from the app’s tokens.
Step copy and target resolution live in `lib/product-tour.ts`; lifecycle and replay are in `components/ProductTour.tsx`.

## Verification

`npm run typecheck`, `npm run test:tour`, and `npx vitest run test/product-tour.test.ts`. The Electron end-to-end test uses disposable profile/project directories,
generated local footage and mocked readiness/telemetry IPC. It exercises consent ordering, Settings pause/resume,
spotlight targets, both themes, minimum window size, keyboard behavior, completion, replay and persistence. No AI request
is necessary to complete the walkthrough.

`test/onboarding.test.ts` verifies first-open uniqueness and persisted completion/dismissal. The Electron tour test reads
the actual SQLite record, follows the Keys subtabs and Browser section, checks both themes at the minimum window size,
and verifies completion/relaunch and dismissal/reopen behavior.

The platform-copy unit tests verify macOS Command shortcuts and Linux Control shortcuts for x86_64 and ARM64. Existing
editor-focused end-to-end tests dismiss onboarding through its visible button before exercising the editor.
