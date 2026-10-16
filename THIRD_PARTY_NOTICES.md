# Third-party software shipped with Manul

Manul's own code is open source under the Apache License 2.0 ([LICENSE](LICENSE), [NOTICE](NOTICE)). The programs below ship with it and keep their own licences. The GPL ones run as separate programs
(Manul starts them; it doesn't link them): `ffmpeg`/`ffprobe`, and Manul's `manul-beats` and `manul-speakers`, which are
themselves GPL-3.0-or-later because they are built together with GPL code — their sources are in this repository
(`scripts/beats`, `scripts/ml`, `scripts/ffmpeg`) and the GPL text in [LICENSES/GPL-3.0.txt](LICENSES/GPL-3.0.txt).
On request we provide the exact sources of every GPL program we ship.

## FFmpeg 9.0.2 (ffmpeg, ffprobe)

Manul runs FFmpeg as separate programs; it does not link against it.

- **Licence:** GNU General Public License v3 (this build is configured with `--enable-gpl --enable-version3` and
  includes libx264, libx265, libass, vid.stab, Rubber Band and others).
- **Builds:** static binaries built by `scripts/ffmpeg/build.sh` (Martin Riedl's build script,
  https://git.martin-riedl.de/ffmpeg/build-script, Apache-2.0, at a pinned commit, plus Manul's modules for the two
  libraries below), published as the repository's `ffmpeg-*` prereleases and pinned by SHA-256 in
  `scripts/fetch-ffmpeg.mjs`.
  Windows x64 uses Gyan Doshi's **9.0.2 essentials static GPLv3 build**, not the shared/full build:
  https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2.
  ZIP SHA-256: `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba`.
  Only `ffmpeg.exe` and `ffprobe.exe` are copied from its nested `bin/`; upstream `LICENSE` and `README.txt`
  ship as `bin/ffmpeg-LICENSE.txt` and `bin/ffmpeg-README.txt` (configuration and external-library versions).
- **Source:** https://ffmpeg.org/download.html (release 9.0.2). Each library's version is pinned in the build script's
  `version/` folder and downloaded from its project. On request we will also provide the exact sources for the binaries we ship.
  The Windows release identifies FFmpeg source commit https://github.com/FFmpeg/FFmpeg/commit/946fcce07b;
  build information: https://www.gyan.dev/ffmpeg/builds/. Preserve the exact corresponding sources, library
  sources and build configuration before publishing; a generic FFmpeg source link alone is not sufficient.
- **vid.stab 1.1.2** (libvidstab, camera shake detection and stabilisation): GPL-2.0-or-later,
  https://github.com/georgmartius/vid.stab.
- **Rubber Band 4.0.0** (librubberband, time-stretching and pitch-shifting): GPL-2.0-or-later,
  https://breakfastquay.com/rubberband/.

## aubio (manul-beats)

GPL-3.0-or-later, https://aubio.org, https://github.com/aubio/aubio (master at a pinned commit, see
`scripts/build-beats.sh`). Its sources are compiled with Manul's small CLI (`scripts/beats/manul-beats.c`, under the same
licence) into the separate `manul-beats` program, which Manul runs to find tempo, beats and onsets in music.

## sherpa-onnx 1.13.8 and ONNX Runtime 1.28.2 (manul-speakers, manul-vision)

`scripts/build-ml.sh` links Manul's two small runners (`scripts/ml/*.c`) against sherpa-onnx's static release
libraries (pinned by SHA-256), which include: sherpa-onnx (Apache-2.0, https://github.com/k2-fsa/sherpa-onnx),
ONNX Runtime (MIT, https://github.com/microsoft/onnxruntime), kaldi-native-fbank (Apache-2.0), kissfft (BSD-3-Clause),
OpenFst/kaldifst (Apache-2.0), SentencePiece (Apache-2.0), piper-phonemize (MIT), espeak-ng (GPL-3.0-or-later) and
ucd-tools (GPL-3.0-or-later).

## Models (resources/models, fetched by scripts/fetch-models.mjs, pinned by SHA-256)

- **pyannote segmentation 3.0** (speaker-segmentation.onnx): MIT, Copyright (c) 2022 CNRS,
  https://huggingface.co/pyannote/segmentation-3.0, as converted to ONNX by sherpa-onnx.
- **3D-Speaker CAM++ zh/en** (speaker-embedding.onnx): Apache-2.0, https://github.com/modelscope/3D-Speaker.
- **YuNet 2023mar** (faces-yunet.onnx): MIT, Copyright (c) 2020 Shiqi Yu, https://github.com/opencv/opencv_zoo.
- **YOLOX-Tiny** (objects-yolox-tiny.onnx): Apache-2.0, Megvii, https://github.com/Megvii-BaseDetection/YOLOX.

## whisper.cpp v1.9.4 (whisper-cli)

MIT licence, https://github.com/ggml-org/whisper.cpp. Built by `scripts/build-whisper.mjs`, preserving
`scripts/build-whisper.sh` on Unix (Metal embedded on macOS). Windows x64 uses MSVC static CRT, CPU-only SSE2
baseline and no OpenMP; upstream licence ships as `bin/whisper-LICENSE.txt`.
The Windows CMake wrapper embeds a Manul-owned `activeCodePage=UTF-8` manifest for Windows 10
1903/build 18362 or newer. Upstream v1.9.4 sources are not patched; narrow CLI/input/output paths use the
same UTF-8 encoding as upstream's model loader. Manifest: `scripts/windows-whisper/whisper-cli.manifest`.
The model (ggml-base, MIT, from huggingface.co/ggerganov/whisper.cpp) is downloaded on first use, SHA-256 checked.

## BrowserSkill 0.3.2 (bsk CLI, its Chrome extension, its agent skill)

MIT licence, Copyright (c) 2026 Tencent, https://github.com/Tencent/BrowserSkill. Release binaries and the extension
package are pinned by SHA-256 in `scripts/fetch-bsk.mjs`; the agent skill (`skills/browser-skill`) is copied from the
same release with only its description changed. Manul runs the extension unmodified inside its own browser.
Windows CLI: `bsk-v0.3.2-x86_64-pc-windows-msvc.zip` from the `cli-v0.3.2` release, containing `bsk.exe`.
ZIP SHA-256: `b773c443275b8581af29b314baa799e1ec599464379998edcf1dbc7eb07a7eab`.

## Microsoft Visual C++ runtime (Windows only)

`bin/vcruntime140.dll` is the x64 Visual Studio 2022 redistributable required by the pinned BrowserSkill
MSVC binary. Copyright Microsoft Corporation; distributed under the Visual Studio licence's
redistributable-code terms, not the GPL or MIT licence. Copied from the build toolchain's
`VC/Redist/MSVC/<version>/x64/Microsoft.VC143.CRT`, with its Microsoft signature checked in CI.
Version follows the selected VS2022 toolchain; it is not an upstream ZIP pin.
Redistribution list: https://learn.microsoft.com/en-us/visualstudio/releases/2022/redistribution.
Licence: https://visualstudio.microsoft.com/license-terms/.
Review the applicable toolchain terms before a public Windows release.

## Inter 4.1 (font)

SIL Open Font License 1.1, https://github.com/rsms/inter. Used for clip typography (woff2, via @fontsource-variable/inter)
and for burned-in captions (`Inter-Regular.ttf`, `Inter-Bold.ttf` from the v4.1 release; licence in `lib/fonts/Inter-LICENSE.txt`).

## Source Serif 4 (font)

SIL Open Font License 1.1, https://github.com/adobe-fonts/source-serif. Used for the app's headings and the agent's replies
(woff2, via @fontsource-variable/source-serif-4).

## Three.js (the animated Manul companion)

MIT licence, Copyright © 2010–2026 three.js authors, https://github.com/mrdoob/three.js.
Bundled into the renderer for the original procedural Pallas's cat; licence text in
[LICENSES/three-MIT.txt](LICENSES/three-MIT.txt).

## Driver.js (the first-run product walkthrough)

MIT licence, Copyright (c) Kamran Ahmed, https://driverjs.com, https://github.com/nilbuild/driver.js.
Bundled into the renderer for spotlight positioning and walkthrough navigation, with Manul's own visual theme;
licence text in [LICENSES/driver-MIT.txt](LICENSES/driver-MIT.txt).

## The phone companion app's pairing and encryption

- **@noble/ciphers 2.4.0** (XChaCha20-Poly1305 between the phone and the Mac): MIT, Copyright (c) 2022 Paul Miller,
  https://github.com/paulmillr/noble-ciphers. An npm package in the app.
- **node-qrcode 1.5.4** (the pairing QR code in Settings → Phone): MIT, Copyright (c) 2012 Ryan Day,
  https://github.com/soldair/node-qrcode. Bundled into the renderer.

## Unpacking the files users add (npm package in the app)

- **yauzl 3.4.0** (unpacking .zip files): MIT, Copyright (c) 2014 Josh Wolfe, https://github.com/thejoshwolfe/yauzl;
  with pend (MIT).

## GCC-PHAT audio synchronization reference

The frequency-domain GCC-PHAT formulation in `src/main/sync.ts` is adapted into TypeScript from
[xiongyihui/tdoa](https://github.com/xiongyihui/tdoa/blob/master/gcc_phat.py), Apache-2.0,
Copyright (c) 2017 Yihui Xiong. Manul adds normalized-envelope matching, independent anchors,
robust clock-drift fitting and confidence checks. The [syncstart](https://github.com/rpuntaie/syncstart)
project (MIT) was also consulted for its FFmpeg extraction/correlation approach; no syncstart code is bundled.

## Tools downloaded on demand

Downloaded only after the user agrees, into Manul's own folder: uv (Apache-2.0/MIT), faster-whisper (MIT),
Whisper models (MIT).
