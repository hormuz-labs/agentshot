# AgentShot mobile

Flutter companion for **Android and iPhone/iPad**, connected to the existing AgentShot
desktop editing engine. This is an initial implementation, not a published store release.

## Run

1. From the repository root: `npm install`, then `npm run dev`.
2. On the desktop, open **Settings → Mobile** and turn on **Let my phone connect**.
3. In `mobile/`, start the emulator and the app (`make setup` once first: packages, the Android mesh library, a
   toolchain check):

   ```sh
   make start   # the Android emulator, in a window
   make run     # the app, with hot reload
   ```
4. Scan the QR code on the desktop with the phone's camera or **Scan QR code** in the app. On the same Wi-Fi (and
   from the emulator) the 6-digit code works too. A code expires after five minutes and pairs one device.

Pairings last 30 days, across restarts of AgentShot, until removed in **Settings → Mobile**.

`make help` lists the rest: `desktop` (step 1), `install`, `test`, `analyze`, `e2e`, `screenshots`, `bundle`,
`logs`, `stop`. The Makefile finds Flutter and the Android SDK in `PATH`, Android Studio's usual folders or
`~/development`; set `ANDROID_HOME`, `FLUTTER` or `AVD` to use others. Android builds need Go (for the mesh library),
the NDK and Java 17. iOS builds require a Mac with Xcode. The iOS deployment target is 14.0.

## Signing in

The welcome screen leads with **Continue with Google**: the phone signs in to the same AgentShot account as the
computer and lists every computer signed in to it, at home or away; one tap opens one. The 6-digit code and QR stay
under **Other ways to connect** for computers that aren't signed in.

- Sign-in is Clerk in the browser (OAuth with PKCE, the desktop's public client), returning to
  `agentshot://auth/callback`. **That redirect URI must be added to the Clerk OAuth application** (Clerk dashboard →
  OAuth applications → the AgentShot app → Redirect URIs) before it works in production.
- The account service lists the person's computers with a day-long token each (`/v1/workers`, fed by the desktop's
  worker heartbeat, which now runs whenever the desktop is signed in and Settings → Mobile → **Let my phones connect**
  is on). The phone renews a token when it runs out.
- `AUTH_ISSUER`, `AUTH_CLIENT_ID` and `ACCOUNT_URL` (`--dart-define`) point the app at a development Clerk instance
  or account service.

## Implemented workflows

- Secure desktop pairing; reconnecting live AG-UI conversations and job updates.
- Browse/search desktop projects, create projects from phone files, record video,
  import multiple files and ZIPs, create motion videos or browser walkthroughs.
- Full desktop AI toolset through chat: transcription, analysis, editing, titles,
  captions, motion generation, browser research/filming, and voice/music tools.
- Gallery search/category filters, preview, source attribution, prompts, and
  **Use this example**.
- Multiple conversations, rename/switch chats, model selection, file/version/clip
  mentions, streaming text/tool results, usage cost, stop, and consent cards.
- Film playback/scrubbing, before/after proposals, keep/send back with feedback,
  timestamp/range/normalized frame-box notes, and review of resolved notes.
- Versions and restore checkpoints; timeline reorder/split/trim/delete/insert,
  mute, undo/redo, film/music levels, speech ducking, rendered preview.
- Desktop export in original/16:9/9:16/1:1, crop/pad, burned/SRT captions;
  download video and subtitle files and share/save through the native share sheet.
- Desktop API keys, skills/profiles, memory, tools installation/removal, account
  balance, provider inspection, browser navigation/tab management.
- System/light/dark themes, phone/tablet layouts, scrollable keyboard-aware forms.
- Actual AgentShot launcher icons, Android adaptive/themed icons, native launch
  artwork, and bundled desktop fonts. See `DESIGN.md` and `scripts/brand.py`.

## Feature parity and remaining work

`FEATURES.md` records the desktop surface and how each capability is delivered.
Some interactions still require the desktop: direct HTML element drag/resize and
retyping, browser page takeover/sign-in, advanced demo/framing inspectors, custom
provider creation, account/billing management, filesystem folder selection, and
desktop tool-path configuration. Their editing capabilities remain accessible
through the desktop agent; these native interaction surfaces are not all ported.

The mobile film player reviews rendered versions. A manual timeline or mix change
requires **Render preview**; it does not yet have the desktop's live multi-source
timeline/mix player. Preview format support depends on the device; heavy sources
use desktop-generated proxies when available.

Uploads/downloads stream without loading the whole video into memory. Uploads
have a 4 GB limit, run in the foreground, and are not resumable. Background OS
transfers, incoming share extensions, QR scanning/discovery, offline project
cache, and push notifications are follow-up work. Downloaded exports remain in
the app's temporary directory until the OS clears them; use the share sheet to
save them to Files/your preferred app.

## Pairing from anywhere (Headscale mesh)

When the desktop is signed in to AgentShot it joins AgentShot's Headscale mesh (`agentshot-mesh`, a userspace
Tailscale node; no VPN app or root). Its pairing QR is an `agentshot://pair` link carrying the code, the
certificate fingerprint, every address and a single-use key for the mesh. Scanning it, the Android app starts
its embedded mesh node (`scripts/mesh/mobile`, via gomobile), joins with that key, and reaches the desktop at
its mesh address through a local CONNECT proxy, so TLS stays end to end and pinned. The node is kept on the
phone and rejoins on launch. The iOS app scans the QR but doesn't embed the mesh yet: it pairs over Wi-Fi or
Tailscale.

## Transport

`src/main/mobile-bridge.ts` starts only when explicitly enabled on the desktop.
Each bridge lifetime gets a new TLS certificate. The pairing payload includes its
SHA-256 fingerprint and a one-use 256-bit secret. The Flutter client pins that
certificate before sending the pairing secret. Session credentials stay in OS
secure storage; provider keys stay in the desktop key store.

Network calls use an explicit validated allowlist (`mobile-contract.ts`), not
arbitrary Electron IPC. Project access is restricted to known projects. Media
uses realpath checks, excludes hidden files, supports HTTP byte ranges, and
rejects symlink escapes. Browser-origin requests are rejected. Pairing attempts,
live connections and concurrent uploads are bounded. SSE reconnection replays a
complete agent snapshot; failed mutations are not automatically resubmitted.

Native AVPlayer/ExoPlayer accesses an unguessable loopback-only media relay. The
relay authenticates remote requests over the pinned TLS connection. Only
loopback cleartext is allowed; no remote HTTP exception or global certificate
override is used. Gallery HTTPS videos use the platform's normal TLS validation.

## Verify

```sh
flutter analyze
flutter test
# repository root:
npm run typecheck
npx vitest run test/mobile-bridge.test.ts
```

Widget checks include 320px phones, landscape, tablets, 1–3× text scaling and
keyboard insets, plus examples, activity, settings sheets, film proposals, files,
timeline and mix controls. `flutter test scripts/preview_test.dart` captures
light/dark fixture screenshots under `build/brand-preview/` for visual QA.
Real-device camera, interrupted transfers and iOS signing still need device
testing before a store submission.

### End to end

`integration_test/` runs the app on an Android emulator or phone against the
real desktop app, over the real certificate-pinned connection. From the
repository root, with an emulator running (or an AVD it can boot):

```sh
npm run test:e2e:mobile
```

`test/e2e/mobile.e2e.mjs` starts desktop AgentShot with a throwaway profile, a
project made from a test video and a scripted model (no API keys), turns on
Settings → Mobile, and runs each test with a fresh pairing code. The desktop's
downloads from the internet fail at once (so Install and Download can be pressed
without fetching hundreds of megabytes), and the examples' videos come from the
runner. A test asks the runner for what only it can do with a `DESKTOP …` line
(offline and back, the share sheet's Back, the camera permission, the computer
signing out and in); the system pickers and the camera hand over the runner's
test media through `Picker.override` and `Picker.recordOverride`:

| Test | Covers |
|---|---|
| `pairing` | the other ways to connect fold open and shut; Scan QR code opens the camera; a wrong code typed is refused; Paste code connects; still paired after a restart |
| `projects` | search, open a project, play its film, see its files; Refresh and pull to refresh; Move to Trash asks (Cancel, then Confirm) |
| `conversation` | send a note, the reply streams back, new and switched conversations; rename a conversation; pick a model and Automatic; @ and + mention a file or version, and take it off; Stop a slow turn |
| `film` | play, pause, mute, seek; Note here, Draw a box (and Cancel box), Note a range (a wrong range caught, Cancel); a box note reaches the agent and shows under the film; Timeline & mix |
| `editing` | the agent proposes a cut and the conversation shows a card (and the Film tab a dot); Send back with feedback from the card; Watch, Before/After, Keep; Versions |
| `create` | Start from an idea → 9:16 → the agent builds and renders a motion clip; play and keep it; Film a walkthrough (Cancel, then for real) |
| `examples` | search, filter by category, open an example and its preview, Use this example → 1:1 → a project the agent picks up |
| `uploads` | several videos, photos only (a project made from scratch), a mix with a photo first, several photos attached to a note; Record; a text file alone is turned away; one photo → 16:9 |
| `timeline` | a project from two clips: Import files, attach a file, Insert at playhead (and a file that can't go in), Download / share, Remove (Cancel, Confirm, a protected file); Split, Undo, Redo, Move earlier/later, Mute, Trim (a wrong one caught), Remove piece; the mix with music, Save mix, Render preview; restore a checkpoint; choose a version; Transcribe asks to download speech recognition: Decline, and Download from Activity |
| `export` | the export sheet closed without exporting; format, fit and captions; Render and download → share sheet |
| `responsive` | every screen, sheet and settings panel at 320×568, 393×852, phone landscape and tablet sizes, text ×1 and ×2: no overflow, nothing unreachable |
| `connection` | Try again on a panel and Retry preview on the film once the computer is back; out of reach and back by itself; disconnected by the computer → the connect screen, saying why |
| `change_computer` | out of reach, Change computer leads back to the connect screen |
| `setup_ai` | a computer with no AI: closing the question says why the note didn't go; an own key added from it sends the note; the key removed in Settings; AgentShot credits sign in and hand the account over |
| `signin` | Continue with Google, the signed-in computer shows up by itself; Refresh, pull to refresh; Pair with a code instead and back; the computer signs out (Check again) and back in; open it, switch computer, sign out from Settings and from the list |
| `cloud` | none of the person's computers on: Use a cloud worker leases one (a real `--worker` the runner starts), an idea becomes a project there and the agent answers, Switch computer gives it back; the runner checks the project is on the worker, not the computer |
| `settings_panels` | Appearance; an AI key added and removed; a new skill profile and back, a skill off and on; Memory remember, edit, forget (Cancel first); Desktop tools Install (Cancel, then yes) and Speech recognition; the agent browser: mode, a new tab, Navigate, reload/back/forward, close a tab, refresh; AgentShot account; About and its licenses |
| `settings` | desktop settings and providers, other tabs, disconnect |

It then checks the desktop side: the notes reached the agent, the kept cut is
the current version, the idea became a project, and the phone was unpaired.
`MOBILE_E2E_ONLY=editing,create` runs some; `MOBILE_E2E_DEVICE` picks a device.
CI runs it on an Android emulator (`.github/workflows/mobile.yml`).

## Distribution

Android: copy `android/key.properties.example` to `android/key.properties` and
configure your upload keystore (ignored by git). `flutter build appbundle` creates
the Play bundle. Release builds do not fall back to debug signing.

iOS: open `ios/Runner.xcworkspace` after `flutter pub get` / CocoaPods setup on a
Mac. Set the Apple development team and register the bundle identifier, then use
`flutter build ipa`. Signing credentials, App Store Connect / Play Console
listings, privacy declarations, screenshots and final device QA must be completed
by the release owner. No store account or signing identity is included here.
