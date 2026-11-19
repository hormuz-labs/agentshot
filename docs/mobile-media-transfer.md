# Phone video transfer and playback

## What crosses the network

An edit sends commands and project state; it does not upload the source footage again. Playback used to start a separate complete-film cache fill, including when opening a project or comparing before/after versions. On a large film that background transfer could compete with interactive playback.

The phone now reads and caches only the byte blocks its player requests. Explicit Save/Share still downloads a complete file to an export file, independently of the playback cache budget. Interrupted exports remove their partial file.

Network transport remains certificate-pinned HTTPS over the existing LAN or Headscale-managed Tailscale/WireGuard connection. Direct mesh connectivity is preferred; DERP carries encrypted traffic when direct connectivity is unavailable. The media **relay** here is a loopback HTTP server inside the phone, used by AVPlayer/ExoPlayer; it is not a new public relay service.

## Range protocol and bounds

- One player URL identifies one immutable descriptor: strong ETag, total size and content type. A metadata-only HEAD resolves it when the player opens or retries.
- The desktop advertises `x-agentshot-range-cache: 1`. The phone requests aligned **1 MiB** blocks with that header, an explicit bounded `Range`, and the exact descriptor's `If-Match`.
- The desktop accepts verified blocks up to **4 MiB**. It opens the file once, reads a bounded buffer, then checks the opened file's identity/timestamps before sending headers. In-place changes fail with 412. Atomic replacements cannot switch the opened handle to the replacement.
- ETags include a random process epoch, device/inode identity, size and nanosecond mtime/ctime. Restoring mtime after a same-size rewrite still invalidates the tag. Desktop restart conservatively creates new tags. These are local filesystem revisions, not content hashes or cross-machine deduplication keys.
- The phone validates status, ETag, Content-Range, Content-Length and actual body length before publishing a block. A mid-response version change closes the response; old and new render bytes cannot be spliced together. Retry preview obtains the new descriptor.
- At most **two** block/metadata operations run at once, with **32** queued operations and **16** admitted player responses, including duplicate waiters. Concurrent reads of the same block share its completed disk entry. A cancelled reader does not cancel another reader's transfer.
- One continuous output stream propagates socket backpressure and cancellation. There is no speculative whole-file download. A player requesting the whole file and continuing to consume it can still transfer the whole file. Native players also buffer ahead; cancellation can leave an in-flight block and socket-buffered data.
- Blocks and metadata share the existing **2 GiB** disk budget with pictures. Least-recently-used entries are evicted; no file-sized bitmap or full-file RAM buffer is allocated. Cache clearing invalidates in-flight writes. Incomplete/orphaned files are removed at restart. Cached blocks can play offline; missing blocks require the computer. An explicit metadata authorization failure does not use the offline fallback.
- Older desktops continue serving ordinary player ranges without fragment caching or automatic whole-film fills.

### Why 1 MiB

A 1 MiB block takes about 84 ms of payload time at 100 Mbit/s, or 839 ms at 10 Mbit/s, plus latency. A 4 MiB block would quadruple cold tiny-seek overfetch and first-block delay. A 256 KiB block would reduce that delay but require four times as many requests/index entries for sustained playback. One MiB is a starting compromise, with two readers allowing before/after playback without unbounded parallel downloads.

A small timeline edit can produce a completely different compressed movie. Byte blocks are reused within a revision; this protocol does not claim byte-delta reuse across re-encoded renders. Existing proxy quality/bitrate still determines sustained bandwidth needs. Source upload resumption and desktop–worker project synchronization are separate paths.

## Repeatable benchmark

```sh
FLUTTER=/path/to/flutter/bin/flutter node scripts/bench-mobile-media.mjs
```

Requires Node 22+, installed project dependencies and Flutter. Writes `out/media-benchmark.json`; `BENCH_OUTPUT` overrides the output path (relative to `mobile/`). The script creates and removes a **20 GiB sparse file**, starts the production desktop media handler behind a TLS bandwidth/latency shaper, and runs the production phone client/cache. No 20 GiB allocation or full transfer is needed.

Each profile runs three times with a fresh cache:

1. Cold preview: first 256 KiB and last 64 KiB, including descriptor lookup.
2. Warm replay of the same ranges.
3. Three 128 KiB seeks at 3, 9 and 17 GiB.
4. Same-size source revision change, then first 256 KiB with a fresh URL.
5. Open-ended playback cancelled after the first local chunk. Samples again after a settling interval and checks that transfer stopped within 3 MiB.

### Measured on Linux, Dart 3.11.0 — 2026-11-19

Median elapsed time over three runs. Payload bytes exclude HTTP/TLS/mesh overhead. Shaping adds the listed delay per request and caps each response's payload rate; it does not emulate loss, congestion or DERP. The file is synthetic bytes, so timings measure transfer rather than video decode or time to first frame.

| Scenario | Payload | GET / HEAD | 100 Mbit/s, 5 ms | 10 Mbit/s, 80 ms |
| --- | ---: | ---: | ---: | ---: |
| Cold preview | 2 MiB | 2 / 1 | 222 ms | 1,945 ms |
| Warm preview | 0 | 0 / 0 | 9 ms | 9 ms |
| Three seeks | 3 MiB | 3 / 0 | 302 ms | 2,786 ms |
| Changed revision preview | 1 MiB | 1 / 1 | 111 ms | 1,014 ms |
| Cancel open-ended | 2 MiB | 2 / 0 | stopped | stopped |

The cold preview transfers **0.0098% of a 20 GiB file**, versus the previous additional 20 GiB background fill if allowed to finish (99.9902% less payload than that fill). A full 20 GiB transfer has a theoretical payload-only minimum of about 28.6 minutes at 100 Mbit/s or 4.77 hours at 10 Mbit/s; those are calculations, not full-transfer benchmark runs. Warm replay transfers no media bytes. Cancellation elapsed times in the JSON include the fixed 2.25-second settling observation and are not cancellation latency measurements. RSS is the entire Flutter test process, not isolated cache memory.

## Verification

Local validation for this change: 930 desktop tests passed (34 skipped), all 135 tracked Flutter tests passed, Flutter analysis and the Android debug build passed. Android emulator film (phone and wide layouts), editing and export integration tests passed against the real desktop. iOS and physical-device/network checks were not run locally.

```sh
npx vitest run test/mobile-bridge.test.ts
cd mobile
flutter test test/media_cache_test.dart test/media_relay_test.dart
flutter analyze
```

Coverage includes large offsets, suffix/invalid ranges, concurrent overlap, bounded admission, eviction, real client/cache restart, offline cached reads, authorization errors, revision changes between and within responses, same-size rewrites, atomic replacement, truncated bodies, cancellation, clear/write races, legacy desktops and complete exports exceeding the cache budget.

Native-player checks use the existing Android integration harness:

```sh
FLUTTER=/path/to/flutter/bin/flutter MOBILE_E2E_ONLY=film,editing,export npm run test:e2e:mobile
```

For physical hour-long footage, measure time to first frame, sustained playback and seeks on both AVPlayer and ExoPlayer over actual LAN/direct-mesh/DERP paths. The synthetic benchmark supplies a repeatable transfer baseline; it does not measure those platform/network combinations.
