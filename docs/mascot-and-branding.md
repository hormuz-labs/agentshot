# Manul companion and branding

The app’s logo is the **front-view, full-body 3D Pallas’s cat**, rendered from the same procedural geometry as the animated
editing companion. `npm run brand` regenerates the transparent portrait and all derived assets:

- `build/icon.png`, `build/icon.svg`, `build/icon.icns`, `build/icon.ico` and `build/icons/*` for app/installer and repository branding.
- `src/renderer/public/manul.png` and `manul.svg` for the app, walkthroughs, favicon and WebGL fallback.
- `src/shared/brand.ts` for desktop sign-in and account/checkout return pages, using a smaller 2× portrait.

The SVG assets embed the rendered PNG; they preserve the 3D appearance rather than approximating the model with paths.
The macOS ICNS is generated on macOS; Linux and ICO assets are generated on either supported platform.

## Companion interactions

- Petting reacts on pointer-down, with squash, a quick lift and a soft landing. Repeated pets cycle through a wave,
  nuzzle and growl. Interaction bursts render at 60 fps, then return to the lower idle frame rate.
- Pupils follow the cursor across the app window, independently of the slower head movement. Eye sockets bound the gaze.
- Irregular blinks, occasional double blinks, ear twitches, tail movement, curious peeks and yawns add subtle character.
- Raised front legs use shoulder pivots, with visible paw pads. Successful replies wave; waiting looks curious; errors
  briefly growl; inactivity leads to a catnap.
- Original synthesized purrs, chirrups and throaty growls use Web Audio. Audio is unlocked by interacting with the cat,
  rate-limited, and suppressed while film/audio is playing. The mute preference persists under `manul.mascot.sound`.
- The chat companion keeps its current 88px size. Name, status and **three SVG-only buttons** form a compact aligned stack
  within that height. Tooltips and accessible labels explain high-five, growl and sound toggling. Larger standalone cats
  reveal their compact controls on hover/focus.
- Reduced motion renders still poses and disables ongoing motion. Background tabs release their WebGL context; hidden
  windows pause animation. The static full-body portrait survives a WebGL failure.

Run `npm run test:mascot`, `npm run typecheck`, and `npx vitest run test/mascot-motion.test.ts test/mascot.test.ts`.
