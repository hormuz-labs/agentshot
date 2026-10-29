// Cloud workers from the phone, with none of the person's computers on. Signed in, the computers list offers one;
// taking it opens the person's space on it (empty at first). An idea becomes a project there, the worker (no AI of its
// own) takes this person's AgentShot credits, and the agent answers. Then the lease's own life: work running keeps it
// (a slow turn outlasts a short idle time, and leaving asks first), a few quiet seconds end it and the phone takes a
// spot again by itself, back in the same space with its credits; a full space takes nothing new until there's room;
// and at the longest run the spot goes to someone else, saying when it's free again. Switching computer gives the
// worker back. The runner (CLOUD cues) runs two real stateless workers on one shared disk with the account service's
// own lease rules, shortened, and checks after that the project is in the person's space, not on the computer or in
// either worker, and that no lease ended while work ran.
import 'package:agentshot_mobile/bridge/account.dart';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

/// Asks the runner to change the cloud's lease rules or this person's space (see test/e2e/mobile.e2e.mjs).
void cloudCue(String what) {
  // ignore: avoid_print
  print('CLOUD $what');
}

/// The cloud worker this phone holds now, as the app saved it.
Future<String?> leasedNow() async {
  final a = Account();
  await a.restore();
  return a.leased;
}

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('works on a cloud worker and gives it back', (tester) async {
    await const FlutterSecureStorage().deleteAll();
    await launch(tester);
    await tester.tap(find.text('Continue with Google'));
    // ignore: avoid_print
    print('SIGNING_IN');
    await waitFor(
      tester,
      find.text('Your computers'),
      timeout: const Duration(seconds: 90),
    );

    // none of this person's computers is on; one cloud worker is free
    final cloud = find.byKey(const ValueKey('agentshot-cloud'));
    // ready to take: on, not greyed out (a spot is free)
    final ready = find.byWidgetPredicate(
      (w) =>
          w is ListTile &&
          w.key == const ValueKey('agentshot-cloud') &&
          w.enabled,
    );
    await waitFor(tester, ready, timeout: const Duration(minutes: 1));
    final tapped = DateTime.now();
    await tester.tap(cloud);
    // in plain steps: finding a spot, opening the space, then the app
    await waitFor(tester, find.byKey(const ValueKey('cloud-step')));
    await waitFor(
      tester,
      home,
      timeout: const Duration(minutes: 2),
    );
    // ignore: avoid_print
    print('CLOUD_OPENED_IN ${DateTime.now().difference(tapped).inMilliseconds} ms');
    // it keeps only what this person makes there: nothing yet
    await reveal(tester, find.text('No projects yet'));

    // an idea becomes a project on the worker, and its agent answers
    await start(tester, 'Describe it');
    await describe(tester, 'Mobile e2e in the cloud', format: '16:9');
    // the worker has no AI of its own: this person's AgentShot credits, handed over from the phone
    await waitFor(
      tester,
      find.text('Use AgentShot credits'),
      timeout: const Duration(minutes: 2),
    );
    await settle(tester);
    await tester.tap(find.text('Use AgentShot credits'));
    await waitFor(
      tester,
      find.text('Your computer now uses your AgentShot credits.'),
      timeout: const Duration(minutes: 1),
    );
    await waitFor(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e in the cloud'),
      timeout: const Duration(minutes: 2),
    );
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 2),
    );

    // work running keeps the spot, however short the idle time: a slow turn outlasts it
    final first = await leasedNow();
    expect(first, isNotNull);
    await sendNote(tester, 'Mobile e2e slow: in the cloud');
    await waitFor(tester, find.byTooltip('Stop'));
    // short from now on: only the turn running keeps it
    cloudCue('idle');
    // and leaving while it runs asks first: Cancel keeps it
    await tester.pageBack();
    await waitGone(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e in the cloud'),
    );
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    await waitFor(tester, find.text('AgentShot Cloud'));
    await press(tester, find.text('Leave'));
    await waitFor(tester, find.text('Leave AgentShot Cloud?'));
    expect(find.textContaining('The agent'), findsOneWidget);
    await tester.tap(find.text('Cancel'));
    await settle(tester);
    expect(find.text('Leave AgentShot Cloud?'), findsNothing);
    expect(find.text('Leave'), findsOneWidget); // still here, on it
    await tester.tap(find.byKey(const ValueKey('nav-Projects')));
    await settle(tester);
    await reveal(tester, find.text('Mobile e2e in the cloud'));
    await tester.tap(find.text('Mobile e2e in the cloud'));
    await waitFor(tester, find.byKey(const ValueKey('composer')));
    await agentDone(tester, timeout: const Duration(minutes: 1));
    expect(await leasedNow(), first, reason: 'the turn kept the same spot');

    // then quiet: the lease ends by itself, and the phone takes a spot again on its own (the other worker, here),
    // back in the same project with the person's credits: the next note just works
    await waitFor(
      tester,
      find.byKey(const ValueKey('composer')),
      timeout: const Duration(seconds: 5),
    );
    final end = DateTime.now().add(const Duration(minutes: 4));
    while ((await leasedNow()) == first && DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(seconds: 2));
    }
    expect(
      await leasedNow(),
      isNot(first),
      reason: 'a new spot, taken by the phone itself',
    );
    expect(find.text('Your computers'), findsNothing);
    await waitFor(
      tester,
      find.byKey(const ValueKey('composer')),
      timeout: const Duration(minutes: 2),
    );
    // connected again: no banner saying it's opening the space or reconnecting
    await waitGone(
      tester,
      find.byWidgetPredicate(
        (w) =>
            w is Text &&
            RegExp(
              r'Opening your space|Reconnecting|Can’t reach',
            ).hasMatch(w.data ?? ''),
      ),
      timeout: const Duration(minutes: 2),
    );
    await sendNote(tester, 'Mobile e2e after the break');
    await waitFor(tester, find.text('Mobile e2e after the break'));
    await agentDone(tester, timeout: const Duration(minutes: 2));
    expect(find.text('Use AgentShot credits'), findsNothing);
    await tester.pageBack();
    await waitGone(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e in the cloud'),
    );

    // Settings names the worker; switching computer gives it back (free again for the next person)
    Future<void> giveBack() async {
      await tester.tap(find.byKey(const ValueKey('nav-Settings')));
      await waitFor(tester, find.text('AgentShot Cloud'));
      await press(tester, find.text('Leave'));
      await waitFor(tester, find.text('Your computers'));
      await waitFor(tester, ready, timeout: const Duration(minutes: 1));
    }

    await giveBack();

    // a full space: it opens and reads, but takes nothing new, saying why, until there is room again
    cloudCue('full');
    await tester.tap(cloud);
    await waitFor(
      tester,
      home,
      timeout: const Duration(minutes: 2),
    );
    Future<void> newIdea() async {
      await start(tester, 'Describe it');
      await describe(tester, 'Mobile e2e room again', format: '16:9');
      await settle(tester);
    }

    await newIdea();
    await snack(tester, 'space is full');
    cloudCue('roomy');
    // the worker counts again within a minute
    final roomBy = DateTime.now().add(const Duration(minutes: 2));
    final made = find.widgetWithText(AppBar, 'Mobile e2e room again');
    for (;;) {
      await waitGone(tester, find.byType(SnackBar));
      await newIdea();
      // made, or refused again (a snack bar) until the worker has counted
      final end = DateTime.now().add(const Duration(minutes: 1));
      while (made.evaluate().isEmpty &&
          find.byType(SnackBar).evaluate().isEmpty &&
          DateTime.now().isBefore(end)) {
        await tester.pump(const Duration(milliseconds: 500));
      }
      if (made.evaluate().isNotEmpty) break;
      expect(
        DateTime.now().isBefore(roomBy),
        isTrue,
        reason: 'room again after a recount',
      );
      await tester.pump(const Duration(seconds: 10));
    }
    await tester.pageBack();
    await waitGone(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e room again'),
    );
    await giveBack();

    // another worker this time (the stand-in account hands out the other one): the same space, so the project
    // made on the first is here, conversation and all
    final again = DateTime.now();
    await tester.tap(cloud);
    // in plain steps: finding a spot, opening the space, then the app
    await waitFor(tester, find.byKey(const ValueKey('cloud-step')));
    await waitFor(
      tester,
      home,
      timeout: const Duration(minutes: 2),
    );
    // ignore: avoid_print
    print('CLOUD_REOPENED_IN ${DateTime.now().difference(again).inMilliseconds} ms');
    await reveal(tester, find.text('Mobile e2e in the cloud'));
    await tester.tap(find.text('Mobile e2e in the cloud'));
    await waitFor(tester, find.byKey(const ValueKey('composer')));
    await waitFor(
      tester,
      find.text(reply),
      timeout: const Duration(minutes: 1),
    );
    await tester.pageBack();
    await waitGone(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e in the cloud'),
    );

    // the longest run: however it's used, the spot goes to someone else, and the phone says when it's free again
    cloudCue('cap');
    await waitFor(
      tester,
      find.textContaining('in a row'),
      timeout: const Duration(minutes: 3),
    );
    expect(find.text('Your computers'), findsOneWidget);
    cloudCue('reset');
    await waitFor(tester, ready, timeout: const Duration(minutes: 1));
    await tester.tap(cloud);
    await waitFor(
      tester,
      home,
      timeout: const Duration(minutes: 2),
    );
    await giveBack();
  });
}
