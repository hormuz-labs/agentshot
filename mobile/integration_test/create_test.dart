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
    await waitInConversation(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 5),
    );
    expect(
      find.text('create_clip'),
      findsNothing,
    ); // the runner checks the agent's tools on the desktop

    // the new cut, in its card under the reply; it waits on the film, to compare and keep
    await waitFor(tester, find.text('New cut'));
    await backToFilm(tester);
    await waitFor(tester, filmPicture, timeout: const Duration(seconds: 60));
    await tester.tap(find.text('After'));
    await settle(tester);
    await waitFor(tester, filmPicture, timeout: const Duration(seconds: 60));
    await tester.tap(find.byKey(const ValueKey('editor-keep')));
    await waitGone(tester, find.byKey(const ValueKey('editor-keep')));
    await openConversation(tester);
    await waitFor(tester, find.text('Opening title added'));

    await leaveProject(tester);
    await waitFor(tester, home);
    await reveal(tester, projectCard);
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
      projectOpen(idea),
      // after the motion clip above, the desktop may still be rendering
      timeout: const Duration(minutes: 5),
    );
    await openConversation(tester);
    await waitFor(tester, find.text(idea));
    await waitInConversation(tester, find.text(reply));
  });
}
