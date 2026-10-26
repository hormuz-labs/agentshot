// Cloud workers from the phone, with none of the person's computers on. Signed in, the computers list offers one;
// taking it opens the person's space on it (empty at first). An idea becomes a project there, the worker (no AI of its
// own) takes this person's AgentShot credits, and the agent answers; switching computer gives the worker back. Taking
// a worker again gets the other one (the runner's stand-in account sees to that), which opens the same space: the
// project and its conversation are there. The runner runs two real stateless workers on one shared disk and checks
// after that the project is in the person's space, not on the computer or in either worker.
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'support.dart';

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
    await tester.tap(cloud);
    // in plain steps: finding a spot, opening the space, then the app
    await waitFor(tester, find.byKey(const ValueKey('cloud-step')));
    await waitFor(
      tester,
      find.text('What are we making?'),
      timeout: const Duration(minutes: 2),
    );
    // it keeps only what this person makes there: nothing yet
    await reveal(tester, find.text('A home for your films'));

    // an idea becomes a project on the worker, and its agent answers
    await start(tester, 'Start from an idea');
    await answer(tester, 'Mobile e2e in the cloud');
    await waitFor(tester, find.text('Choose a format'));
    await tester.tap(find.text('16:9'));
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
    await tester.pageBack();
    await waitGone(
      tester,
      find.widgetWithText(AppBar, 'Mobile e2e in the cloud'),
    );

    // Settings names the worker; switching computer gives it back (free again for the next person)
    Future<void> giveBack() async {
      await tester.tap(find.byKey(const ValueKey('nav-Settings')));
      await waitFor(tester, find.text('AgentShot Cloud'));
      await press(tester, find.text('Switch computer'));
      await waitFor(tester, find.text('Your computers'));
      await waitFor(tester, ready, timeout: const Duration(minutes: 1));
    }

    await giveBack();

    // another worker this time (the stand-in account hands out the other one): the same space, so the project
    // made on the first is here, conversation and all
    await tester.tap(cloud);
    // in plain steps: finding a spot, opening the space, then the app
    await waitFor(tester, find.byKey(const ValueKey('cloud-step')));
    await waitFor(
      tester,
      find.text('What are we making?'),
      timeout: const Duration(minutes: 2),
    );
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
    await giveBack();
  });
}
