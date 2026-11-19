# Reusing sound across visual edits

Piece rendering already reuses encoded video sections. It now also retains the complete AAC audio track under `audio-<key>.m4a` in the same 8 GB render cache. A visual-only edit (framing, dimensions, overlay, camera layout) reuses unchanged audio instead of decoding and encoding the entire timeline again.

The key is derived from the actual sound-only FFmpeg command and each input's path, device/inode, size and nanosecond modification/change timestamps. This includes cuts, ordering, durations, mute/volume, audio availability, and camera audio synchronization. Audio is published from a unique temporary file only after successful encoding and an input revision recheck. Interrupted encodes remove the temporary track. Used sound tracks have their eviction timestamp refreshed and share the existing cache budget with video pieces.

This does not make the first full-film audio encode faster. Cuts and changes to sound still rebuild the continuous audio graph, preserving existing fades and synchronization. Music/voiceover mixing outside the piece-rendering path is unchanged. Final concatenation/muxing still writes the full output file. Concurrent identical cold renders may encode duplicate sound tracks; there is no shared cancellation lifecycle.

Verify with `npm test -- test/pieces.test.ts` and `npm run typecheck`. Real FFmpeg tests check unchanged audio file identity on replay and visual-only edits, new audio keys after trims, output duration/decoding, and camera/layout/sync key behavior. Backend changes require a desktop restart.
