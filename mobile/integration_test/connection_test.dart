// Losing the computer. Out of reach (AgentShot closed, asleep, offline): the phone says so, offers to change
// computer, and reconnects by itself when it's back. Turned away (the phone removed on the computer): from wherever
// the person is, back to the connect screen, saying why. On cue, the runner takes the phone offline and back, and
// removes it on the desktop.
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

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
      find.textContaining('Can’t reach'),
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
      find.textContaining('Can’t reach'),
      timeout: const Duration(seconds: 90),
    );

    // the film's preview couldn't load offline: Retry preview plays it once back
    await tester.tap(find.byKey(const ValueKey('nav-Projects')));
    await openProject(tester);
    cue('stop');
    await tester.enterText(find.byKey(const ValueKey('composer')), 'offline?');
    final sendable = find.byWidgetPredicate(
      (w) => w is IconButton && w.tooltip == 'Send' && w.onPressed != null,
    );
    await waitGone(tester, sendable, timeout: const Duration(seconds: 60));
    await tester.tap(find.byKey(const ValueKey('tab-Film')));
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
        find.textContaining('Can’t reach'),
        timeout: const Duration(seconds: 60),
      );
      expect(find.text('Change computer'), findsOneWidget);
      cue('start');
      await waitGone(
        tester,
        find.textContaining('Can’t reach'),
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
      expect(find.byKey(const ValueKey('composer')), findsNothing);
    },
  );
}
