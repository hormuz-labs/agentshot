// Making a video from an idea on the phone: describe it, pick a format, and the desktop agent builds a motion clip
// that the phone can play and keep.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('starts from an idea and gets a rendered motion video', (
    tester,
  ) async {
    await launchPaired(tester);

    await tester.tap(find.text('Start from an idea'));
    await waitFor(tester, find.text('Describe your video…'));
    await tester.enterText(
      find.byType(TextField).last,
      'Mobile e2e motion title card',
    );
    await tester.tap(find.text('Save'));
    await waitFor(tester, find.text('Choose a format'));
    await tester.tap(find.text('9:16'));

    // The new project opens on the conversation; the agent makes the clip and puts it in the film.
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 5),
    );
    expect(find.text('create_clip'), findsOneWidget);
    expect(find.text('insert_clip'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'Film'));
    await waitFor(tester, find.text('A new cut is ready'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'After'));
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Keep'));
    await waitFor(tester, find.text('Opening title added'));

    await tester.pageBack();
    await waitFor(tester, find.text('What are we making?'));
    await reveal(tester, find.text('On your computer'));
    await reveal(tester, find.text('Mobile e2e motion title card'));
  });
}
