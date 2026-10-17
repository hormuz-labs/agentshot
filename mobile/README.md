# Manul for your phone

Talk to Manul's agent from your phone. The work still happens on your Mac: your keys, your footage and the agent
stay there, and the phone is a window onto them.

What's in so far:

- **Pair** with your Mac by scanning the QR code in Manul → Settings → Phone
- **Projects:** the Mac's recent projects
- **Chat:** the same conversation as the agent panel on the Mac, live both ways. A message from the phone shows up on
  the Mac, and the Mac's edits show up on the phone.
- **Footage:** in a project's chat, **+** records a video or picks videos and photos from the library. Each goes
  straight to the Mac over the Wi-Fi, into the project's files (and its history), and rides along with your next
  message so the agent knows what you mean. An upload cut short by a drop, the phone sleeping or the app closing
  carries on from where the Mac got to.
- **Send to Manul:** the iOS share sheet's "Send to Manul" (Photos, Files, …) hands the files to the app, which asks
  which project they go into.
- **Away from home:** if the Mac and the phone are both on [Tailscale](https://tailscale.com), the phone reaches the
  Mac over the tailnet from anywhere, with nothing to set up. The Mac puts its Tailscale address in the pairing code,
  and a paired phone asks the Mac for its current addresses each time it opens. So a phone paired at home finds the
  Mac over Tailscale later, even if the Mac joined after pairing. Settings → Phone shows whether the Mac is on Tailscale.

Next: previews of the cut, notes on the frame, and a relay for when you're away from home without Tailscale
([ROADMAP.md](../ROADMAP.md), phase 4).

## Try it

Settings → Phone is only in development builds of the Mac app for now.

1. On the Mac, run Manul from source (`npm run dev` in the repository) and turn on **Settings → Phone → Let my phone
   connect**.
2. Here, install and start the app:

   ```bash
   cd mobile && npm install && npx expo start
   ```

3. Open the project in **Expo Go** on your phone (scan the code `expo start` prints), on the same Wi-Fi as the Mac.
4. Scan the pairing code from Settings → Phone. In the iOS Simulator, which has no camera, copy the link instead
   (`window.manul.phone.pair()` in the Mac app's developer tools gives it) and paste it under "Or paste the pairing link".

## Send to Manul (share extension)

The share extension is native code ([targets/share](targets/share)), added to the Xcode project at prebuild by
[`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets). Expo Go can't load it, so it needs a
development build:

1. In `app.json`, set `ios.appleTeamId` to your team, and change `ios.bundleIdentifier` and the app group
   (`group.com.hormuzlabs.manul.mobile`, also in `src/files.ts` and `targets/share/ShareViewController.swift`) if you
   sign with another team.
2. Build and install a development build: `npx expo run:ios --device` (needs Xcode) or
   `npx eas-cli@latest build --profile development --platform ios` (no Xcode; registers the app group and the
   extension's bundle id, `….share`, for you).
3. Run `npx expo start` and open the development build instead of Expo Go.

The extension doesn't upload anything itself. It copies what it was given into the app group's `share/` folder and
opens the app at `manul://share`, and the app sends it like a file picked in the app. A share extension has little
memory and is ended once it closes, so the upload, which may take minutes and resume after a drop, belongs to the app.

What has been checked without Xcode: the Swift typechecks against Mac Catalyst's UIKit in the command line tools'
SDK, with app-extension API limits on (`swiftc -typecheck -target arm64-apple-ios16.4-macabi -application-extension`),
and `expo prebuild` adds the `ManulShare` target with the app group on both targets. What hasn't: building and
signing it, the share sheet listing "Send to Manul" for videos, photos and files, opening the app from it (iOS gives
extensions no public way to open their app, so it goes through the responder chain as other share extensions do), and
the app picking the files up from the app group.

## How it talks to the Mac

Plain HTTP on the local network, with everything sealed (XChaCha20-Poly1305) under a key only the phone and the Mac
share. The QR code carries the Mac's addresses and a one-time secret good for five minutes. The phone uses it to get
its own key, which it keeps in the keychain. Each request is bound to its method and path, each reply to its request,
and each event to its place in the stream, so nothing can be replayed. The protocol is in
[src/shared/remote.ts](../src/shared/remote.ts), the Mac's server in [src/main/remote.ts](../src/main/remote.ts) and
this app's client in [src/mac.ts](src/mac.ts).

Footage goes up in pieces of 1 MB, each sealed as bytes (no JSON or base64, 48 bytes more than the piece) and bound
to its upload and its offset, so a piece can't be moved, repeated or changed on the way. The Mac keeps an upload in
its own folder until it is whole, then adds it to the project as if you had added it on the Mac. After a drop the
phone asks how much the Mac has and carries on from there; a piece anywhere else gets a 409 with the same answer.
Nothing goes through a server.

The conversation arrives as [AG-UI](https://docs.ag-ui.com) events, folded by the same code as the Mac's agent panel
([src/shared/agui-state.ts](../src/shared/agui-state.ts)). Metro and TypeScript resolve that shared code's packages
from this app's `node_modules` (see `metro.config.js` and `tsconfig.json`).

## Checks

```bash
npx tsc --noEmit
npx expo export --platform ios
```

The client's tests run with the Mac app's (`npx vitest run test/mobile-client.test.ts` in the repository root): they
pair, list, send, follow and upload against the real phone server, with drops and a piece changed on the way.
`npm run test:phone` sends a clip into the real Mac app.
