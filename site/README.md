# agentshot.si

The website for [AgentShot](https://github.com/hormuz-labs/agentshot), the video editor you talk to. Astro, static, no framework JS.

The page has one job: get the visitor to install AgentShot. So it is built around one set of buttons (`src/components/Cta.astro`): Mac, Windows and Linux, with the visitor's own system first and in yellow. On a phone, where the app can't install, they give way to one button that sends the link to the visitor's computer. A small script in `<head>` sets `html[data-os]` before first paint, so the buttons never flash in the wrong order.

The look is a screening room: a black page so film looks right, hard edges, and one colour, burned-in caption yellow. Yellow means "act here", so keep it rare. Type is Archivo, condensed for headlines through its width axis, with IBM Plex Mono for commands and timecodes.

Proof is real or it isn't on the page: the demo plays real renders, the screenshots are the app, and captions say what each clip is. No invented testimonials, logos or user counts.

The hero demo (`src/components/Demo.astro`) keeps the app's own look, so it looks and works like AgentShot really does.

The motion tiles play small silent previews from `public/motion/` (768 px, 30 fps, about 0.5 MB each), made from the gallery's full videos with `ffmpeg -i in.mp4 -an -vf fps=30,scale=768:-2 -c:v libx264 -crf 27 -preset slow -movflags +faststart out.mp4`; clicking one opens the full video, with sound, from AgentShot's bucket.

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
