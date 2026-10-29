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

    await start(tester, 'Describe it');
    await waitFor(tester, find.text('Describe your video…'));
    await describe(tester, 'Mobile e2e motion title card', format: '9:16');

    // The new project opens on the conversation; the agent makes the clip and puts it in the film.
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 5),
    );
    expect(
      find.text('create_clip'),
      findsNothing,
    ); // the runner checks the agent's tools on the desktop

    // the new cut, playing in its card under the reply
    await waitFor(tester, find.text('New cut'));
    await tester.tap(find.widgetWithText(ChoiceChip, 'After'));
    await waitFor(
      tester,
      find.byTooltip('Play'),
      timeout: const Duration(seconds: 60),
    );
    await tester.tap(find.widgetWithText(FilledButton, 'Keep'));
    await waitFor(tester, find.text('Opening title added'));

    await tester.pageBack();
    await waitFor(tester, home);
    await reveal(tester, projectCard.first);
    await reveal(tester, find.text('Mobile e2e motion title card'));
  });

  testWidgets('films a walkthrough, after a change of mind', (tester) async {
    await launchPaired(tester);
    const idea = 'Mobile e2e walkthrough of the examples page';

    // Cancel: nothing is made
    await start(tester, 'Walkthrough');
    await waitFor(tester, find.byKey(const ValueKey('create-sheet')));
    await describe(tester, null);
    expect(home, findsOneWidget);

    await start(tester, 'Walkthrough');
    await describe(tester, idea);
    await waitFor(
      tester,
      find.widgetWithText(AppBar, idea),
      // after the motion clip above, the desktop may still be rendering
      timeout: const Duration(minutes: 5),
    );
    await waitFor(tester, find.text(idea));
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 2),
    );
  });
}
