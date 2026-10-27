# Timeline ranges in chat

Android and iOS share the player and composer. Run `flutter test test/range_notes_test.dart` for touch/mouse selection, cancellation, reverse drags, bounds, draft append, editable text, submission and failed-send retention under both platform themes.

Device acceptance (Android APK and iOS):

1. Open a film and drag across the range strip below the playback slider.
2. Verify Conversation opens with `From 1.250s to 3.500s: ` highlighted inline in the normal message box. Type the desired edit.
3. Return to Film and drag another range backwards. Verify another highlighted range is appended after the previous instruction, on a new line, with the caret at the end.
4. Type a different instruction. Edit timestamps or delete a range directly in chat; verify timeline highlights follow the text.
5. Disconnect the desktop and send. Verify the text remains after failure. Reconnect and retry.
6. Verify one request contains both instructions and their timestamps, and the resulting proposal applies both to their original positions.
7. Repeat in portrait/landscape with the keyboard open. Verify the composer scrolls and Send stays reachable.

Example:
```text
From 1.250s to 3.500s: Cut the pause
From 6.000s to 9.000s: Brighten this shot
```

Manual editing: in Film, tap a clip in the manual timeline for Trim, Split at playhead, Remove, and Move actions. Drag the trim slider handles or enter source seconds; hold a clip's grip and drag to reorder. Render preview to watch mobile edits. Undo remains available in Timeline & mix. Check that dismissing the sheet makes no edit and that failed edits keep it open for retry.
