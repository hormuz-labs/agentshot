# Manul mobile

Flutter companion for **Android and iPhone/iPad**, connected to the existing Manul
desktop editing engine. This is an initial implementation, not a published store release.

## Run

1. From the repository root: `npm install`, then `npm run dev`.
2. On the desktop, open **Settings → Mobile → Enable mobile connection**.
3. Put the computer and phone on the same network (or on the same [Tailscale](https://tailscale.com) network).
   Copy a connection code for the computer's reachable address.
4. Run the Flutter app:

   ```sh
   cd mobile
   flutter pub get
   flutter run
   ```
5. Paste the connection code into the mobile app. It expires after five minutes
   and can pair one device. Generate another code to pair another device.

Keep desktop Manul running. If the computer sleeps, the app reconnects when it
returns. Quitting Manul or disabling the bridge revokes all pairings; pair again
after restarting it. This version supports a reachable local network, not an
internet relay or cloud account-based device discovery.

Flutter is installed at `/home/adnan/flutter-sdk/bin/flutter` in the development
environment used to start this project. Android requires Java 17 or newer; use
`JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` here rather than the system Java 11.
iOS builds require a Mac with Xcode. The iOS deployment target is 14.0.

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
- Actual Manul launcher icons, Android adaptive/themed icons, native launch
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
Real-device camera, playback, TLS networking, interrupted
transfers and iOS signing still need device testing before a store submission.

## Distribution

Android: copy `android/key.properties.example` to `android/key.properties` and
configure your upload keystore (ignored by git). `flutter build appbundle` creates
the Play bundle. Release builds do not fall back to debug signing.

iOS: open `ios/Runner.xcworkspace` after `flutter pub get` / CocoaPods setup on a
Mac. Set the Apple development team and register the bundle identifier, then use
`flutter build ipa`. Signing credentials, App Store Connect / Play Console
listings, privacy declarations, screenshots and final device QA must be completed
by the release owner. No store account or signing identity is included here.
