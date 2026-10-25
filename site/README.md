# agentshot.si

The website for [AgentShot](https://github.com/hormuz-labs/agentshot), the agentic video editor. Astro, static, no framework JS: the only script is the hero demo (`src/components/Demo.astro`), a working miniature of AgentShot's editor.

The look is the steppe the manul lives on: a cream page where every section sits on its own painting (seven in `public/paint/`, made for this site, each loaded only when its panel comes near and drifting a little slower than the page), white sheets over them for reading, dark pill buttons, and the app's amber for what Manul does. Type is Albert Sans, with IBM Plex Mono for commands and timecodes.

Scrolling tells part of the story: the line under the hero fills in letter by letter, and the readout pins and steps through its six tracks. That happens only on screens at least 900 × 620 and never with reduced motion, where both are plain static sections. The hero sizes the editor to the window so all of it is on the first screen.

The motion tiles play small silent previews from `public/motion/` (768 px, 30 fps, about 0.5 MB each), made from the gallery's full videos with `ffmpeg -i in.mp4 -an -vf fps=30,scale=768:-2 -c:v libx264 -crf 27 -preset slow -movflags +faststart out.mp4`; clicking one opens the full video, with sound, from Manul's bucket.

The demo inside keeps the app's own look (warm paper, amber, a serif for the agent's replies) and its project tree, so it looks and works like Manul really does.

```bash
# From the Manul repository root:
npm run site:install
npm run site:dev          # http://localhost:4321
npm run site:build        # → site/dist/
npm run site:test:demo    # clicks through the demo in Chrome, screenshots each stage
npm run site:test:sizes   # checks 18 screen sizes for anything spilling off screen
```

Originally deployed by Cloudflare Pages from `hormuz-labs/manul-site` on every push to `main`.
The Pages project is `manul-site`, serving `https://agentshot.si`.
See [workspace and hosting](../docs/workspace.md) for the monorepo deployment cutover and Docker hosting.

Imported from `https://github.com/hormuz-labs/manul-site.git` at commit
`21e2affde898a94bbc548a597224d1115a33ed2f`. Source, media, editor settings, and browser checks
live here; the release-following workflow lives at `../.github/workflows/site-release.yml`.

The demo clips in `public/demo/` are real edits (ffmpeg) of "Manul Timofey" by the Moscow Zoo, [CC BY 4.0](https://commons.wikimedia.org/wiki/File:%D0%9C%D0%B0%D0%BD%D1%83%D0%BB_%D0%A2%D0%B8%D0%BC%D0%BE%D1%84%D0%B5%D0%B9_%D0%BD%D0%B0_%D1%80%D0%B0%D0%B7%D0%B6%D0%B8%D1%80%D0%BE%D0%B2%D0%BA%D0%B5.webm).
