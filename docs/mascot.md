# Manul's 3D companion

An original, stylized Pallas's cat, drawn locally with Three.js/WebGL2. Its broad face, low rounded ears,
round amber pupils, cheek markings, fluffy coat, short paws and ringed tail are built procedurally.
No model, texture, or animation is fetched from a service.

## In the app

- **Home:** a larger cat above the greeting. Typing tilts its head; creating a project starts its working pose.
- **Empty chat:** the cat greets you above “What should change?”
- **Conversation:** one companion above the composer, with a readable activity label.
- **Pet it:** click or focus it and press Enter/Space for a small hop.

The agent's AG-UI state drives the companion, not timers pretending that work is happening:

| State | Motion |
|---|---|
| Idle | Breathing, blinking, looking around, a slow tail sway |
| Thinking | Curious head tilt |
| Working | Alternating paw taps and a quicker tail sway |
| Speaking | Gentle mouth movement |
| Waiting | Attentive tilt while a question or permission needs an answer |
| Success | A brief hop after a run produces a reply |
| Error | Concerned expression alongside the existing error message |
| Sleeping | Closed eyes and slower breathing after 30 seconds without clicks or typing |

`lib/mascot.ts` maps running tool IDs to activity. Historic tool cards cannot keep it working.
`ManulCompanion.tsx` owns the short completion and inactivity transitions.

## Rendering and accessibility

`components/mascot/scene.ts` builds the geometry and animation rig. Fur uses instanced tapered strands;
body parts share geometry. The contact shadow is baked on a tiny local canvas, with no real-time shadow maps
or postprocessing. Device pixel ratio is capped at 1.75, animation at 24 fps idle / 30 fps active.

The Three.js scene is lazy-loaded. Hidden project tabs release their GPU resources and restore them when opened.
Offscreen avatars and hidden app windows pause animation. `prefers-reduced-motion` produces a still pose and
re-renders only for state, theme, or size changes. A local SVG cat is shown while loading and if WebGL fails.
The pet button has an accessible state description; chat progress is announced through a polite status region.

Reuse the mascot with:

```tsx
import { ManulMascot } from '@/components/mascot/ManulMascot'

<ManulMascot state="thinking" size={112} active={true} />
```

## Verify

```bash
npm run typecheck
npx vitest run test/mascot.test.ts test/agui.test.ts
npm run build
node test/e2e/mascot.e2e.mjs
```

The Electron test uses real WebGL and synthetic AG-UI events; it does not make paid AI calls.
It checks activity transitions, actual animated frames, reduced-motion stillness, sleeping/waking,
tab resource cleanup/restoration, keyboard interaction, and context-loss fallback. Screenshots are saved
in the output folder printed by the test (or the folder supplied as its first argument).
