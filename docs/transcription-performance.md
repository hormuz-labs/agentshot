# Resumable, GPU-first transcription

## Shared checkpoints

Full indexing and bounded `transcript` requests share 60-second source-clock chunks in `.cache/transcript-chunks/`. Each chunk decodes only its source interval plus two seconds of context at each edge. Words belong to the chunk containing their midpoint. Equal words with overlapping timestamps at a seam are deduplicated when joining independently aligned chunks. Requests for the same chunk share one job; an interrupted job retains every completed atomic checkpoint and resumes missing chunks after restart.

Cache identities include the source path, device/inode, size, nanosecond modification/change timestamps, engine/model/runtime revisions, and recognition settings. Finished transcripts obey these rules too; old or corrupt caches are rebuilt. Input and native-model changes during inference fail before the checkpoint is published. Full transcript names include a media-path hash to distinguish equal basenames in different folders.

Bounded results retain source-file timestamps and are labelled as excerpts. They are never registered as complete project transcripts. The agent prewarms selected ranges, or a short interval around the playhead. Unbounded search still requires full coverage. The chunk cache is currently not size-limited; completed entries are small JSON files, and temporary WAV files are removed after inference.

## Scheduling and editing

- Interactive requests take priority over background indexing. A requested chunk already queued in the background is promoted.
- Background work yields between chunks while a render runs. Dependencies requested by a render remain eligible, avoiding a render/transcript deadlock.
- There are two work slots on machines with at least eight logical CPUs, otherwise one. Native and Python automatic inference share one accelerator slot to bound simultaneous model memory. Explicit CPU work can use both slots; each defaults to four threads.
- Shutdown cancels subprocesses and pending work while retaining completed checkpoints. Settings changes apply to new requests.
- Cuts, reordered media, and muted items can reuse source transcripts when captured source/output revisions still match. Camera compositions, added music/voiceovers, and missing provenance require listening to the actual rendered audio.
- Preview speech/ducking queries read completed caches without starting a whole-file transcription. Unchanged render audio is also reused; see [render-audio-cache.md](render-audio-cache.md).

## GPU first, CPU fallback

Automatic engine selection prefers the bundled native engine when its model is available. Custom engine choices are respected. **CPU only** skips accelerated attempts.

| Platform | Automatic native order |
| --- | --- |
| macOS | Embedded Metal, then CPU |
| Windows / Linux | Optional CUDA sibling, Vulkan sibling, then baseline executable / CPU |

Vulkan supports compatible NVIDIA, AMD, and Intel GPUs. Availability is decided by loading the actual model, not merely finding a GPU name. A failed accelerated attempt retries another backend, then CPU; failed backends are remembered for that binary/model until restart. GPU siblings that quietly use CPU are rejected so another GPU backend gets a chance. The CPU executable remains independent of Vulkan/CUDA loader libraries.

Release and CI builds add `whisper-cli-vulkan` on Windows/Linux via `npm run build:whisper:gpu`; macOS embeds Metal in the baseline build. Developers with a CUDA SDK can build an additional sibling using `npm run build:whisper:gpu -- --backend=cuda`. Native libraries are static except platform/runtime libraries and the system Vulkan loader. Windows also checks the UTF-8 manifest and imported DLLs.

The optional Python engine tries CTranslate2 CUDA first, then int8 CPU. It retries deferred inference failures, and the parent retries on CPU if missing CUDA runtime libraries terminate Python. AMD/Intel/Apple acceleration uses the native engine. Python's beam-1 and silence-skipping settings are opt-in: they changed wording and fillers in the fixture evaluation.

## Measurements and validation

Measured on 2026-11-19, Ryzen 9 3900X (24 logical CPUs), Radeon RX 5500 XT, Mesa Vulkan, Base model:

- A 25.689-second narration/music fixture took **2.72 s on Vulkan vs 5.13 s on native CPU** in the initial inference comparison (about 1.9×). The portable release executable subsequently completed real Vulkan inference and the baseline completed CPU inference. Later timings overlapped builds/tests and are not comparable throughput measurements.
- The complete packaged automatic path recognized 51 words in 3.67 s, with cached replay in 0.013 s. With Vulkan drivers hidden, it rejected the unavailable GPU and completed the CPU retry in 5.57 s. These are single runs, including extraction and checkpoint I/O.
- Python CPU Base/beam-5 matched 0.931 of reference words by the benchmark's sequence-match metric, versus 0.909 at beam-1 and 0.911 with VAD. This is one fixture, not a general accuracy score. Defaults retain beam-5 with VAD off.
- Seeding the first 120 seconds of a 10,807-second source saved two checkpoints in 39.08 s; replay took 0.057 s. That interval contained almost no speech and is not representative throughput.
- The full-source run exposed a repeated-DTW-anchor bug near minute 35. The fix keeps snapped timestamps monotonic, with regression coverage. The interrupted process retained 36 checkpoints for the resumed run.
- A fixture shifted across the 60-second boundary exposed an overlapping repeated word, now deduplicated at assembly. Long leading silence also changed recognized opening words; context padding does not guarantee identical wording to single-pass inference.

Only AMD Vulkan and Linux CPU/Python inference have been hardware-verified here. NVIDIA CUDA, Intel Vulkan, Windows GPU execution, and Apple Metal need their respective hardware validation.

Useful checks:

```sh
npm test
npm run typecheck
npm run test:packaging
node scripts/run-headless.mjs node test/e2e/tools.e2e.mjs
node scripts/run-headless.mjs node test/e2e/export.e2e.mjs
node scripts/run-headless.mjs node test/e2e/delivery.e2e.mjs
```

`scripts/bench-transcription.py` compares Python settings with reference words. `test/speech-real.test.ts` is opt-in: set `MANUL_SPEECH_FILE`, `MANUL_SPEECH_BINARY`, `MANUL_SPEECH_MODEL`, and an isolated `MANUL_SPEECH_CACHE`; run once with `MANUL_SPEECH_PHASE=seed`, then in another process with `MANUL_SPEECH_PHASE=resume`. It checks that existing checkpoint bytes are retained and cached excerpt replay agrees with the completed transcript. Production desktop changes require rebuilding and restarting the app.
