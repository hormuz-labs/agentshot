# Releasing Manul

Merge to `main` and CI does the rest. `.github/workflows/tag.yml` tags the next version, a patch release unless the merged
pull request is labelled `release:minor` or `release:major` (or `release:skip` to merge without releasing), and the
release notes are generated from the pull requests merged since the last release. To release by hand, push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Either way, `.github/workflows/release.yml` then:
1. builds on four runners (macOS arm64 + Intel, Linux x64 + arm64): bundled whisper.cpp, pinned ffmpeg, tests;
2. packages, **signs and notarizes** the Mac app (when the Apple secrets exist); then one job merges the two Mac update feeds and publishes `.dmg`, `.zip`,
   `.deb`, AppImage and the `latest*.yml` update files to **GitHub Releases** — this is what installed apps update from;
3. rebuilds and signs the **apt repository** and uploads it (when `APT_BUCKET` is set).

Skills ship inside the app (`resources/skills`) and update with it: a skill change reaches users in the next release,
together with the tools it relies on.

## One-time setup (owner)

| What | Where | Why |
|---|---|---|
| The `hormuz-labs/manul` repository | GitHub | code, releases (the update feed) |
| Apple Developer Program ($99/yr) | developer.apple.com | signing + notarization; Homebrew drops casks Gatekeeper blocks |
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | repo secrets | "Developer ID Application" certificate (.p12, base64) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | repo secrets | notarization |
| `hormuz-labs/homebrew-tap` repository | GitHub | `brew install hormuz-labs/tap/manul`. Its own workflow checks Manul's releases hourly and rewrites the cask with `scripts/homebrew-cask.mjs` from the release tag, so no token is shared ("Run workflow" there to update at once) |
| A file host for the apt repository (e.g. Cloudflare R2) | — | `.deb` files are ~150–200 MB; GitHub Pages and git refuse files over 100 MB |
| `APT_BUCKET`, `APT_ENDPOINT`, `APT_GPG_KEY_ID` (variables); `APT_ACCESS_KEY_ID`, `APT_SECRET_ACCESS_KEY`, `APT_GPG_PRIVATE_KEY` (secrets) | repo settings | upload + signing of the apt repository |
| A domain for the apt repository (`apt.manul.si`, an R2 custom domain on Cloudflare) | DNS | the line users add to their sources |

Without the Apple secrets, releases still build but the Mac app is unsigned: the cask clears the quarantine flag for Homebrew users, and anyone downloading the .dmg directly must right-click → Open.

## Installing

```bash
brew install hormuz-labs/tap/manul
```

```bash
curl -fsSL https://apt.manul.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.manul.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul
```

## Checks before tagging

```bash
npm run typecheck && npm test
npm run test:e2e
npm run package:dir && node test/e2e/packaged.e2e.mjs
```
