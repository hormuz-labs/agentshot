// A cloud worker, from the phone, with none of the person's computers on: signed in, the computers list offers one;
// taking it opens it like a computer (empty: it keeps only what this person makes there); an idea becomes a project
// there and the agent answers; switching computer gives it back. The runner runs a real AgentShot --worker with the
// pool secret and checks, after, that the project is on the worker and not on the computer.
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
    final cloud = find.byKey(const ValueKey('use-cloud-worker'));
    await waitFor(
      tester,
      find.descendant(of: cloud, matching: find.textContaining('1 free')),
      timeout: const Duration(minutes: 1),
    );
    await tester.tap(cloud);
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
    await tester.tap(find.byKey(const ValueKey('nav-Settings')));
    await waitFor(tester, find.text('E2E Cloud'));
    await press(tester, find.text('Switch computer'));
    await waitFor(tester, find.text('Your computers'));
    await waitFor(
      tester,
      find.descendant(of: cloud, matching: find.textContaining('1 free')),
      timeout: const Duration(minutes: 1),
    );
  });
}
