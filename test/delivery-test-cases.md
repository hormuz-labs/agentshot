# Caption exports, file delivery and sidebar regression cases

Run unit/integration checks with `npm test -- --maxWorkers=2` and `npm run typecheck`.
Run the focused Electron checks with `npm run test:delivery` (builds first).
Electron delivery tests use temporary profiles and fixtures: no paid model requests or real Large-v3 download.

## Optional Whisper Large-v3

- Opening Export and choosing captions does not download a model.
- The optional 3.1 GB download button is below None / In the picture / Separate .srt.
- Keyboard-accessible tooltips explain accuracy, memory/time costs and avoiding duplicate captions.
- Installation requires the model file, not merely an install stamp.
- The install plan contains only Large-v3, without Python/Base dependencies.
- Downloading disables duplicate installation and caption exports; exports with None remain available.
- Download failures show a cleaned error; retry clears it; success shows installed status.
- Reopening Export reflects installed status without offering another download.
- Absent or removed Large-v3 falls back to the normal transcript without fetching anything.
- Large-v3 exports use their separate cache; Base output is never reused as Large-v3 output.
- Corrupt caches are rebuilt; no-audio caches are reused.
- Concurrent transcriptions and installations share the same work.
- Custom editing-engine settings and Base transcript contents remain unchanged.
- Actual cached Large-v3 `.srt` exports contain Large-v3 wording, not Base wording.
- Burned-caption exports produce MP4 without an `.srt` sidecar.
- Caption-free exports do not read or rebuild even a corrupt Large-v3 cache.
- After removing the upgrade, caption exports use Base wording again.
- Failed HTTP/bodyless, checksum-mismatched and interrupted downloads never publish a model or leave `.part` files.
- Streaming download progress and failed-job status are reported; retry starts fresh.
- Already-installed models do not fetch again; status is listed separately from Base.

Coverage: `test/whisper-export.test.ts`, `test/e2e/delivery.e2e.mjs`.

## Generated files and chat cards

- Relative, absolute project paths, file URLs, angle-bracket paths, spaces and Unicode names normalize correctly.
- Repeated image/link/backtick references create only one card.
- Backtick references create cards only for known project files; incomplete streaming links do not.
- Unknown project context does not create file cards.
- External HTTP(S) links remain external; raw HTML is escaped and unsafe URL schemes are not linked.
- Traversal, encoded traversal, hidden paths, empty segments, control characters, backslashes and malformed encodings are rejected.
- The main process rejects directories, missing files, outside-project paths and escaping/hidden-target symlinks.
- Symlinks to visible files inside the project and absolute in-project files work.
- Images load through the media protocol; failed previews hide without hiding the file card.
- Documents render download/reveal controls without broken image previews.
- Native save-copy downloads preserve bytes; cancellation is not an error; saving onto the original preserves it.
- Duplicate downloads are disabled while the save dialog is pending.
- Failed download/reveal actions show errors; successful download retry clears the error and shows Saved.
- Chat and sidebar download/reveal controls do not attach files.
- All six output roots discover nested deliverables while hiding scripts, hidden folders, partial downloads and model binaries.
- Refresh removes stale outputs and old internal thumbnail entries without replacing imported metadata.

Coverage: `test/artifacts.test.ts`, `test/chat-markdown.test.ts`, `test/e2e/delivery.e2e.mjs`.

## Sidebar folders and project order

- Folders appear before files at every depth; only basenames appear in nested rows.
- Collapsing a directory hides its descendants, not sibling folders or similarly prefixed paths.
- Full paths distinguish identically named folders in different output roots.
- Empty trees, duplicate files and stale collapsed paths are handled without mutating input.
- Folder clicks and ArrowLeft/ArrowRight navigate without changing attachments.
- A collapsed child's state survives closing/reopening its parent.
- Folder paperclips attach descendants without expanding; individual files still toggle attachment.
- Collapse state survives renderer reload, project switches and app relaunch, without leaking into another project.
- Imported-file deletion, protected video deletion and folder deletion remain functional.
- Projects sort newest-created first, including open projects missing from the recent list.
- Switching/opening/renaming an older project never promotes it or shuffles the sidebar.
- Equal creation dates use a deterministic path tie-breaker; unknown/invalid dates stay at the end.
- Legacy recent records recover creation dates from `project.json`, not changing opened timestamps.
- Deleted projects are removed; one corrupt legacy record does not hide other projects.

Coverage: `test/files.test.ts`, `test/project-order.test.ts`, `test/e2e/files.e2e.mjs`, `test/e2e/tabs.e2e.mjs`.

## Sol provider compatibility

- Default reasoning and explicit off map to supported high for both Sol and dated Sol IDs.
- Explicit low, medium and high efforts remain unchanged in requests to a local test endpoint.
- Existing key storage, custom auth headers, model listing and endpoint tests remain enabled.

Coverage: `test/providers.test.ts`.

## New-project model dropdown

- The model dropdown is inside the new-project chatbox, beside the Start arrow.
- Available custom-provider models appear before a project exists; search matches names and provider labels.
- Empty search results are explained; choosing a model clears search and marks the selected model.
- Choosing a model does not open or create a project; automatic clears the explicit selection.
- Footage, motion and walkthrough projects persist the chosen model before their first request is sent.
- The saved selection survives loading the project; startup without a selection uses the existing automatic fallback.
- Existing projects retain their model picker; no-key drafts explain how to add keys.

Coverage: `test/projects.test.ts`, `test/e2e/start.e2e.mjs`, existing `test/models.test.ts`.

## Manual checks not simulated by these tests

- Download the actual Large-v3 model, verify successful checksum installation and run fresh transcription on speech.
- Compare Base vs Large-v3 wording for representative accents/languages and confirm acceptable memory/runtime.
- Visually check actual burned-caption content and readability on long portrait/landscape videos.
- Verify native save/reveal dialogs and keyboard navigation on other supported operating systems.
- Confirm generated outputs refresh after both a real successful agent run and an agent run that errors.
- Confirm the updated product-tour wording and that packaged installers do not contain the optional model.
