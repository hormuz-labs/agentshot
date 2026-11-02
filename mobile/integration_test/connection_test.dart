// Losing the computer. Out of reach (AgentShot closed, asleep, offline): the phone says so, offers to change
// computer, and reconnects by itself when it's back. Turned away (the phone removed on the computer): from wherever
// the person is, back to the connect screen, saying why. On cue, the runner takes the phone offline and back, and
// removes it on the desktop.
import 'package:agentshot_mobile/ui/project.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

/// Home says the computer is out of reach: with projects to show, that it's reconnecting.
final outOfReach = find.textContaining(RegExp('Can’t reach|Reconnecting'));

/// Taps [button] until [done] shows, as a person would once the phone is back online.
Future<void> retry(WidgetTester tester, String button, Finder done) async {
  final end = DateTime.now().add(const Duration(seconds: 120));
  while (done.evaluate().isEmpty) {
    if (DateTime.now().isAfter(end)) fail('$button never worked');
    if (find.text(button).evaluate().isNotEmpty) {
      await press(tester, find.text(button));
    }
    await settle(tester, const Duration(seconds: 3));
  }
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('offers Try again and Retry preview when offline', (
    tester,
  ) async {
    await launchPaired(tester);

    // a panel that couldn't load says so, and Try again loads it once the computer is back
    cue('stop');
    await waitFor(
      tester,
      outOfReach,
      timeout: const Duration(seconds: 60),
    );
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    await press(tester, find.text('Memory'));
    await waitFor(
      tester,
      find.text('Try again'),
      timeout: const Duration(seconds: 60),
    );
    cue('start');
    await retry(tester, 'Try again', find.text('Remember something'));
    await closeSheet(tester);
    await waitGone(
      tester,
      outOfReach,
      timeout: const Duration(seconds: 90),
    );

    // offline on a phone: nothing can be sent or noted, and the chip over the film says why, until it's back
    await tester.tap(find.byKey(const ValueKey('nav-Projects')));
    await openProject(tester);
    cue('stop');
    await tester.enterText(composer, 'offline?');
    await waitFor(tester, find.byTooltip('Send'));
    final sendable = find.descendant(
      of: find.byTooltip('Send'),
      matching: find.byWidgetPredicate((w) => w is InkWell && w.onTap != null),
    );
    await waitGone(tester, sendable, timeout: const Duration(seconds: 60));
    await tester.enterText(composer, '');
    await tester.pump();
    await backToFilm(tester);
    final kept = tester.widget<ProjectScreen>(find.byType(ProjectScreen)).store.client.cache;
    await waitFor(tester, find.byIcon(Icons.cloud_off_rounded));
    await tester.tap(find.byKey(const ValueKey('editor-note-tool')));
    await settle(tester);
    expect(find.byKey(const ValueKey('editor-bubble')), findsNothing);
    cue('start');
    await waitFor(
      tester,
      find.byIcon(Icons.forum_outlined),
      timeout: const Duration(seconds: 90),
    );
    await leaveProject(tester);
    await waitFor(tester, home);

    // the film's preview couldn't load offline (the phone kept nothing of it): Retry preview plays it once back, in
    // the player beside the conversation on a wide screen
    tester.view.physicalSize =
        const Size(1180, 820) * tester.view.devicePixelRatio;
    addTearDown(tester.view.resetPhysicalSize);
    cue('stop');
    await waitFor(
      tester,
      outOfReach,
      timeout: const Duration(seconds: 60),
    );
    await kept.clear();
    await openProject(tester);
    await waitFor(
      tester,
      find.text('Retry preview'),
      timeout: const Duration(seconds: 90),
    );
    cue('start');
    await retry(tester, 'Retry preview', find.byTooltip('Play'));
  });

  testWidgets(
    'says when the computer is out of reach, and goes back to connecting when it ends the connection',
    (tester) async {
      await launchPaired(tester);

      // out of reach: a clear message and a way out, then back by itself
      cue('stop');
      await waitFor(
        tester,
        outOfReach,
        timeout: const Duration(seconds: 60),
      );
      expect(find.text('Change computer'), findsOneWidget);
      cue('start');
      await waitGone(
        tester,
        outOfReach,
        timeout: const Duration(seconds: 90),
      );

      // turned away while deep in a project: back to the connect screen, saying why
      await openProject(tester);
      cue('revoke');
      await waitFor(
        tester,
        find.text(
          'Your computer disconnected this phone. Connect again to keep going.',
        ),
        timeout: const Duration(seconds: 60),
      );
      expect(find.text('Continue with Google'), findsOneWidget);
      expect(composer, findsNothing);
    },
  );
}
