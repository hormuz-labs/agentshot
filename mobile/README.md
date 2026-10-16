# Manul for your phone

Talk to Manul's agent from your phone. The work still happens on your Mac: your keys, your footage and the agent
stay there, and the phone is a window onto them.

What's in so far:

- **Pair** with your Mac by scanning the QR code in Manul → Settings → Phone
- **Projects:** the Mac's recent projects
- **Chat:** the same conversation as the agent panel on the Mac, live both ways. A message from the phone shows up on
  the Mac, and the Mac's edits show up on the phone.

Next: recording straight into a project, "Send to Manul" from the share sheet, previews of the cut, notes on the
frame, and a relay for when you're away from home ([ROADMAP.md](../ROADMAP.md), phase 4).

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

## How it talks to the Mac

Plain HTTP on the local network, with everything sealed (XChaCha20-Poly1305) under a key only the phone and the Mac
share. The QR code carries the Mac's addresses and a one-time secret good for five minutes. The phone uses it to get
its own key, which it keeps in the keychain. Each request is bound to its method and path, each reply to its request,
and each event to its place in the stream, so nothing can be replayed. The protocol is in
[src/shared/remote.ts](../src/shared/remote.ts), the Mac's server in [src/main/remote.ts](../src/main/remote.ts) and
this app's client in [src/mac.ts](src/mac.ts).

The conversation arrives as [AG-UI](https://docs.ag-ui.com) events, folded by the same code as the Mac's agent panel
([src/shared/agui-state.ts](../src/shared/agui-state.ts)). Metro and TypeScript resolve that shared code's packages
from this app's `node_modules` (see `metro.config.js` and `tsconfig.json`).

## Checks

```bash
npx tsc --noEmit
npx expo export --platform ios
```

The client's tests run with the Mac app's (`npx vitest run test/mobile-client.test.ts` in the repository root): they
pair, list, send and follow against the real phone server.
