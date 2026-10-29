// Exporting the film from the phone: the export sheet can be closed without exporting; its format, fit and captions
// choices; then the desktop renders, the phone downloads the film and opens the share sheet (the runner closes it).
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('exports the film in a chosen format and shares it', (
    tester,
  ) async {
    await launchPaired(tester);
    await openProject(tester);
    // Export is in the project's ⋯ menu
    Future<void> export() async {
      await tester.tap(find.byTooltip('Project actions'));
      await settle(tester);
      await tester.tap(find.text('Export film'));
    }

    // changed my mind: closing the sheet exports nothing
    await export();
    await waitFor(tester, find.text('Export your film'));
    await closeSheet(tester);
    expect(find.text('Rendering on your desktop…'), findsNothing);

    Future<void> choose(String now, String pick) async {
      await press(tester, find.text(now));
      await tester.tap(find.text(pick).last);
      await settle(tester);
      expect(find.text(pick), findsOneWidget);
    }

    await export();
    await waitFor(tester, find.text('Export your film'));
    await choose('Original', '9:16 · Shorts, Reels, TikTok');
    await choose('Fit the whole frame', 'Fill the frame');
    await choose('No captions', 'Separate SRT file');
    await choose('Separate SRT file', 'No captions');
    await press(tester, find.text('Render and download'));
    // rendered on the desktop, downloaded, then the share sheet over the app
    cue('back');
    // done: the render and download lines under the header are gone
    bool working() =>
        find.textContaining('Rendering').evaluate().isNotEmpty ||
        find.textContaining('Downloading').evaluate().isNotEmpty;
    final end = DateTime.now().add(const Duration(minutes: 3));
    while (working() && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(seconds: 1));
    }
    expect(working(), isFalse);
    expect(find.byType(SnackBar), findsNothing); // no error
  });
}
