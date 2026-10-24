# Releasing AgentShot

Merge to `main` and CI does the rest. `.github/workflows/tag.yml` tags the next version, a patch release unless the merged
pull request is labelled `release:minor` or `release:major` (or `release:skip` to merge without releasing), and the
release notes are generated from the pull requests merged since the last release. Windows support is configured, but has not
yet been validated on a native runner or published; missing Windows signing configuration intentionally blocks the entire
public release (there is no unsigned Windows fallback). To release by hand, push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Either way, `.github/workflows/release.yml` then:
1. builds on five native runners (macOS arm64 + Intel, Linux x64 + arm64, Windows x64): bundled whisper.cpp, pinned ffmpeg, packaging tests, typecheck and runtime unit tests; Windows also runs selected runtime E2E and the native whisper Unicode-path regression;
2. packages, **signs and notarizes** the Mac app, then checks every bundled binary's Developer ID signature, the stapled ticket and Gatekeeper's verdict (`scripts/check-mac-signature.sh`); then one job merges the two Mac update feeds and publishes `.dmg`, `.zip`,
   `.deb`, AppImage, signed Windows NSIS `.exe`, blockmaps and the `latest*.yml` update files to **GitHub Releases** — this is what installed apps update from;
3. rebuilds and signs the **apt repository** and pushes its small metadata files to the `apt` branch (when `APT_GPG_KEY_ID` is set). Cloudflare Pages serves that branch; `.deb` downloads redirect to GitHub Releases.

Skills ship inside the app (`resources/skills`) and update with it: a skill change reaches users in the next release,
together with the tools it relies on.

## One-time setup (owner)

| What | Where | Why |
|---|---|---|
| The `hormuz-labs/agentshot` repository | GitHub | code, releases (the update feed) |
| Apple Developer Program ($99/yr) | developer.apple.com | signing + notarization; Homebrew drops casks Gatekeeper blocks |
| `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD` | repo secrets | "Developer ID Application" certificate (.p12, base64) and its export password |
| `APPLE_API_KEY_P8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` | repo secrets | notarization with an App Store Connect API key (Users and Access → Integrations → Team Keys, role Developer): the .p8 file's contents, its key ID and the issuer ID. Preferred: no Apple ID password, no 2FA |
| or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | repo secrets | notarization with an Apple ID and an app-specific password from account.apple.com |
| `WINDOWS_CERT_P12_BASE64`, `WINDOWS_CERT_PASSWORD` | repo secrets | Windows Authenticode certificate (.p12/.pfx, base64) and password, passed as `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` |
| `WINDOWS_PUBLISHER_NAME` | repo variable | Exact certificate publisher common name, case-sensitive. Injected into `win.signtoolOptions.publisherName` and the packaged updater configuration; do not guess it from the product or company name |
| `hormuz-labs/homebrew-tap` repository | GitHub | `brew install hormuz-labs/tap/manul`. Its own workflow checks Manul's releases hourly and rewrites the cask with `scripts/homebrew-cask.mjs` from the release tag, so no token is shared ("Run workflow" there to update at once) |
| Cloudflare Pages project tracking the `apt` branch | Cloudflare | Only package lists, signatures, public key and redirects are stored in git; large `.deb` files stay on GitHub Releases |
| `APT_GPG_KEY_ID` (variable), `APT_GPG_PRIVATE_KEY` (secret) | repo settings | apt metadata signing; no R2 bucket/access-key configuration is used by the current workflow |
| `apt.agentshot.si` custom domain on that Pages project | DNS | the line users add to their sources |

Mac releases are always signed and notarized: without the certificate and one set of notarization secrets the release fails before building, like Windows, and nothing unsigned is published. The Homebrew cask therefore leaves Gatekeeper alone (it no longer strips the quarantine flag).

### Getting the Mac certificate (once)

1. In Keychain Access → Certificate Assistant → **Request a Certificate From a Certificate Authority**, save the request to disk.
2. At developer.apple.com → Certificates → **+** → **Developer ID Application** (G2 Sub-CA), upload the request, download the `.cer` and double-click it. Only the Account Holder can create this one.
3. In Keychain Access → My Certificates, right-click **Developer ID Application: …** → Export as `.p12` with a strong password.
4. `base64 -i DeveloperID.p12 | gh secret set MAC_CERT_P12_BASE64 --repo hormuz-labs/agentshot`, and `gh secret set MAC_CERT_PASSWORD` with that password.
5. Create the App Store Connect API key, then `gh secret set APPLE_API_KEY_P8 < AuthKey_XXXX.p8`, `gh secret set APPLE_API_KEY_ID`, `gh secret set APPLE_API_ISSUER`.

Keep the `.p12` and `.p8` in a password manager; Apple shows the `.p8` only once.

## Windows packaging

Windows requires a **native x64 Windows runner** and Node >=22.19.0, not Linux cross-compilation:
electron-builder's `${platform}` macro selects host resources. `beforePack` rejects mismatched targets.
The **offline one-click NSIS installer** is per-user, cannot elevate or switch to per-machine, and has no
licence-acceptance or directory-selection wizard. Users open one `.exe`; it installs to their per-user
Programs directory, creates Desktop/Start menu shortcuts, and launches AgentShot. No repository setup,
package manager or developer prerequisites are required. `LICENSE` remains bundled, not an installer page.
The app and core tool executables are in the installer, not fetched by a web bootstrapper; speech models
and optional heavier tools are downloaded inside the app on request. App data survives uninstall.
Silent `/S` installs do not auto-launch; `/D=<path>` remains available for isolated CI installation.
Requires **Windows 10 version 1903 (build 18362) or newer / Windows 11 x64**.
Artifact: `AgentShot-${version}-windows-x64-Setup.exe`; updater feed: `latest.yml`, with its `.exe.blockmap`.

```powershell
npm ci
npm run build:whisper
npm run test:packaging
npm run package
node test/e2e/packaged.e2e.mjs
```

No signing secrets are needed for local/PR **test-only** builds. For optional local signing, provide all
three environment variables: `WIN_CSC_LINK` (base64 or certificate path), `WIN_CSC_KEY_PASSWORD`,
`WINDOWS_PUBLISHER_NAME`. Partial signing configuration is an error. Public CI sets
`MANUL_PUBLIC_RELEASE=1`, requires those values before downloading/building, and forces code signing.
The release lane verifies valid, timestamped Authenticode signatures on both app and installer, checks
the exact signer against `WINDOWS_PUBLISHER_NAME`, and confirms the updater embeds that exact name.
Do not disable `verifyUpdateCodeSignature` or use an empty publisher list to unblock a release.
If the certificate requires hardware-backed/cloud signing rather than an exportable PFX, configure and
validate that signing provider before releasing; that alternative is not implemented here.

CI builds whisper.cpp v1.9.4 using CMake/Visual Studio 2022 x64, `/MT`, no OpenMP or dynamic GGML backends,
and an explicit SSE2 baseline. A Manul-owned CMake wrapper adds an **embedded UTF-8 activeCodePage
manifest**, leaving the pinned upstream checkout unchanged. Windows 10 1903/build 18362 is the first
version honoring this process code page. This makes MSVC's narrow CLI arguments, input file checks,
audio decoding and JSON/TXT/SRT file writes consistent with upstream's UTF-8-to-wide model loading,
including non-ASCII user profiles. It does not require the system-wide UTF-8 locale setting.
`build:whisper` and the dependency inspection verify PE manifest resource #1 with Windows SDK `mt.exe`;
the build identity invalidates pre-manifest cached whisper binaries.

The existing native Windows `test:packaging` CI step downloads only the pinned multilingual base model
(SHA-256 `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe`) into a temporary
Unicode/space/`[]` profile-like model directory, writes its installed metadata, and transcribes real fixture
speech with Unicode/`[]` input and JSON/TXT/SRT output paths. The JSON must echo the exact model path and
all three outputs must contain recognized speech. Local acceptance can supply the same checksummed model
with `MANUL_TEST_WHISPER_MODEL`, or run `node scripts/smoke-whisper-paths.mjs --download-model` explicitly.
This is a native CLI regression, not a claim that full app/profile acceptance is complete.

`check-windows-dependencies.ps1` uses MSVC `dumpbin` on all four bundled
executables, rejects unaccounted VC++/OpenMP/compiler runtime DLL imports, and fails on missing non-system DLLs.
The pinned BSK binary does import `VCRUNTIME140.dll`: `build:whisper` copies the VS2022 x64 redistributable
from `VCToolsRedistDir` or the installed Visual Studio redist directory into bundled `bin/`. CI verifies
its Microsoft signature and imports. Whisper itself may not import VC++/OpenMP DLLs. Never copy a
DLL from a developer's System32, and review Visual Studio's redistribution terms before public shipment.
This dependency inspection and a developer runner are not substitutes for a clean-PC test.

The Windows PR/release lanes run packaged E2E, then install silently into a temporary directory with spaces
using the one-click installer's `/D` override (last and unquoted), verify Desktop/Start menu shortcut targets,
verify the **installed** whisper UTF-8 manifest, run E2E against the **installed** app, and uninstall/check
HKCU registration and shortcut removal. `/S`
suppresses normal auto-launch so E2E owns the test process. This smoke is restricted to
disposable GitHub-hosted Windows runners and refuses an existing Manul installation. It uses the runner's
real, disposable user profile; changing `USERPROFILE` alone would not isolate NSIS registry/shortcuts.
Never run it against a developer profile. The workflow has not been exercised yet.

## Windows acceptance gates

- Native Windows PR lane green: fetch pins/layout, MSVC build, embedded UTF-8 manifest, real-model Unicode/`[]` transcription, dependency inspection, typecheck, packaging tests, runtime unit/E2E suites, packaged E2E, one-click install/uninstall smoke.
- Clean Windows 10 **1903/build 18362 or newer** / Windows 11 x64 VM with a non-ASCII account name, legacy system locale (system-wide UTF-8 option OFF), and no developer tools, Git Bash, FFmpeg, Python or VC++ Redistributable: open the offline installer as a standard user; verify no wizard/elevation, Desktop/Start menu shortcuts, automatic first launch/uninstall, DPAPI key storage, Unicode/space/`[]` paths and no leaked child processes after close. A current supported Windows release is recommended; the encoding floor alone is not full OS acceptance.
- Exercise import/proxy/thumbnail, motion clips, playback/audio, caption burn-in, bundled whisper transcription/model download, export, private BrowserSkill daemon/extension, PowerShell agent commands and optional Python tools. CPU-only whisper and no Windows ARM64/32-bit installer are intentional.
- Signed staging build trusted on a clean VM: inspect publisher and timestamp, verify both app and installer signatures and installer UX. SmartScreen reputation may still warn even with a valid signature; do not promise its absence.
- Two **signed** versions using a private/staging GitHub update feed: installed N discovers N+1 through `latest.yml`, downloads correct x64 installer, verifies publisher, applies update, restarts and preserves projects/settings. A tampered installer or a valid signature from a different publisher must be rejected. Feed existence or an update-check error alone is not update acceptance.
- Preserve corresponding source and third-party notices for the exact Gyan FFmpeg build (including library versions/configuration in the bundled `bin/ffmpeg-README.txt`) before public distribution.
- Manually update the external **agentshot.si** download/install/support pages only after acceptance. Its source is absent from this repository and was not updated here.

## Installing

```bash
brew install hormuz-labs/tap/manul
```

```bash
curl -fsSL https://apt.agentshot.si/manul.gpg | sudo gpg --batch --yes --dearmor -o /usr/share/keyrings/manul.gpg &&
echo "deb [signed-by=/usr/share/keyrings/manul.gpg] https://apt.agentshot.si stable main" | sudo tee /etc/apt/sources.list.d/manul.list &&
sudo apt update && sudo apt install manul
```

## Checks before tagging

```bash
npm run typecheck && npm test
npm run test:packaging
npm run test:e2e
npm run package:dir && node test/e2e/packaged.e2e.mjs
```
